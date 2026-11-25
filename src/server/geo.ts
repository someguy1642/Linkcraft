import type { Request } from 'express';

export interface GeoLocation {
  country: string;
  city: string;
}

const geoCache = new Map<string, { value: GeoLocation; expiresAt: number }>();

function isPrivateOrLocalIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (
    !clean ||
    clean === '::1' ||
    clean === '127.0.0.1' ||
    clean === 'localhost' ||
    clean.startsWith('10.') ||
    clean.startsWith('192.168.') ||
    clean.startsWith('fc') ||
    clean.startsWith('fd') ||
    clean.startsWith('fe80:')
  ) {
    return true;
  }
  const match172 = /^172\.(\d+)\./.exec(clean);
  if (match172) {
    const second = Number(match172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

const REGION_NAMES: Record<string, string> = {
  US: 'United States',
  GB: 'United Kingdom',
  DE: 'Germany',
  FR: 'France',
  CA: 'Canada',
  JP: 'Japan',
  AU: 'Australia',
  NL: 'Netherlands',
  SG: 'Singapore',
  IN: 'India',
  BR: 'Brazil',
  SE: 'Sweden',
};

/**
 * Resolves country & city asynchronously without blocking the redirect response.
 * Checks proxy headers first, then falls back to cached public IP geolocation with a 350ms timeout.
 */
export async function resolveGeoLocation(req: Request, clientIp: string): Promise<GeoLocation> {
  const cfCountry = req.header('cf-ipcountry') || req.header('x-vercel-ip-country') || req.header('x-appengine-country');
  const headerCity = req.header('x-vercel-ip-city') || req.header('x-appengine-city') || '';

  if (cfCountry && cfCountry.length === 2 && cfCountry !== 'XX') {
    const code = cfCountry.toUpperCase();
    return {
      country: REGION_NAMES[code] || code,
      city: headerCity ? decodeURIComponent(headerCity) : 'Unknown',
    };
  }

  const cleanIp = clientIp.replace(/^::ffff:/, '').trim();
  if (isPrivateOrLocalIp(cleanIp)) {
    return { country: 'Local / Private', city: 'Localhost' };
  }

  const now = Date.now();
  const cached = geoCache.get(cleanIp);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 350);
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/json/`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Linkcraft/1.0' },
    });
    clearTimeout(timer);

    if (response.ok) {
      const data = (await response.json()) as { country_name?: string; city?: string };
      if (data && data.country_name) {
        const result: GeoLocation = {
          country: data.country_name,
          city: data.city || 'Unknown',
        };
        geoCache.set(cleanIp, { value: result, expiresAt: now + 3600_000 });
        return result;
      }
    }
  } catch {
    // Graceful fallback when external geo service is unreachable or times out
  }

  return { country: 'Unknown', city: 'Unknown' };
}
