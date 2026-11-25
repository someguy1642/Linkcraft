import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { ArrowLeft, BarChart3, Globe, Monitor, MousePointerClick, Users } from 'lucide-react';
import type {
  AnalyticsRange,
  LinkAnalyticsResponse,
  OverviewAnalyticsResponse,
  ShortLink,
} from '../shared/types';
import { api } from '../utils/api';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

interface AnalyticsDashboardProps {
  links: ShortLink[];
  selectedLink: ShortLink | null;
  onSelectLink: (link: ShortLink | null) => void;
  theme: 'light' | 'dark';
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHART_PALETTE = ['#2563eb', '#0891b2', '#059669', '#d97706', '#6366f1', '#64748b'];

export default function AnalyticsDashboard({
  links,
  selectedLink,
  onSelectLink,
  theme,
}: AnalyticsDashboardProps) {
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [overview, setOverview] = useState<OverviewAnalyticsResponse | null>(null);
  const [linkReport, setLinkReport] = useState<LinkAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const countryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const deviceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const osCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const browserCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    if (selectedLink) {
      api
        .getLinkAnalytics(selectedLink.id, range)
        .then((data) => {
          if (!cancelled) setLinkReport(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load analytics.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      api
        .getOverviewAnalytics()
        .then((data) => {
          if (!cancelled) setOverview(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load overview.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedLink, range]);

  const textColor = theme === 'dark' ? '#cbd5e1' : '#475569';
  const gridColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.07)';

  // Render Line Chart (Time Series)
  useEffect(() => {
    const canvas = lineCanvasRef.current;
    if (!canvas || loading) return;
    const series = selectedLink ? linkReport?.timeSeries : overview?.dailyTrend;
    if (!series || series.length === 0) return;

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map((p) => p.label),
        datasets: [
          {
            label: 'Total Clicks',
            data: series.map((p) => p.total),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: series.length > 35 ? 0 : 2.5,
          },
          {
            label: 'Unique Visitors',
            data: series.map((p) => p.unique),
            borderColor: '#059669',
            backgroundColor: 'transparent',
            borderDash: [4, 4],
            tension: 0.3,
            pointRadius: series.length > 35 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: textColor, boxWidth: 12, usePointStyle: true },
          },
        },
        scales: {
          x: {
            ticks: { color: textColor, maxTicksLimit: 10 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, precision: 0 },
            grid: { color: gridColor },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [selectedLink, linkReport, overview, loading, textColor, gridColor]);

  // Render Countries Bar Chart
  useEffect(() => {
    const canvas = countryCanvasRef.current;
    if (!canvas || loading) return;
    const countries = selectedLink ? linkReport?.countries : overview?.topCountries;
    if (!countries || countries.length === 0) return;

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: countries.map((c) => c.label),
        datasets: [
          {
            label: 'Clicks',
            data: countries.map((c) => c.count),
            backgroundColor: '#2563eb',
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { color: textColor, precision: 0 }, grid: { color: gridColor } },
          y: { ticks: { color: textColor }, grid: { display: false } },
        },
      },
    });

    return () => chart.destroy();
  }, [selectedLink, linkReport, overview, loading, textColor, gridColor]);

  // Helper for Doughnut Charts (Device, OS, Browser)
  const renderDoughnut = (
    canvas: HTMLCanvasElement | null,
    items: Array<{ label: string; count: number }> | undefined,
  ) => {
    if (!canvas || !items || items.length === 0) return undefined;
    return new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: items.map((d) => d.label),
        datasets: [
          {
            data: items.map((d) => d.count),
            backgroundColor: CHART_PALETTE,
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textColor, boxWidth: 10, padding: 12 },
          },
        },
      },
    });
  };

  useEffect(() => {
    if (!selectedLink || !linkReport || loading) return;
    const dChart = renderDoughnut(deviceCanvasRef.current, linkReport.devices);
    const oChart = renderDoughnut(osCanvasRef.current, linkReport.operatingSystems);
    const bChart = renderDoughnut(browserCanvasRef.current, linkReport.browsers);
    return () => {
      dChart?.destroy();
      oChart?.destroy();
      bChart?.destroy();
    };
  }, [selectedLink, linkReport, loading, textColor]);

  const heatmapMax = useMemo(() => {
    if (!linkReport?.heatmap) return 1;
    return Math.max(1, ...linkReport.heatmap.map((c) => c.count));
  }, [linkReport]);

