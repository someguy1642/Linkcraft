import type { ExpirationPreset, LinkStatus } from './types';

export const MAX_URL_LENGTH = 2048;

export const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
]);

export const RESERVED_ALIASES = new Set([
  'admin',
  'administrator',
  'api',
  'login',
  'logout',
  'signin',
  'signup',
  'register',
  'static',
  'assets',
  'src',
  'public',
  'health',
  'docs',
  'openapi',
  'swagger',
  'analytics',
  'links',
  'gate',
  'r',
  'favicon',
  'robots',
  'sitemap',
  'dashboard',
  'settings',
  'account',
  'auth',
  'oauth',
  'well-known',
]);

const DANGEROUS_SCHEME_RE = /^(javascript|data|file|vbscript|blob|about|mailto|tel):/i;
const PROTOCOL_PREFIX_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const DOMAIN_HOST_RE = /^(?:[a-zA-Z0-9\u00a1-\uffff-]+\.)+[a-zA-Z\u00a1-\uffff]{2,63}$|^localhost$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const ALIAS_RE = /^[a-zA-Z0-9_-]{3,30}$/;

export interface UrlValidationResult {
  valid: boolean;
  sanitizedUrl?: string;
  autoPrependedProtocol?: boolean;
  strippedTrackingParams: string[];
  error?: string;
}

/**
 * Validates and sanitizes an input URL:
 * - Rejects dangerous schemes (javascript:, data:, file:, etc.)
 * - Auto-prepends https:// if missing a scheme
 * - Validates via URL constructor + domain regex (supports IDN / punycode)
 * - Strips known tracking parameters (UTM, fbclid, gclid, etc.)
 * - Removes redundant slashes in pathname and normalizes protocol/hostname case
 */
export function validateAndSanitizeUrl(rawInput: string): UrlValidationResult {
  if (typeof rawInput !== 'string') {
    return { valid: false, strippedTrackingParams: [], error: 'URL must be a string.' };
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, strippedTrackingParams: [], error: 'Please enter a URL to shorten.' };
  }

  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: `URL exceeds the maximum length of ${MAX_URL_LENGTH} characters.`,
    };
  }

  if (/[\s\u0000-\u001F\u007F]/.test(trimmed)) {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'URL cannot contain spaces or control characters.',
    };
  }

  if (DANGEROUS_SCHEME_RE.test(trimmed)) {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'Unsupported or unsafe URL protocol. Only http:// and https:// are allowed.',
    };
  }

  let candidate = trimmed;
  let autoPrependedProtocol = false;

  if (!PROTOCOL_PREFIX_RE.test(candidate)) {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) {
      return {
        valid: false,
        strippedTrackingParams: [],
        error: 'Only http:// and https:// URLs are supported.',
      };
    }
    candidate = `https://${candidate}`;
    autoPrependedProtocol = true;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'That does not look like a valid web address.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'Only http:// and https:// URLs are allowed.',
    };
  }

  // Strip username/password credentials if provided for safety
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'URLs containing embedded credentials are not allowed.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isIpv4 = IPV4_RE.test(hostname);
  const isValidIpv4 =
    isIpv4 &&
    hostname.split('.').every((octet) => {
      const n = Number(octet);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });

  if (!hostname || (!DOMAIN_HOST_RE.test(hostname) && !isValidIpv4)) {
    return {
      valid: false,
      strippedTrackingParams: [],
      error: 'Please enter a URL with a valid domain name (e.g., example.com).',
    };
  }

  // Strip tracking query parameters
  const strippedTrackingParams: string[] = [];
  const nextParams = new URLSearchParams();
  parsed.searchParams.forEach((value, key) => {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
      strippedTrackingParams.push(key);
    } else {
      nextParams.append(key, value);
    }
  });

  // Normalize redundant slashes in pathname (e.g., //docs///intro -> /docs/intro)
  const cleanPathname = parsed.pathname.replace(/\/{2,}/g, '/');
  parsed.pathname = cleanPathname;

  const queryString = nextParams.toString();
  const normalizedSearch = queryString ? `?${queryString}` : '';
  const portSegment = parsed.port ? `:${parsed.port}` : '';
  const pathPart =
    parsed.pathname === '/' && !normalizedSearch && !parsed.hash ? '' : parsed.pathname;

  const sanitizedUrl = `${parsed.protocol}//${hostname}${portSegment}${pathPart}${normalizedSearch}${parsed.hash}`;

  if (sanitizedUrl.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      strippedTrackingParams,
      error: `Sanitized URL exceeds ${MAX_URL_LENGTH} characters.`,
    };
  }

  return {
    valid: true,
    sanitizedUrl,
    autoPrependedProtocol,
    strippedTrackingParams,
  };
}

export interface AliasValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Validates custom aliases: 3–30 chars, alphanumeric + hyphens + underscores, not reserved.
 */
export function validateAlias(rawAlias: string): AliasValidationResult {
  const trimmed = rawAlias.trim();
  if (!trimmed) {
    return { valid: true, normalized: '' };
  }

  if (trimmed.length < 3 || trimmed.length > 30) {
    return {
      valid: false,
      error: 'Custom alias must be between 3 and 30 characters.',
    };
  }

  if (!ALIAS_RE.test(trimmed)) {
    return {
      valid: false,
      error: 'Only letters, numbers, hyphens (-), and underscores (_) are allowed.',
    };
  }

  if (RESERVED_ALIASES.has(trimmed.toLowerCase())) {
    return {
      valid: false,
      error: `"${trimmed}" is a reserved system path and cannot be used.`,
    };
  }

  return { valid: true, normalized: trimmed };
}

/**
 * Sanitizes plain text fields (e.g. tags) to neutralize XSS payloads and excessive length.
 */
export function sanitizeText(input: string, maxLength = 32): string {
  return input
    .replace(/[<>'"`\\]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Normalizes a list of tag strings.
 */
export function normalizeTags(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const clean = sanitizeText(t.toLowerCase(), 24).replace(/\s+/g, '-');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Computes UTC ISO expiration timestamp from a preset or custom date string.
 */
export function parseExpirationPreset(
  preset: ExpirationPreset,
  customDateIso?: string | null,
  nowMs = Date.now(),
): string | null {
  switch (preset) {
    case 'never':
      return null;
    case '1h':
      return new Date(nowMs + 60 * 60 * 1000).toISOString();
    case '24h':
      return new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString();
    case '30d':
      return new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString();
    case 'custom': {
      if (!customDateIso) return null;
      const ms = Date.parse(customDateIso);
      if (Number.isNaN(ms)) return null;
      return new Date(ms).toISOString();
    }
    default:
      return null;
  }
}

export function isLinkExpired(expiresAt: string | null, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms <= nowMs;
}

export function computeLinkStatus(
  isDisabled: boolean,
  expiresAt: string | null,
  nowMs = Date.now(),
): LinkStatus {
  if (isDisabled) return 'disabled';
  if (isLinkExpired(expiresAt, nowMs)) return 'expired';
  return 'active';
}

export function formatTimeRemaining(expiresAt: string | null, nowMs = Date.now()): string {
  if (!expiresAt) return 'No expiration';
  const targetMs = Date.parse(expiresAt);
  if (Number.isNaN(targetMs)) return 'No expiration';

  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return 'Expired';

  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return 'Expires in <1m';
  if (totalMinutes < 60) return `Expires in ${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remMinutes > 0 ? `Expires in ${totalHours}h ${remMinutes}m` : `Expires in ${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `Expires in ${days}d ${remHours}h` : `Expires in ${days}d`;
}
