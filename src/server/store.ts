import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { computeLinkAnalytics, computeOverviewAnalytics } from '../shared/analyticsUtils';
import type {
  AnalyticsRange,
  ClickEvent,
  DeviceType,
  LinkAnalyticsResponse,
  OverviewAnalyticsResponse,
  ShortLink,
  SponsorCampaign,
  UserPlan,
  AdNetworkConfig,
} from '../shared/types';
import { computeLinkStatus, normalizeTags } from '../shared/urlUtils';
import { hashPassword } from './security';

export interface StoredLinkRecord {
  id: string;
  ownerId?: string | null;
  code: string;
  targetUrl: string;
  originalInputUrl?: string;
  isCustomAlias: boolean;
  tags: string[];
  createdAt: string;
  expiresAt: string | null;
  passwordHash: string | null;
  interstitialEnabled?: boolean;
  sponsorId?: string | null;
  isDisabled: boolean;
  isDemo?: boolean;
}

export interface StoredUserBilling {
  uid: string;
  plan: UserPlan;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  updatedAt: string;
}

interface PersistedDatabase {
  version: number;
  demoSeeded: boolean;
  links: StoredLinkRecord[];
  clicks: ClickEvent[];
  sponsors?: SponsorCampaign[];
  userBilling?: StoredUserBilling[];
  adConfig?: AdNetworkConfig;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'linkcraft-data')
  : path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const ANALYTICS_CACHE_TTL_MS = 60_000;
const KV_KEY = 'linkcraft:db:v2';