  return (
    <section id="analytics" aria-labelledby="analytics-heading" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header & Link Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {selectedLink && (
              <button
                type="button"
                onClick={() => onSelectLink(null)}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>All Links</span>
              </button>
            )}
            <h2 id="analytics-heading" className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              {selectedLink ? `Analytics for /${selectedLink.code}` : 'Workspace Analytics'}
            </h2>
          </div>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            {selectedLink
              ? selectedLink.targetUrl
              : 'Aggregate performance across all shortened links (cached 60s).'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Link Switcher */}
          <label htmlFor="analytics-link-select" className="sr-only">
            Select link for detailed analytics
          </label>
          <select
            id="analytics-link-select"
            value={selectedLink?.id || ''}
            onChange={(e) => {
              const found = links.find((l) => l.id === e.target.value) || null;
              onSelectLink(found);
            }}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="">Workspace Overview (All Links)</option>
            {links.map((l) => (
              <option key={l.id} value={l.id}>
                /{l.code} ({l.clicks} clicks)
              </option>
            ))}
          </select>

          {/* Range Filter */}
          {selectedLink && (
            <div
              role="group"
              aria-label="Analytics time range"
              className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900"
            >
              {(['24h', '7d', '30d', '90d', 'all'] as AnalyticsRange[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`min-h-[32px] rounded-md px-2.5 text-xs font-medium uppercase transition-colors ${
                    range === r
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-pulse" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900" />
          ))}
        </div>
      ) : selectedLink && linkReport ? (
        /* Per-Link Detailed Analytics */
        <div className="mt-6 space-y-6">
          {/* KPI Strip */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Total Clicks</span>
                <MousePointerClick className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {linkReport.totalClicks.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Unique Visitors</span>
                <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {linkReport.uniqueClicks.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Top Country</span>
                <Globe className="h-4 w-4 text-slate-500" aria-hidden="true" />
              </div>
              <p className="mt-2 truncate font-display text-xl font-semibold text-slate-900 dark:text-white">
                {linkReport.topCountry}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Primary Device</span>
                <Monitor className="h-4 w-4 text-slate-500" aria-hidden="true" />
              </div>
              <p className="mt-2 truncate font-display text-xl font-semibold text-slate-900 dark:text-white">
                {linkReport.topDevice}
              </p>
            </div>
          </div>

          {linkReport.totalClicks === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
              <BarChart3 className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-700" aria-hidden="true" />
              <h3 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-white">
                No clicks recorded in this period
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Share /{linkReport.link.code} or expand the time range to view activity.
              </p>
            </div>
          ) : (
            <>
              {/* Time Series + Countries */}
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Clicks Over Time
                  </h3>
                  <div className="mt-4 h-64">
                    <canvas ref={lineCanvasRef} aria-label="Clicks over time line chart" />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Top Countries
                  </h3>
                  <div className="mt-4 h-64">
                    <canvas ref={countryCanvasRef} aria-label="Top countries bar chart" />
                  </div>
                </div>
              </div>

              {/* Device / OS / Browser */}
              <div className="grid gap-6 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Devices
                  </h3>
                  <div className="mt-4 h-56">
                    <canvas ref={deviceCanvasRef} aria-label="Device breakdown chart" />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Operating Systems
                  </h3>
                  <div className="mt-4 h-56">
                    <canvas ref={osCanvasRef} aria-label="Operating system breakdown chart" />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Browsers
                  </h3>
                  <div className="mt-4 h-56">
                    <canvas ref={browserCanvasRef} aria-label="Browser breakdown chart" />
                  </div>
                </div>
              </div>

              {/* Referrers Table + Day x Hour Heatmap */}
              <div className="grid gap-6 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                    Top Referrers
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <th className="py-2 font-medium">Source</th>
                          <th className="py-2 text-right font-medium">Clicks</th>
                          <th className="py-2 text-right font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {linkReport.referrers.map((r) => (
                          <tr key={r.referrer}>
                            <td className="py-2 font-medium text-slate-800 dark:text-slate-200">{r.referrer}</td>
                            <td className="py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {r.clicks}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {r.share}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Day x Hour Click Heatmap */}
                <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-3 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                      Click Heatmap (Day × UTC Hour)
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400">00:00 – 23:00 UTC</span>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[520px] space-y-1">
                      {DAY_LABELS.map((dayName, dayIdx) => (
                        <div key={dayName} className="grid grid-cols-[36px_repeat(24,minmax(0,1fr))] items-center gap-1">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {dayName}
                          </span>
                          {Array.from({ length: 24 }).map((_, hr) => {
                            const cell = linkReport.heatmap.find(
                              (c) => c.dayOfWeek === dayIdx && c.hour === hr,
                            );
                            const count = cell?.count || 0;
                            const intensity = count === 0 ? 0 : Math.max(0.2, count / heatmapMax);
                            return (
                              <div
                                key={hr}
                                title={`${dayName} ${String(hr).padStart(2, '0')}:00 UTC — ${count} clicks`}
                                className={`h-4 rounded-[3px] border border-slate-200/70 dark:border-slate-800 ${
                                  count === 0 ? 'bg-slate-100/70 dark:bg-slate-800/40' : ''
                                }`}
                                style={{
                                  backgroundColor:
                                    count === 0
                                      ? undefined
                                      : `rgba(37, 99, 235, ${intensity.toFixed(2)})`,
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : overview ? (
        /* Aggregate Workspace Overview */
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Links</span>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {overview.totalLinks.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {overview.activeLinks} active · {overview.protectedLinks} protected
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Clicks</span>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {overview.totalClicks.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {overview.uniqueClicks.toLocaleString()} unique visitors
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Clicks (Last 24h)</span>
              <p className="mt-2 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
                {overview.recentClicks24h.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Across all active links</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Most Popular Link</span>
              {overview.mostPopularLink ? (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectLink(overview.mostPopularLink)}
                    className="mt-2 block truncate font-mono text-xl font-bold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    /{overview.mostPopularLink.code}
                  </button>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {overview.mostPopularLink.clicks.toLocaleString()} clicks · Click to inspect
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-500">—</p>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                7-Day Click Velocity
              </h3>
              <div className="mt-4 h-64">
                <canvas ref={lineCanvasRef} aria-label="7-day aggregate click velocity chart" />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Global Reach (Top Countries)
              </h3>
              <div className="mt-4 h-64">
                <canvas ref={countryCanvasRef} aria-label="Top countries chart" />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
