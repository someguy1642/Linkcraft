import type {
  AnalyticsRange,
  BreakdownItem,
  ClickEvent,
  HeatmapCell,
  LinkAnalyticsResponse,
  OverviewAnalyticsResponse,
  ReferrerItem,
  ShortLink,
  TimeSeriesPoint,
} from './types';

const RANGE_MS: Record<Exclude<AnalyticsRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function filterClicksByRange(
  clicks: ClickEvent[],
  range: AnalyticsRange,
  nowMs = Date.now(),
): ClickEvent[] {
  if (range === 'all') return clicks;
  const cutoff = nowMs - RANGE_MS[range];
  return clicks.filter((c) => {
    const ms = Date.parse(c.timestamp);
    return !Number.isNaN(ms) && ms >= cutoff && ms <= nowMs + 60_000;
  });
}

function buildBreakdown(values: string[], limit?: number): BreakdownItem[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const total = values.length || 1;
  const sorted = Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      percentage: Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}

export function buildHeatmapMatrix(clicks: ClickEvent[]): HeatmapCell[] {
  const matrix = new Map<string, number>();
  for (const c of clicks) {
    const d = new Date(c.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getUTCDay()}:${d.getUTCHours()}`;
    matrix.set(key, (matrix.get(key) || 0) + 1);
  }

  const cells: HeatmapCell[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({
        dayOfWeek,
        hour,
        count: matrix.get(`${dayOfWeek}:${hour}`) || 0,
      });
    }
  }
  return cells;
}

function buildTimeSeries(
  clicks: ClickEvent[],
  range: AnalyticsRange,
  nowMs = Date.now(),
): TimeSeriesPoint[] {
  if (range === '24h') {
    const buckets: TimeSeriesPoint[] = [];
    const hourMs = 60 * 60 * 1000;
    const startHour = Math.floor((nowMs - 23 * hourMs) / hourMs) * hourMs;
    const map = new Map<number, { total: number; unique: number }>();

    for (let i = 0; i < 24; i++) {
      map.set(startHour + i * hourMs, { total: 0, unique: 0 });
    }

    for (const c of clicks) {
      const ms = Date.parse(c.timestamp);
      if (Number.isNaN(ms)) continue;
      const bucket = Math.floor(ms / hourMs) * hourMs;
      const entry = map.get(bucket);
      if (entry) {
        entry.total += 1;
        if (c.isUnique) entry.unique += 1;
      }
    }

    for (const [ts, counts] of map.entries()) {
      const d = new Date(ts);
      const label = `${String(d.getUTCHours()).padStart(2, '0')}:00`;
      buckets.push({
        label,
        bucketStart: d.toISOString(),
        total: counts.total,
        unique: counts.unique,
      });
    }
    return buckets;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  let numDays = 7;
  if (range === '30d') numDays = 30;
  else if (range === '90d') numDays = 90;
  else if (range === 'all') {
    if (clicks.length === 0) {
      numDays = 14;
    } else {
      const earliest = Math.min(...clicks.map((c) => Date.parse(c.timestamp)).filter((n) => !Number.isNaN(n)));
      const spanDays = Math.ceil((nowMs - earliest) / dayMs) + 1;
      numDays = Math.min(Math.max(spanDays, 7), 90);
    }
  }

  const todayUtcStart = Date.UTC(
    new Date(nowMs).getUTCFullYear(),
    new Date(nowMs).getUTCMonth(),
    new Date(nowMs).getUTCDate(),
  );
  const startDay = todayUtcStart - (numDays - 1) * dayMs;
  const map = new Map<number, { total: number; unique: number }>();

  for (let i = 0; i < numDays; i++) {
    map.set(startDay + i * dayMs, { total: 0, unique: 0 });
  }

  for (const c of clicks) {
    const ms = Date.parse(c.timestamp);
    if (Number.isNaN(ms)) continue;
    const d = new Date(ms);
    const dayKey = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const entry = map.get(dayKey);
    if (entry) {
      entry.total += 1;
      if (c.isUnique) entry.unique += 1;
    }
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const points: TimeSeriesPoint[] = [];
  for (const [ts, counts] of map.entries()) {
    const d = new Date(ts);
    const label = `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
    points.push({
      label,
      bucketStart: d.toISOString(),
      total: counts.total,
      unique: counts.unique,
    });
  }
  return points;
}

