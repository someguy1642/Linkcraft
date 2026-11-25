import type { DeviceType } from './types';

export interface ParsedUserAgent {
  deviceType: DeviceType;
  os: string;
  browser: string;
}

/**
 * Lightweight deterministic User-Agent parser for click analytics.
 */
export function parseUserAgent(uaRaw: string | undefined): ParsedUserAgent {
  const ua = (uaRaw || '').trim();
  if (!ua) {
    return { deviceType: 'desktop', os: 'Unknown', browser: 'Unknown' };
  }

  // Device type detection
  let deviceType: DeviceType = 'desktop';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (
    /mobile|iphone|ipod|blackberry|iemobile|opera mini|windows phone|android.*mobile/i.test(ua)
  ) {
    deviceType = 'mobile';
  }

  // OS detection (order matters: iOS before macOS because iOS UA includes "like Mac OS X")
  let os = 'Other';
  if (/iphone|ipad|ipod/i.test(ua)) {
    os = 'iOS';
  } else if (/android/i.test(ua)) {
    os = 'Android';
  } else if (/windows nt|win64|win32/i.test(ua)) {
    os = 'Windows';
  } else if (/mac os x|macintosh/i.test(ua)) {
    os = 'macOS';
  } else if (/cros/i.test(ua)) {
    os = 'ChromeOS';
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  // Browser detection (order matters: Edge/Opera before Chrome, Chrome before Safari)
  let browser = 'Other';
  if (/edg\//i.test(ua) || /edge\//i.test(ua)) {
    browser = 'Edge';
  } else if (/opr\//i.test(ua) || /opera/i.test(ua)) {
    browser = 'Opera';
  } else if (/firefox|fxios/i.test(ua)) {
    browser = 'Firefox';
  } else if (/chrome|crios/i.test(ua) && !/chromium/i.test(ua)) {
    browser = 'Chrome';
  } else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) {
    browser = 'Safari';
  } else if (/curl|wget|python|postman|insomnia|bot|spider|crawler/i.test(ua)) {
    browser = 'API / Bot';
  }

  return { deviceType, os, browser };
}

/**
 * Extracts a clean referrer host or "Direct" from the HTTP Referer header.
 */
export function parseReferrerHost(refererHeader: string | undefined, selfHost?: string): string {
  if (!refererHeader || typeof refererHeader !== 'string') return 'Direct';
  try {
    const parsed = new URL(refererHeader);
    const host = parsed.hostname.toLowerCase();
    if (!host) return 'Direct';
    if (selfHost && host === selfHost.toLowerCase().split(':')[0]) {
      return 'Direct';
    }
    return host.replace(/^www\./, '');
  } catch {
    return 'Direct';
  }
}
