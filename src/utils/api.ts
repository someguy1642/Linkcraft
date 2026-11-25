import { auth } from '../firebase';
import type {
  AnalyticsRange,
  BillingStatusResponse,
  BulkCreateItemResult,
  CreateLinkPayload,
  GateStatusResponse,
  LinkAnalyticsResponse,
  OverviewAnalyticsResponse,
  PaginatedLinksResponse,
  ShortLink,
  SponsorCampaign,
  AdNetworkConfig,
} from '../shared/types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly retryAfterSeconds?: number;
  public readonly code?: string;
  public readonly configured?: boolean;

  constructor(
    message: string,
    status: number,
    options?: { retryAfterSeconds?: number; code?: string; configured?: boolean },
  ) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.code = options?.code;
    this.configured = options?.configured;
  }
}

let cachedCsrfToken: string | null = null;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal, credentials: 'same-origin' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check your connection and try again.', 408);
    }
    throw new ApiError('Network connection unavailable. Check your internet connection.', 0);
  } finally {
    clearTimeout(timer);
  }
}

async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (cachedCsrfToken && !forceRefresh) {
    return cachedCsrfToken;
  }
  const res = await fetchWithTimeout('/api/csrf-token');
  if (!res.ok) {
    throw new ApiError('Could not establish secure session token.', res.status);
  }
  const data = (await res.json()) as { csrfToken: string };
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken;
}