export function computeLinkAnalytics(
  link: ShortLink,
  allClicks: ClickEvent[],
  range: AnalyticsRange,
  nowMs = Date.now(),
): LinkAnalyticsResponse {
  const scoped = filterClicksByRange(allClicks, range, nowMs);
  const totalClicks = scoped.length;
  const uniqueClicks = scoped.filter((c) => c.isUnique).length;

  const countries = buildBreakdown(
    scoped.map((c) => c.country),
    10,
  );
  const devices = buildBreakdown(
    scoped.map((c) => c.deviceType.charAt(0).toUpperCase() + c.deviceType.slice(1)),
  );
  const operatingSystems = buildBreakdown(scoped.map((c) => c.os), 6);
  const browsers = buildBreakdown(scoped.map((c) => c.browser), 6);

  // Referrer table
  const refMap = new Map<string, { clicks: number; uniqueClicks: number }>();
  for (const c of scoped) {
    const key = c.referrer || 'Direct';
    const curr = refMap.get(key) || { clicks: 0, uniqueClicks: 0 };
    curr.clicks += 1;
    if (c.isUnique) curr.uniqueClicks += 1;
    refMap.set(key, curr);
  }
  const referrers: ReferrerItem[] = Array.from(refMap.entries())
    .map(([referrer, stats]) => ({
      referrer,
      clicks: stats.clicks,
      uniqueClicks: stats.uniqueClicks,
      share: totalClicks > 0 ? Math.round((stats.clicks / totalClicks) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);

  return {
    link,
    range,
    totalClicks,
    uniqueClicks,
    topCountry: countries[0]?.label || '—',
    topDevice: devices[0]?.label || '—',
    timeSeries: buildTimeSeries(scoped, range, nowMs),
    countries,
    devices,
    operatingSystems,
    browsers,
    referrers,
    heatmap: buildHeatmapMatrix(scoped),
    generatedAt: new Date(nowMs).toISOString(),
  };
}

export function computeOverviewAnalytics(
  links: ShortLink[],
  allClicks: ClickEvent[],
  nowMs = Date.now(),
): OverviewAnalyticsResponse {
  const cutoff24h = nowMs - 24 * 60 * 60 * 1000;
  let activeLinks = 0;
  let expiredLinks = 0;
  let protectedLinks = 0;
  let totalClicks = 0;
  let uniqueClicks = 0;
  let mostPopularLink: ShortLink | null = null;

  for (const link of links) {
    if (link.status === 'active') activeLinks += 1;
    if (link.status === 'expired') expiredLinks += 1;
    if (link.isPasswordProtected) protectedLinks += 1;
    totalClicks += link.clicks;
    uniqueClicks += link.uniqueClicks;
    if (!mostPopularLink || link.clicks > mostPopularLink.clicks) {
      mostPopularLink = link;
    }
  }

  const recentClicks24h = allClicks.filter((c) => {
    const ms = Date.parse(c.timestamp);
    return !Number.isNaN(ms) && ms >= cutoff24h;
  }).length;

  const last7dClicks = filterClicksByRange(allClicks, '7d', nowMs);

  return {
    totalLinks: links.length,
    activeLinks,
    expiredLinks,
    protectedLinks,
    totalClicks,
    uniqueClicks,
    mostPopularLink,
    recentClicks24h,
    topCountries: buildBreakdown(
      allClicks.map((c) => c.country),
      8,
    ),
    dailyTrend: buildTimeSeries(last7dClicks, '7d', nowMs),
    generatedAt: new Date(nowMs).toISOString(),
  };
}
