/**
 * Shared domain types used by both the Express API and React frontend.
 */

export type LinkStatus = 'active' | 'expired' | 'disabled';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export type AnalyticsRange = '24h' | '7d' | '30d' | '90d' | 'all';

export type ExpirationPreset = 'never' | '1h' | '24h' | '7d' | '30d' | 'custom';

export type UserPlan = 'free' | 'pro';

export interface SponsorCampaign {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaUrl: string;
  badgeText: string;
  active: boolean;
  impressions: number;
  clicks: number;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export interface AdNetworkConfig {
  enabled: boolean;
  networkType: 'banner_html' | 'direct_link' | 'image_banner';
  networkName: string;
  bannerHtml?: string;
  bannerImageUrl?: string;
  bannerTargetUrl?: string;
  directAdUrl?: string;
  showOnInterstitial: boolean;
  showOnHomepage: boolean;
  updatedAt: string;
}

export interface BillingStatusResponse {
  stripeConfigured: boolean;
  plan: UserPlan;
  uid: string | null;
  activeLinksCount: number;
  maxFreeLinks: number;
  priceMonthlyUsd: number;
  hasStripeCustomer: boolean;
}

export interface ShortLink {
  /** Public nanoid identifier (never sequential internal ID) */
  id: string;
  /** Optional authenticated owner UID */
  ownerId?: string | null;
  /** Short code or custom alias (e.g., "my-brand" or "x7K9mQ") */
  code: string;
  /** Sanitized destination URL */
  targetUrl: string;
  /** Original raw URL submitted before tracking-parameter stripping */
  originalInputUrl?: string;
  /** Optional custom alias flag */
  isCustomAlias: boolean;
  /** Optional descriptive tags */
  tags: string[];
  /** Creation timestamp in UTC ISO-8601 */
  createdAt: string;
  /** Optional expiration timestamp in UTC ISO-8601 */
  expiresAt: string | null;
  /** Whether link requires password verification before redirect */
  isPasswordProtected: boolean;
  /** Whether link shows a monetized sponsor interstitial before redirecting */
  interstitialEnabled: boolean;
  /** Optional specific sponsor campaign ID */
  sponsorId?: string | null;
  /** Whether link has been manually disabled */
  isDisabled: boolean;
  /** Computed current status */
  status: LinkStatus;
  /** Total click count */
  clicks: number;
  /** Unique visitor count */
  uniqueClicks: number;
  /** Last click timestamp in UTC ISO-8601 */
  lastClickedAt: string | null;
  /** True if preloaded by demo mode */
  isDemo?: boolean;
}

export interface ClickEvent {
  id: string;
  linkId: string;
  timestamp: string;
  country: string;
  city: string;
  deviceType: DeviceType;
  os: string;
  browser: string;
  referrer: string;
  isUnique: boolean;
}

export interface TimeSeriesPoint {
  label: string;
  bucketStart: string;
  total: number;
  unique: number;
}

export interface BreakdownItem {
  label: string;
  count: number;
  percentage: number;
}

export interface ReferrerItem {
  referrer: string;
  clicks: number;
  uniqueClicks: number;
  share: number;
}

export interface HeatmapCell {
  /** 0 = Sunday .. 6 = Saturday */
  dayOfWeek: number;
  /** 0..23 UTC hour */
  hour: number;
  count: number;
}

export interface LinkAnalyticsResponse {
  link: ShortLink;
  range: AnalyticsRange;
  totalClicks: number;
  uniqueClicks: number;
  topCountry: string;
  topDevice: string;
  timeSeries: TimeSeriesPoint[];
  countries: BreakdownItem[];
  devices: BreakdownItem[];
  operatingSystems: BreakdownItem[];
  browsers: BreakdownItem[];
  referrers: ReferrerItem[];
  heatmap: HeatmapCell[];
  generatedAt: string;
}

export interface OverviewAnalyticsResponse {
  totalLinks: number;
  activeLinks: number;
  expiredLinks: number;
  protectedLinks: number;
  totalClicks: number;
  uniqueClicks: number;
  mostPopularLink: ShortLink | null;
  recentClicks24h: number;
  topCountries: BreakdownItem[];
  dailyTrend: TimeSeriesPoint[];
  generatedAt: string;
}

export interface PaginatedLinksResponse {
  items: ShortLink[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableTags: string[];
}

export interface CreateLinkPayload {
  url: string;
  customAlias?: string;
  expiresAt?: string | null;
  password?: string;
  tags?: string[];
  interstitialEnabled?: boolean;
  sponsorId?: string | null;
}

export interface BulkCreateItemResult {
  input: string;
  success: boolean;
  link?: ShortLink;
  error?: string;
}

export interface GateStatusResponse {
  code: string;
  state: 'active' | 'interstitial' | 'password_required' | 'expired' | 'disabled' | 'not_found';
  expiresAt: string | null;
  targetUrl?: string;
  sponsor?: SponsorCampaign | null;
  adNetwork?: AdNetworkConfig | null;
  waitSeconds?: number;
  isPreview?: boolean;
}