async function getBearerHeader(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    const token = await user.getIdToken();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  retryOnCsrf = true,
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (!headers.has('Authorization')) {
    const bearer = await getBearerHeader();
    if (bearer) {
      headers.set('Authorization', bearer);
    }
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const token = await ensureCsrfToken();
    headers.set('X-CSRF-Token', token);
  }

  const res = await fetchWithTimeout(url, { ...options, headers });

  if (res.status === 403 && retryOnCsrf && method !== 'GET') {
    await ensureCsrfToken(true);
    return apiRequest<T>(url, options, false);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let retryAfterSeconds: number | undefined;
    let code: string | undefined;
    let configured: boolean | undefined;
    if (contentType.includes('application/json')) {
      const errBody = (await res.json()) as {
        error?: string;
        retryAfterSeconds?: number;
        code?: string;
        configured?: boolean;
      };
      if (errBody.error) message = errBody.error;
      retryAfterSeconds = errBody.retryAfterSeconds;
      code = errBody.code;
      configured = errBody.configured;
    }
    throw new ApiError(message, res.status, { retryAfterSeconds, code, configured });
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export interface ListLinksParams {
  search?: string;
  status?: string;
  tag?: string;
  minClicks?: string;
  maxClicks?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'createdAt' | 'clicks' | 'code';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const api = {
  async checkAlias(alias: string): Promise<{ valid: boolean; available: boolean; reason?: string }> {
    return apiRequest(`/api/alias/check?alias=${encodeURIComponent(alias)}`);
  },

  async createLink(
    payload: CreateLinkPayload,
  ): Promise<{
    link: ShortLink;
    sanitization: { autoPrependedProtocol: boolean; strippedTrackingParams: string[] };
  }> {
    return apiRequest('/api/links', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async bulkCreateLinks(payload: {
    urls: string[];
    expiresAt?: string | null;
    tags?: string[];
    interstitialEnabled?: boolean;
    sponsorId?: string | null;
  }): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    results: BulkCreateItemResult[];
  }> {
    return apiRequest('/api/links/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listLinks(params: ListLinksParams = {}): Promise<PaginatedLinksResponse> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        qs.set(k, String(v));
      }
    }
    return apiRequest(`/api/links?${qs.toString()}`);
  },

  async updateLink(
    id: string,
    patch: {
      expiresAt?: string | null;
      isDisabled?: boolean;
      tags?: string[];
      password?: string | null;
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    },
  ): Promise<{ link: ShortLink }> {
    return apiRequest(`/api/links/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async deleteLink(id: string): Promise<{ ok: boolean }> {
    return apiRequest(`/api/links/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async bulkAction(
    action: 'delete' | 'disable' | 'activate',
    ids: string[],
  ): Promise<{ ok: boolean; affected: number }> {
    return apiRequest('/api/links/bulk-action', {
      method: 'POST',
      body: JSON.stringify({ action, ids }),
    });
  },

  async exportLinks(format: 'csv' | 'json', ids: string[]): Promise<void> {
    const action = format === 'csv' ? 'export-csv' : 'export-json';
    const token = await ensureCsrfToken();
    const bearer = await getBearerHeader();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'X-Requested-With': 'XMLHttpRequest',
    };
    if (bearer) headers.Authorization = bearer;

    const res = await fetchWithTimeout('/api/links/bulk-action', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ids }),
    });
    if (!res.ok) {
      throw new ApiError('Failed to export selected links.', res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? 'linkcraft-export.csv' : 'linkcraft-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async getOverviewAnalytics(): Promise<OverviewAnalyticsResponse> {
    return apiRequest('/api/analytics/overview');
  },

  async getLinkAnalytics(id: string, range: AnalyticsRange): Promise<LinkAnalyticsResponse> {
    return apiRequest(`/api/links/${encodeURIComponent(id)}/analytics?range=${range}`);
  },

  async getDemoStatus(): Promise<{ demoActive: boolean; totalLinks: number }> {
    return apiRequest('/api/demo/status');
  },

  async loadDemoData(): Promise<{ demoActive: boolean; totalLinks: number }> {
    return apiRequest('/api/demo/load', { method: 'POST' });
  },

  async clearDemoData(): Promise<{ demoActive: boolean; totalLinks: number }> {
    return apiRequest('/api/demo/clear', { method: 'POST' });
  },

  async getGateStatus(code: string): Promise<GateStatusResponse> {
    const res = await fetchWithTimeout(`/api/gate/${encodeURIComponent(code)}`);
    if (res.status === 404) {
      return { code, state: 'not_found', expiresAt: null };
    }
    if (!res.ok) {
      throw new ApiError('Unable to check link status.', res.status);
    }
    return (await res.json()) as GateStatusResponse;
  },

  async continueGate(code: string): Promise<{ targetUrl: string }> {
    return apiRequest(`/api/gate/${encodeURIComponent(code)}/continue`, {
      method: 'POST',
    });
  },

  async unlockGate(code: string, password: string): Promise<{ targetUrl: string }> {
    return apiRequest(`/api/gate/${encodeURIComponent(code)}/unlock`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  // Sponsors & Monetization
  async listSponsors(): Promise<{ sponsors: SponsorCampaign[] }> {
    return apiRequest('/api/sponsors');
  },

  async createSponsor(payload: {
    title: string;
    description: string;
    ctaLabel: string;
    ctaUrl: string;
    badgeText?: string;
    active?: boolean;
  }): Promise<{ sponsor: SponsorCampaign }> {
    return apiRequest('/api/sponsors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateSponsor(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      ctaLabel: string;
      ctaUrl: string;
      badgeText: string;
      active: boolean;
    }>,
  ): Promise<{ sponsor: SponsorCampaign }> {
    return apiRequest(`/api/sponsors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async deleteSponsor(id: string): Promise<{ ok: boolean }> {
    return apiRequest(`/api/sponsors/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async recordSponsorClick(id: string): Promise<{ ok: boolean; ctaUrl: string; sponsor: SponsorCampaign }> {
    return apiRequest(`/api/sponsors/${encodeURIComponent(id)}/click`, {
      method: 'POST',
    });
  },

  // Billing & Subscriptions
  async getBillingStatus(): Promise<BillingStatusResponse> {
    return apiRequest('/api/billing/status');
  },

  async createCheckoutSession(): Promise<{ url: string | null }> {
    return apiRequest('/api/billing/create-checkout-session', {
      method: 'POST',
    });
  },

  async verifyCheckoutSession(sessionId: string): Promise<BillingStatusResponse> {
    return apiRequest('/api/billing/verify-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  },

  async openBillingPortal(): Promise<{ url: string }> {
    return apiRequest('/api/billing/portal', {
      method: 'POST',
    });
  },

  // Ad Networks & Banner Configuration
  async getAdSettings(): Promise<{ adConfig: AdNetworkConfig }> {
    return apiRequest('/api/ads');
  },

  async saveAdSettings(config: Partial<AdNetworkConfig>): Promise<{ adConfig: AdNetworkConfig }> {
    return apiRequest('/api/ads', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },
};