function getKvRestConfig(): { url: string; token: string } | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export class LinkStore {
  private linksById = new Map<string, StoredLinkRecord>();
  private idByCodeLower = new Map<string, string>();
  private clicksByLinkId = new Map<string, ClickEvent[]>();
  private sponsorsById = new Map<string, SponsorCampaign>();
  private billingByUid = new Map<string, StoredUserBilling>();
  private adConfig: AdNetworkConfig = {
    enabled: false,
    networkType: 'banner_html',
    networkName: 'Monetag / Adsterra / Custom',
    bannerHtml: '',
    directAdUrl: '',
    showOnInterstitial: true,
    showOnHomepage: false,
    updatedAt: new Date().toISOString(),
  };
  private analyticsCache = new Map<string, CacheEntry<LinkAnalyticsResponse>>();
  private overviewCache: CacheEntry<OverviewAnalyticsResponse> | null = null;
  private demoSeeded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  constructor() {
    this.loadFromDisk();
    if (this.linksById.size === 0 && !this.demoSeeded) {
      this.seedDemoData();
    }
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const kv = getKvRestConfig();
    if (!kv) return;

    try {
      const res = await fetch(`${kv.url}/get/${encodeURIComponent(KV_KEY)}`, {
        headers: { Authorization: `Bearer ${kv.token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { result?: string | null };
      if (!body.result) {
        // Seed initial state into KV
        this.persistNow();
        return;
      }
      const parsed = JSON.parse(body.result) as PersistedDatabase;
      this.linksById.clear();
      this.idByCodeLower.clear();
      this.clicksByLinkId.clear();
      this.sponsorsById.clear();
      this.billingByUid.clear();
      this.hydrateFromPayload(parsed);
      this.invalidateCache();
    } catch {
      // Fall back silently to disk / in-memory state
    }
  }

  private hydrateFromPayload(parsed: PersistedDatabase): void {
    this.demoSeeded = Boolean(parsed.demoSeeded);

    if (Array.isArray(parsed.links)) {
      for (const rec of parsed.links) {
        this.linksById.set(rec.id, rec);
        this.idByCodeLower.set(rec.code.toLowerCase(), rec.id);
      }
    }

    if (Array.isArray(parsed.clicks)) {
      for (const click of parsed.clicks) {
        const list = this.clicksByLinkId.get(click.linkId) || [];
        list.push(click);
        this.clicksByLinkId.set(click.linkId, list);
      }
    }

    if (Array.isArray(parsed.sponsors)) {
      for (const sp of parsed.sponsors) {
        this.sponsorsById.set(sp.id, sp);
      }
    }

    if (Array.isArray(parsed.userBilling)) {
      for (const ub of parsed.userBilling) {
        this.billingByUid.set(ub.uid, ub);
      }
    }

    if (parsed.adConfig) {
      this.adConfig = { ...this.adConfig, ...parsed.adConfig };
    }
  }

  private buildPayload(): PersistedDatabase {
    const allClicks: ClickEvent[] = [];
    for (const list of this.clicksByLinkId.values()) {
      allClicks.push(...list);
    }
    return {
      version: 2,
      demoSeeded: this.demoSeeded,
      links: Array.from(this.linksById.values()),
      clicks: allClicks,
      sponsors: Array.from(this.sponsorsById.values()),
      userBilling: Array.from(this.billingByUid.values()),
      adConfig: this.adConfig,
    };
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(DB_FILE)) return;
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw) as PersistedDatabase;
      this.hydrateFromPayload(parsed);
    } catch {
      // Start clean if file is missing or unreadable
    }
  }

  private schedulePersist(): void {
    if (process.env.VERCEL) {
      this.persistNow();
      return;
    }
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persistNow();
    }, 150);
  }

  public persistNow(): void {
    const payload = this.buildPayload();
    const serialized = JSON.stringify(payload);

    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, serialized, 'utf8');
      fs.renameSync(tmp, DB_FILE);
    } catch {
      // Ignore disk write errors in read-only environments
    }

    const kv = getKvRestConfig();
    if (kv) {
      void fetch(`${kv.url}/set/${encodeURIComponent(KV_KEY)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kv.token}`,
          'Content-Type': 'application/json',
        },
        body: serialized,
      }).catch(() => {
        // Ignore transient KV write failures
      });
    }
  }

  public getAdConfig(): AdNetworkConfig {
    return this.adConfig;
  }

  public setAdConfig(config: Partial<AdNetworkConfig>): AdNetworkConfig {
    this.adConfig = {
      ...this.adConfig,
      ...config,
      updatedAt: new Date().toISOString(),
    };
    this.schedulePersist();
    return this.adConfig;
  }

  public invalidateCache(linkId?: string): void {
    this.overviewCache = null;
    if (linkId) {
      for (const key of this.analyticsCache.keys()) {
        if (key.startsWith(`${linkId}:`)) {
          this.analyticsCache.delete(key);
        }
      }
    } else {
      this.analyticsCache.clear();
    }
  }

  public toPublicLink(rec: StoredLinkRecord, nowMs = Date.now()): ShortLink {
    const clicks = this.clicksByLinkId.get(rec.id) || [];
    let uniqueCount = 0;
    let lastClickedAt: string | null = null;
    for (const c of clicks) {
      if (c.isUnique) uniqueCount += 1;
      if (!lastClickedAt || c.timestamp > lastClickedAt) {
        lastClickedAt = c.timestamp;
      }
    }
    return {
      id: rec.id,
      ownerId: rec.ownerId || null,
      code: rec.code,
      targetUrl: rec.targetUrl,
      originalInputUrl: rec.originalInputUrl,
      isCustomAlias: rec.isCustomAlias,
      tags: rec.tags,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      isPasswordProtected: Boolean(rec.passwordHash),
      interstitialEnabled: Boolean(rec.interstitialEnabled),
      sponsorId: rec.sponsorId || null,
      isDisabled: rec.isDisabled,
      status: computeLinkStatus(rec.isDisabled, rec.expiresAt, nowMs),
      clicks: clicks.length,
      uniqueClicks: uniqueCount,
      lastClickedAt,
      isDemo: rec.isDemo,
    };
  }

  public getUserBilling(uid: string): StoredUserBilling {
    return (
      this.billingByUid.get(uid) || {
        uid,
        plan: 'free',
        updatedAt: new Date().toISOString(),
      }
    );
  }

  public setUserBilling(record: StoredUserBilling): void {
    this.billingByUid.set(record.uid, record);
    this.schedulePersist();
  }

  public findUidByStripeCustomer(customerId: string): string | null {
    for (const ub of this.billingByUid.values()) {
      if (ub.stripeCustomerId === customerId) return ub.uid;
    }
    return null;
  }

  public countLinksForOwner(uid: string): number {
    let count = 0;
    for (const rec of this.linksById.values()) {
      if (rec.ownerId === uid && !rec.isDemo) count += 1;
    }
    return count;
  }

  // Sponsor campaigns
  public listSponsors(ownerId?: string | null): SponsorCampaign[] {
    return Array.from(this.sponsorsById.values())
      .filter((s) => !ownerId || s.ownerId === ownerId || s.ownerId === 'demo')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  public createSponsor(params: {
    ownerId: string;
    title: string;
    description: string;
    ctaLabel: string;
    ctaUrl: string;
    badgeText?: string;
    active?: boolean;
    isDemo?: boolean;
  }): SponsorCampaign {
    const now = new Date().toISOString();
    const sponsor: SponsorCampaign = {
      id: `sp_${nanoid(10)}`,
      ownerId: params.ownerId,
      title: params.title,
      description: params.description,
      ctaLabel: params.ctaLabel,
      ctaUrl: params.ctaUrl,
      badgeText: params.badgeText || 'Sponsored',
      active: params.active ?? true,
      impressions: 0,
      clicks: 0,
      createdAt: now,
      updatedAt: now,
      isDemo: params.isDemo,
    };
    this.sponsorsById.set(sponsor.id, sponsor);
    this.schedulePersist();
    return sponsor;
  }

  public updateSponsor(
    id: string,
    ownerId: string,
    patch: Partial<Pick<SponsorCampaign, 'title' | 'description' | 'ctaLabel' | 'ctaUrl' | 'badgeText' | 'active'>>,
  ): SponsorCampaign | null {
    const existing = this.sponsorsById.get(id);
    if (!existing) return null;
    if (existing.ownerId !== ownerId && existing.ownerId !== 'demo') return null;

    if (patch.title !== undefined) existing.title = patch.title;
    if (patch.description !== undefined) existing.description = patch.description;
    if (patch.ctaLabel !== undefined) existing.ctaLabel = patch.ctaLabel;
    if (patch.ctaUrl !== undefined) existing.ctaUrl = patch.ctaUrl;
    if (patch.badgeText !== undefined) existing.badgeText = patch.badgeText;
    if (patch.active !== undefined) existing.active = patch.active;
    existing.updatedAt = new Date().toISOString();

    this.schedulePersist();
    return existing;
  }

  public deleteSponsor(id: string, ownerId: string): boolean {
    const existing = this.sponsorsById.get(id);
    if (!existing) return false;
    if (existing.ownerId !== ownerId && existing.ownerId !== 'demo') return false;
    this.sponsorsById.delete(id);
    this.schedulePersist();
    return true;
  }

  public getLatestActiveSponsor(): SponsorCampaign | null {
    const active = Array.from(this.sponsorsById.values()).filter((s) => s.active);
    if (active.length === 0) return null;
    const custom = active.filter((s) => !s.isDemo);
    const pool = custom.length > 0 ? custom : active;
    return pool[pool.length - 1];
  }

  public getSponsorForLink(rec: StoredLinkRecord): SponsorCampaign | null {
    if (rec.sponsorId) {
      const specific = this.sponsorsById.get(rec.sponsorId);
      if (specific && specific.active) return specific;
    }
    const activeSponsors = Array.from(this.sponsorsById.values()).filter(
      (s) =>
        s.active &&
        (!rec.ownerId || !s.ownerId || s.ownerId === 'guest' || s.ownerId === 'demo' || s.ownerId === rec.ownerId),
    );
    if (activeSponsors.length > 0) {
      const custom = activeSponsors.filter((s) => !s.isDemo);
      const pool = custom.length > 0 ? custom : activeSponsors;
      return pool[pool.length - 1];
    }
    const anyActive = Array.from(this.sponsorsById.values()).filter((s) => s.active);
    return anyActive[anyActive.length - 1] || null;
  }

  public recordSponsorImpression(sponsorId: string): void {
    const sp = this.sponsorsById.get(sponsorId);
    if (!sp) return;
    sp.impressions += 1;
    this.schedulePersist();
  }

  public recordSponsorClick(sponsorId: string): SponsorCampaign | null {
    const sp = this.sponsorsById.get(sponsorId);
    if (!sp) return null;
    sp.clicks += 1;
    this.schedulePersist();
    return sp;
  }

  public isCodeAvailable(code: string): boolean {
    return !this.idByCodeLower.has(code.toLowerCase());
  }

  public generateUniqueCode(length = 7): string {
    for (let i = 0; i < 10; i++) {
      const candidate = nanoid(length);
      if (!this.idByCodeLower.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
    return nanoid(10);
  }

  public getRecordByCode(code: string): StoredLinkRecord | undefined {
    const id = this.idByCodeLower.get(code.toLowerCase());
    if (!id) return undefined;
    return this.linksById.get(id);
  }

  public getRecordById(id: string): StoredLinkRecord | undefined {
    return this.linksById.get(id);
  }

  public createLink(params: {
    ownerId?: string | null;
    targetUrl: string;
    originalInputUrl?: string;
    customAlias?: string;
    expiresAt?: string | null;
    password?: string;
    interstitialEnabled?: boolean;
    sponsorId?: string | null;
    tags?: string[];
    isDemo?: boolean;
  }): ShortLink {
    const code = params.customAlias ? params.customAlias.trim() : this.generateUniqueCode(7);
    const id = `lnk_${nanoid(12)}`;
    const record: StoredLinkRecord = {
      id,
      ownerId: params.ownerId || null,
      code,
      targetUrl: params.targetUrl,
      originalInputUrl: params.originalInputUrl,
      isCustomAlias: Boolean(params.customAlias),
      tags: normalizeTags(params.tags),
      createdAt: new Date().toISOString(),
      expiresAt: params.expiresAt || null,
      passwordHash: params.password ? hashPassword(params.password) : null,
      interstitialEnabled: Boolean(params.interstitialEnabled),
      sponsorId: params.sponsorId || null,
      isDisabled: false,
      isDemo: params.isDemo,
    };
    this.linksById.set(id, record);
    this.idByCodeLower.set(code.toLowerCase(), id);
    this.clicksByLinkId.set(id, []);
    this.invalidateCache(id);
    this.schedulePersist();
    return this.toPublicLink(record);
  }

  public updateLink(
    id: string,
    patch: {
      expiresAt?: string | null;
      isDisabled?: boolean;
      tags?: string[];
      password?: string | null;
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    },
  ): ShortLink | null {
    const existing = this.linksById.get(id);
    if (!existing) return null;

    if (patch.expiresAt !== undefined) existing.expiresAt = patch.expiresAt;
    if (patch.isDisabled !== undefined) existing.isDisabled = patch.isDisabled;
    if (patch.tags !== undefined) existing.tags = normalizeTags(patch.tags);
    if (patch.password !== undefined) {
      existing.passwordHash = patch.password ? hashPassword(patch.password) : null;
    }
    if (patch.interstitialEnabled !== undefined) {
      existing.interstitialEnabled = patch.interstitialEnabled;
    }
    if (patch.sponsorId !== undefined) {
      existing.sponsorId = patch.sponsorId;
    }

    this.invalidateCache(id);
    this.schedulePersist();
    return this.toPublicLink(existing);
  }

  public deleteLink(id: string): boolean {
    const existing = this.linksById.get(id);
    if (!existing) return false;
    this.linksById.delete(id);
    this.idByCodeLower.delete(existing.code.toLowerCase());
    this.clicksByLinkId.delete(id);
    this.invalidateCache(id);
    this.schedulePersist();
    return true;
  }

  public recordClick(click: Omit<ClickEvent, 'id'>): ClickEvent {
    const fullClick: ClickEvent = {
      ...click,
      id: `clk_${nanoid(10)}`,
    };
    const list = this.clicksByLinkId.get(click.linkId) || [];
    list.push(fullClick);
    this.clicksByLinkId.set(click.linkId, list);
    this.invalidateCache(click.linkId);
    this.schedulePersist();
    return fullClick;
  }

  public listAllPublicLinks(nowMs = Date.now()): ShortLink[] {
    return Array.from(this.linksById.values()).map((rec) => this.toPublicLink(rec, nowMs));
  }

  public getLinkAnalytics(id: string, range: AnalyticsRange): LinkAnalyticsResponse | null {
    const rec = this.linksById.get(id);
    if (!rec) return null;
    const nowMs = Date.now();
    const cacheKey = `${id}:${range}`;
    const cached = this.analyticsCache.get(cacheKey);
    if (cached && cached.expiresAt > nowMs) {
      return cached.data;
    }

    const link = this.toPublicLink(rec, nowMs);
    const clicks = this.clicksByLinkId.get(id) || [];
    const data = computeLinkAnalytics(link, clicks, range, nowMs);
    this.analyticsCache.set(cacheKey, {
      data,
      expiresAt: nowMs + ANALYTICS_CACHE_TTL_MS,
    });
    return data;
  }

  public getOverviewAnalytics(): OverviewAnalyticsResponse {
    const nowMs = Date.now();
    if (this.overviewCache && this.overviewCache.expiresAt > nowMs) {
      return this.overviewCache.data;
    }
    const links = this.listAllPublicLinks(nowMs);
    const allClicks: ClickEvent[] = [];
    for (const list of this.clicksByLinkId.values()) {
      allClicks.push(...list);
    }
    const data = computeOverviewAnalytics(links, allClicks, nowMs);
    this.overviewCache = {
      data,
      expiresAt: nowMs + ANALYTICS_CACHE_TTL_MS,
    };
    return data;
  }

  public isDemoActive(): boolean {
    for (const rec of this.linksById.values()) {
      if (rec.isDemo) return true;
    }
    return false;
  }

  public clearDemoData(): void {
    for (const rec of Array.from(this.linksById.values())) {
      if (rec.isDemo) {
        this.linksById.delete(rec.id);
        this.idByCodeLower.delete(rec.code.toLowerCase());
        this.clicksByLinkId.delete(rec.id);
      }
    }
    for (const sp of Array.from(this.sponsorsById.values())) {
      if (sp.isDemo) {
        this.sponsorsById.delete(sp.id);
      }
    }
    this.invalidateCache();
    this.persistNow();
  }

  public seedDemoData(): void {
    this.clearDemoData();
    const nowMs = Date.now();
    const hourMs = 3600_000;
    const dayMs = 86400_000;

    // Seed sample sponsor/affiliate offers for monetized redirect interstitials
    const sp1: SponsorCampaign = {
      id: 'sp_demo_1',
      ownerId: 'demo',
      title: 'CloudStack Dev Kit — 2 Months Free Credit',
      description: 'Sample sponsor banner slot. Replace with your own affiliate link, newsletter signup, or product promo.',
      ctaLabel: 'Explore Offer',
      ctaUrl: 'https://example.com/sponsor-cloudstack',
      badgeText: 'Sponsored',
      active: true,
      impressions: 214,
      clicks: 19,
      createdAt: new Date(nowMs - 14 * dayMs).toISOString(),
      updatedAt: new Date(nowMs - 2 * dayMs).toISOString(),
      isDemo: true,
    };
    const sp2: SponsorCampaign = {
      id: 'sp_demo_2',
      ownerId: 'demo',
      title: 'Weekly Engineering Digest Newsletter',
      description: 'Zero-spam architectural notes every Tuesday. Ideal slot for your own newsletter or digital download.',
      ctaLabel: 'Subscribe Free',
      ctaUrl: 'https://example.com/newsletter',
      badgeText: 'Partner',
      active: true,
      impressions: 128,
      clicks: 14,
      createdAt: new Date(nowMs - 10 * dayMs).toISOString(),
      updatedAt: new Date(nowMs - 1 * dayMs).toISOString(),
      isDemo: true,
    };
    this.sponsorsById.set(sp1.id, sp1);
    this.sponsorsById.set(sp2.id, sp2);

    const demoSpecs: Array<{
      code: string;
      targetUrl: string;
      tags: string[];
      createdDaysAgo: number;
      expiresOffsetMs: number | null;
      password?: string;
      interstitialEnabled?: boolean;
      sponsorId?: string;
      isDisabled?: boolean;
      clickCount: number;
    }> = [
      {
        code: 'q4-launch',
        targetUrl: 'https://acme-cloud.example/releases/v4-platform',
        tags: ['marketing', 'campaign-q4'],
        createdDaysAgo: 18,
        expiresOffsetMs: 22 * dayMs,
        clickCount: 148,
      },
      {
        code: 'api-guide',
        targetUrl: 'https://developer.mozilla.org/en-US/docs/Web/API',
        tags: ['docs', 'engineering'],
        createdDaysAgo: 26,
        expiresOffsetMs: null,
        clickCount: 94,
      },
      {
        code: 'vip-deck',
        targetUrl: 'https://example.org/investor-memo-2026',
        tags: ['confidential', 'finance'],
        createdDaysAgo: 9,
        expiresOffsetMs: 14 * dayMs,
        password: 'demo',
        clickCount: 41,
      },
      {
        code: 'flash-offer',
        targetUrl: 'https://store.example.com/autumn-collection',
        tags: ['social', 'promo'],
        createdDaysAgo: 4,
        expiresOffsetMs: 30 * dayMs,
        interstitialEnabled: true,
        sponsorId: 'sp_demo_1',
        clickCount: 73,
      },
      {
        code: 'webinar-oct',
        targetUrl: 'https://events.example.com/architecture-summit',
        tags: ['events', 'marketing'],
        createdDaysAgo: 35,
        expiresOffsetMs: -2 * dayMs,
        clickCount: 62,
      },
      {
        code: 'design-kit',
        targetUrl: 'https://tailwindcss.com/docs/theme',
        tags: ['design', 'ui'],
        createdDaysAgo: 12,
        expiresOffsetMs: null,
        interstitialEnabled: true,
        sponsorId: 'sp_demo_2',
        clickCount: 55,
      },
    ];

    const geoPool = [
      { country: 'United States', city: 'San Francisco' },
      { country: 'United States', city: 'New York' },
      { country: 'United Kingdom', city: 'London' },
      { country: 'Germany', city: 'Berlin' },
      { country: 'Canada', city: 'Toronto' },
      { country: 'Japan', city: 'Tokyo' },
      { country: 'France', city: 'Paris' },
      { country: 'Australia', city: 'Sydney' },
      { country: 'Netherlands', city: 'Amsterdam' },
      { country: 'Singapore', city: 'Singapore' },
    ];
    const uaPool: Array<{ deviceType: DeviceType; os: string; browser: string }> = [
      { deviceType: 'desktop', os: 'macOS', browser: 'Chrome' },
      { deviceType: 'desktop', os: 'Windows', browser: 'Edge' },
      { deviceType: 'mobile', os: 'iOS', browser: 'Safari' },
      { deviceType: 'mobile', os: 'Android', browser: 'Chrome' },
      { deviceType: 'desktop', os: 'Linux', browser: 'Firefox' },
      { deviceType: 'tablet', os: 'iOS', browser: 'Safari' },
    ];
    const refPool = ['Direct', 'linkedin.com', 'github.com', 'x.com', 'news.ycombinator.com', 'slack.com'];

    for (let sIdx = 0; sIdx < demoSpecs.length; sIdx++) {
      const spec = demoSpecs[sIdx];
      const id = `lnk_demo_${sIdx + 1}`;
      const createdAt = new Date(nowMs - spec.createdDaysAgo * dayMs).toISOString();
      const expiresAt =
        spec.expiresOffsetMs !== null ? new Date(nowMs + spec.expiresOffsetMs).toISOString() : null;

      const record: StoredLinkRecord = {
        id,
        ownerId: 'demo',
        code: spec.code,
        targetUrl: spec.targetUrl,
        isCustomAlias: true,
        tags: spec.tags,
        createdAt,
        expiresAt,
        passwordHash: spec.password ? hashPassword(spec.password) : null,
        interstitialEnabled: Boolean(spec.interstitialEnabled),
        sponsorId: spec.sponsorId || null,
        isDisabled: Boolean(spec.isDisabled),
        isDemo: true,
      };
      this.linksById.set(id, record);
      this.idByCodeLower.set(spec.code.toLowerCase(), id);

      const clicks: ClickEvent[] = [];
      const maxSpanMs = Math.min(spec.createdDaysAgo * dayMs, 28 * dayMs);
      for (let i = 0; i < spec.clickCount; i++) {
        const seed = (sIdx + 1) * 997 + i * 313;
        const offsetMs = (seed % 1000) / 1000 * maxSpanMs;
        const ts = new Date(nowMs - offsetMs).toISOString();
        const geo = geoPool[seed % geoPool.length];
        const ua = uaPool[(seed >> 2) % uaPool.length];
        const ref = refPool[(seed >> 3) % refPool.length];
        clicks.push({
          id: `clk_demo_${sIdx}_${i}`,
          linkId: id,
          timestamp: ts,
          country: geo.country,
          city: geo.city,
          deviceType: ua.deviceType,
          os: ua.os,
          browser: ua.browser,
          referrer: ref,
          isUnique: i % 3 !== 0,
        });
      }
      this.clicksByLinkId.set(id, clicks);
    }

    this.demoSeeded = true;
    this.invalidateCache();
    this.persistNow();
  }
}
