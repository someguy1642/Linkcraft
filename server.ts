import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  type AuthenticatedRequest,
  optionalAuthMiddleware,
  requireAuthMiddleware,
} from './src/server/auth';
import {
  getStripeClient,
  getStripePriceId,
  isBillingConfigured,
  MAX_FREE_ACTIVE_LINKS,
  PRO_PRICE_MONTHLY_USD,
  resolveRequestOrigin,
} from './src/server/billing';
import { resolveGeoLocation } from './src/server/geo';
import { buildOpenApiSpec } from './src/server/openapi';
import {
  apiRateLimitMiddleware,
  corsMiddleware,
  csrfProtectionMiddleware,
  getClientIp,
  issueCsrfToken,
  linkCreateRateLimiter,
  passwordUnlockRateLimiter,
  securityHeadersMiddleware,
  verifyPassword,
} from './src/server/security';
import { LinkStore, type StoredLinkRecord } from './src/server/store';
import type { AnalyticsRange, BulkCreateItemResult, BillingStatusResponse } from './src/shared/types';
import { parseReferrerHost, parseUserAgent } from './src/shared/uaParser';
import {
  computeLinkStatus,
  isLinkExpired,
  normalizeTags,
  RESERVED_ALIASES,
  sanitizeText,
  validateAlias,
  validateAndSanitizeUrl,
} from './src/shared/urlUtils';

const PORT = Number(process.env.PORT) || 3000;
const VISITOR_HASH_SECRET =
  process.env.VISITOR_HASH_SECRET ||
  (process.env.VERCEL
    ? process.env.VERCEL_PROJECT_ID || 'linkcraft-vercel-visitor-salt'
    : crypto.randomBytes(32).toString('hex'));
const seenVisitorKeys = new Set<string>();
const SPA_ROUTES = new Set([
  '',
  'links',
  'analytics',
  'monetize',
  'docs',
  'gate',
  'index.html',
]);

function recordVisitAsync(req: Request, _res: Response, rec: StoredLinkRecord): void {
  const clientIp = getClientIp(req);
  const ua = req.header('user-agent') || '';
  const utcDay = new Date().toISOString().slice(0, 10);

  // Cookie-free daily salted hash for unique visitor detection without setting any cookies
  const visitorKey = crypto
    .createHmac('sha256', VISITOR_HASH_SECRET)
    .update(`${clientIp}|${ua}|${rec.id}|${utcDay}`)
    .digest('hex');

  const isUnique = !seenVisitorKeys.has(visitorKey);
  seenVisitorKeys.add(visitorKey);
  if (seenVisitorKeys.size > 50_000) {
    seenVisitorKeys.clear();
  }

  const { deviceType, os, browser } = parseUserAgent(ua);
  const referrer = parseReferrerHost(req.header('referer'), req.header('host'));
  const timestamp = new Date().toISOString();

  // Enrich geolocation asynchronously so redirect stays sub-10ms
  void resolveGeoLocation(req, clientIp).then((geo) => {
    store.recordClick({
      linkId: rec.id,
      timestamp,
      country: geo.country,
      city: geo.city,
      deviceType,
      os,
      browser,
      referrer,
      isUnique,
    });
  });
}

function escapeCsvCell(value: string | number | boolean): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const store = new LinkStore();

function buildBillingStatus(uid: string | null): BillingStatusResponse {
  const billing = uid ? store.getUserBilling(uid) : null;
  const activeLinksCount = uid ? store.countLinksForOwner(uid) : 0;
  return {
    stripeConfigured: isBillingConfigured(),
    plan: billing?.plan || 'free',
    uid,
    activeLinksCount,
    maxFreeLinks: MAX_FREE_ACTIVE_LINKS,
    priceMonthlyUsd: PRO_PRICE_MONTHLY_USD,
    hasStripeCustomer: Boolean(billing?.stripeCustomerId),
  };
}

export async function createApp(): Promise<Express> {
  await store.init();
  const app = express();
  app.set('trust proxy', true);

  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);

  // Stripe Webhook must receive raw body before express.json()
  app.post(
    '/api/billing/webhook',
    express.raw({ type: 'application/json' }),
    (req, res) => {
      const stripe = getStripeClient();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
      const signature = req.header('stripe-signature');

      if (!stripe || !webhookSecret) {
        res.status(503).json({ configured: false, error: 'Stripe webhook secret is not configured.' });
        return;
      }
      if (!signature) {
        res.status(400).json({ error: 'Missing Stripe-Signature header.' });
        return;
      }

      try {
        const event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const uid = session.metadata?.uid;
          if (uid && (session.payment_status === 'paid' || session.status === 'complete')) {
            store.setUserBilling({
              uid,
              plan: 'pro',
              stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
              stripeSubscriptionId:
                typeof session.subscription === 'string' ? session.subscription : undefined,
              updatedAt: new Date().toISOString(),
            });
          }
        } else if (event.type === 'customer.subscription.deleted') {
          const sub = event.data.object;
          const customerId = typeof sub.customer === 'string' ? sub.customer : '';
          const uid = sub.metadata?.uid || (customerId ? store.findUidByStripeCustomer(customerId) : null);
          if (uid) {
            const prev = store.getUserBilling(uid);
            store.setUserBilling({
              ...prev,
              uid,
              plan: 'free',
              updatedAt: new Date().toISOString(),
            });
          }
        } else if (event.type === 'customer.subscription.updated') {
          const sub = event.data.object;
          const customerId = typeof sub.customer === 'string' ? sub.customer : '';
          const uid = sub.metadata?.uid || (customerId ? store.findUidByStripeCustomer(customerId) : null);
          if (uid) {
            const isActive = sub.status === 'active' || sub.status === 'trialing';
            const prev = store.getUserBilling(uid);
            store.setUserBilling({
              ...prev,
              uid,
              plan: isActive ? 'pro' : 'free',
              stripeCustomerId: customerId || prev.stripeCustomerId,
              stripeSubscriptionId: sub.id,
              updatedAt: new Date().toISOString(),
            });
          }
        }

        res.json({ received: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Webhook signature verification failed.',
        });
      }
    },
  );

  app.use(express.json({ limit: '256kb' }));

  // Health & OpenAPI endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApiSpec(resolveRequestOrigin(req)));
  });

  // Apply API rate limiting and CSRF protection to /api/*
  app.use('/api', apiRateLimitMiddleware);

  app.get('/api/csrf-token', (_req, res) => {
    const csrfToken = issueCsrfToken();
    res.json({ csrfToken });
  });

  app.use('/api', csrfProtectionMiddleware);

  // Billing & Account Status endpoints
  app.get('/api/billing/status', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    res.json(buildBillingStatus(req.user?.uid || null));
  });

  app.post('/api/billing/create-checkout-session', requireAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    const stripe = getStripeClient();
    const priceId = getStripePriceId();
    if (!stripe || !priceId) {
      res.status(503).json({
        configured: false,
        error: 'Stripe billing is not configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID in AI Studio Secrets.',
      });
      return;
    }

    const uid = req.user!.uid;
    const billing = store.getUserBilling(uid);
    const origin = resolveRequestOrigin(req);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        customer: billing.stripeCustomerId || undefined,
        customer_email: !billing.stripeCustomerId && req.user!.email ? req.user!.email : undefined,
        metadata: { uid },
        subscription_data: { metadata: { uid } },
        success_url: `${origin}/?checkout_session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?billing=cancelled`,
      });
      res.json({ url: session.url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to initialize Stripe Checkout session.',
      });
    }
  });

  app.post('/api/billing/verify-session', requireAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    const stripe = getStripeClient();
    if (!stripe) {
      res.status(503).json({
        configured: false,
        error: 'Stripe billing is not configured.',
      });
      return;
    }

    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (!sessionId) {
      res.status(400).json({ error: 'Missing checkout sessionId.' });
      return;
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const uid = req.user!.uid;
      if (session.metadata?.uid !== uid) {
        res.status(403).json({ error: 'Checkout session does not belong to the signed-in account.' });
        return;
      }

      if (session.payment_status === 'paid' || session.status === 'complete') {
        store.setUserBilling({
          uid,
          plan: 'pro',
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
          stripeSubscriptionId:
            typeof session.subscription === 'string' ? session.subscription : undefined,
          updatedAt: new Date().toISOString(),
        });
      }

      res.json(buildBillingStatus(uid));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to verify Stripe Checkout session.',
      });
    }
  });

  app.post('/api/billing/portal', requireAuthMiddleware, async (req: AuthenticatedRequest, res) => {
    const stripe = getStripeClient();
    if (!stripe) {
      res.status(503).json({
        configured: false,
        error: 'Stripe billing is not configured.',
      });
      return;
    }

    const uid = req.user!.uid;
    const billing = store.getUserBilling(uid);
    if (!billing.stripeCustomerId) {
      res.status(400).json({ error: 'No Stripe customer record found for this account yet.' });
      return;
    }

    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: resolveRequestOrigin(req),
      });
      res.json({ url: portalSession.url });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to open Stripe billing portal.',
      });
    }
  });

  // Sponsor & Affiliate Interstitial Campaign routes
  app.get('/api/sponsors', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const sponsors = store.listSponsors(req.user?.uid || null);
    res.json({ sponsors });
  });

  app.post('/api/sponsors', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      title?: string;
      description?: string;
      ctaLabel?: string;
      ctaUrl?: string;
      badgeText?: string;
      active?: boolean;
    };

    const title = sanitizeText(String(body.title || ''), 80);
    const description = sanitizeText(String(body.description || ''), 200);
    const ctaLabel = sanitizeText(String(body.ctaLabel || ''), 30);
    const badgeText = sanitizeText(String(body.badgeText || 'Sponsored'), 24) || 'Sponsored';
    const urlCheck = validateAndSanitizeUrl(String(body.ctaUrl || ''));

    if (title.length < 3) {
      res.status(400).json({ error: 'Sponsor headline must be at least 3 characters.' });
      return;
    }
    if (ctaLabel.length < 2) {
      res.status(400).json({ error: 'CTA button label must be at least 2 characters.' });
      return;
    }
    if (!urlCheck.valid || !urlCheck.sanitizedUrl) {
      res.status(400).json({ error: urlCheck.error || 'Enter a valid http(s) destination URL for the offer.' });
      return;
    }

    const sponsor = store.createSponsor({
      ownerId: req.user?.uid || 'guest',
      title,
      description,
      ctaLabel,
      ctaUrl: urlCheck.sanitizedUrl,
      badgeText,
      active: body.active !== false,
    });
    res.status(201).json({ sponsor });
  });

  app.patch('/api/sponsors/:id', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      title?: string;
      description?: string;
      ctaLabel?: string;
      ctaUrl?: string;
      badgeText?: string;
      active?: boolean;
    };

    const patch: Partial<{
      title: string;
      description: string;
      ctaLabel: string;
      ctaUrl: string;
      badgeText: string;
      active: boolean;
    }> = {};

    if (body.title !== undefined) {
      const title = sanitizeText(String(body.title), 80);
      if (title.length < 3) {
        res.status(400).json({ error: 'Sponsor headline must be at least 3 characters.' });
        return;
      }
      patch.title = title;
    }
    if (body.description !== undefined) {
      patch.description = sanitizeText(String(body.description), 200);
    }
    if (body.ctaLabel !== undefined) {
      const ctaLabel = sanitizeText(String(body.ctaLabel), 30);
      if (ctaLabel.length < 2) {
        res.status(400).json({ error: 'CTA button label must be at least 2 characters.' });
        return;
      }
      patch.ctaLabel = ctaLabel;
    }
    if (body.ctaUrl !== undefined) {
      const urlCheck = validateAndSanitizeUrl(String(body.ctaUrl));
      if (!urlCheck.valid || !urlCheck.sanitizedUrl) {
        res.status(400).json({ error: urlCheck.error || 'Invalid sponsor CTA URL.' });
        return;
      }
      patch.ctaUrl = urlCheck.sanitizedUrl;
    }
    if (body.badgeText !== undefined) {
      patch.badgeText = sanitizeText(String(body.badgeText), 24) || 'Sponsored';
    }
    if (body.active !== undefined) {
      patch.active = Boolean(body.active);
    }

    const updated = store.updateSponsor(req.params.id, req.user?.uid || 'guest', patch);
    if (!updated) {
      res.status(404).json({ error: 'Sponsor campaign not found or access denied.' });
      return;
    }
    res.json({ sponsor: updated });
  });

  app.delete('/api/sponsors/:id', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const deleted = store.deleteSponsor(req.params.id, req.user?.uid || 'guest');
    if (!deleted) {
      res.status(404).json({ error: 'Sponsor campaign not found or access denied.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/sponsors/:id/click', (req, res) => {
    const sp = store.recordSponsorClick(req.params.id);
    if (!sp) {
      res.status(404).json({ error: 'Sponsor campaign not found.' });
      return;
    }
    const safeCheck = validateAndSanitizeUrl(sp.ctaUrl);
    if (!safeCheck.valid || !safeCheck.sanitizedUrl) {
      res.status(400).json({ error: 'Blocked unsafe sponsor URL.' });
      return;
    }
    res.json({ ok: true, ctaUrl: safeCheck.sanitizedUrl, sponsor: sp });
  });

  // Ad Network / Custom Banner configuration
  app.get('/api/ads', (_req, res) => {
    res.json({ adConfig: store.getAdConfig() });
  });

  app.post('/api/ads', (req, res) => {
    const body = (req.body || {}) as Partial<import('./src/shared/types').AdNetworkConfig>;
    const validTypes = new Set(['banner_html', 'direct_link', 'image_banner']);
    const networkType = validTypes.has(String(body.networkType))
      ? (body.networkType as 'banner_html' | 'direct_link' | 'image_banner')
      : 'banner_html';

    const sanitizedPatch: Partial<import('./src/shared/types').AdNetworkConfig> = {
      enabled: Boolean(body.enabled),
      networkType,
      networkName: sanitizeText(String(body.networkName || 'Monetag / Adsterra / Custom'), 80) || 'Custom Ad Network',
      bannerHtml: typeof body.bannerHtml === 'string' ? body.bannerHtml.slice(0, 16_000) : '',
      showOnInterstitial: body.showOnInterstitial !== false,
      showOnHomepage: Boolean(body.showOnHomepage),
    };

    if (body.bannerImageUrl && String(body.bannerImageUrl).trim()) {
      const imgCheck = validateAndSanitizeUrl(String(body.bannerImageUrl));
      if (!imgCheck.valid || !imgCheck.sanitizedUrl) {
        res.status(400).json({ error: imgCheck.error || 'Enter a valid http(s) banner image URL.' });
        return;
      }
      sanitizedPatch.bannerImageUrl = imgCheck.sanitizedUrl;
    } else {
      sanitizedPatch.bannerImageUrl = '';
    }

    if (body.bannerTargetUrl && String(body.bannerTargetUrl).trim()) {
      const targetCheck = validateAndSanitizeUrl(String(body.bannerTargetUrl));
      if (!targetCheck.valid || !targetCheck.sanitizedUrl) {
        res.status(400).json({ error: targetCheck.error || 'Enter a valid http(s) banner target URL.' });
        return;
      }
      sanitizedPatch.bannerTargetUrl = targetCheck.sanitizedUrl;
    } else {
      sanitizedPatch.bannerTargetUrl = '';
    }

    if (body.directAdUrl && String(body.directAdUrl).trim()) {
      const directCheck = validateAndSanitizeUrl(String(body.directAdUrl));
      if (!directCheck.valid || !directCheck.sanitizedUrl) {
        res.status(400).json({ error: directCheck.error || 'Enter a valid http(s) direct ad URL.' });
        return;
      }
      sanitizedPatch.directAdUrl = directCheck.sanitizedUrl;
    } else {
      sanitizedPatch.directAdUrl = '';
    }

    const updated = store.setAdConfig(sanitizedPatch);
    res.json({ adConfig: updated });
  });

  // Demo mode controls
  app.get('/api/demo/status', (_req, res) => {
    res.json({ demoActive: store.isDemoActive(), totalLinks: store.listAllPublicLinks().length });
  });

  app.post('/api/demo/load', (_req, res) => {
    store.seedDemoData();
    res.json({ demoActive: true, totalLinks: store.listAllPublicLinks().length });
  });

  app.post('/api/demo/clear', (_req, res) => {
    store.clearDemoData();
    res.json({ demoActive: false, totalLinks: store.listAllPublicLinks().length });
  });

  // Alias availability check (used with 300ms debounce on client)
  app.get('/api/alias/check', (req, res) => {
    const raw = typeof req.query.alias === 'string' ? req.query.alias : '';
    if (!raw.trim()) {
      res.json({ valid: true, available: true });
      return;
    }
    const validation = validateAlias(raw);
    if (!validation.valid) {
      res.json({ valid: false, available: false, reason: validation.error });
      return;
    }
    const available = store.isCodeAvailable(validation.normalized!);
    res.json({
      valid: true,
      available,
      reason: available ? undefined : `Alias "${validation.normalized}" is already taken.`,
    });
  });

  // Paginated, searchable, filterable, sortable links listing
  app.get('/api/links', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'all';
    const tagFilter = typeof req.query.tag === 'string' ? req.query.tag.trim().toLowerCase() : '';
    const minClicks = req.query.minClicks ? Number(req.query.minClicks) : null;
    const maxClicks = req.query.maxClicks ? Number(req.query.maxClicks) : null;
    const dateFrom = typeof req.query.dateFrom === 'string' && req.query.dateFrom ? Date.parse(req.query.dateFrom) : null;
    const dateTo = typeof req.query.dateTo === 'string' && req.query.dateTo ? Date.parse(req.query.dateTo) : null;
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));

    const callerUid = req.user?.uid || null;
    const allLinks = store.listAllPublicLinks().filter((link) => {
      // Show demo links, unowned links, and links owned by the authenticated caller
      if (!link.ownerId || link.ownerId === 'demo' || link.isDemo) return true;
      return callerUid !== null && link.ownerId === callerUid;
    });

    const tagSet = new Set<string>();
    for (const l of allLinks) {
      for (const t of l.tags) tagSet.add(t);
    }

    const filtered = allLinks.filter((link) => {
      if (statusFilter === 'protected') {
        if (!link.isPasswordProtected) return false;
      } else if (statusFilter === 'sponsored') {
        if (!link.interstitialEnabled) return false;
      } else if (statusFilter !== 'all') {
        if (link.status !== statusFilter) return false;
      }

      if (tagFilter && !link.tags.includes(tagFilter)) return false;

      if (minClicks !== null && !Number.isNaN(minClicks) && link.clicks < minClicks) return false;
      if (maxClicks !== null && !Number.isNaN(maxClicks) && link.clicks > maxClicks) return false;

      const createdMs = Date.parse(link.createdAt);
      if (dateFrom !== null && !Number.isNaN(dateFrom) && createdMs < dateFrom) return false;
      if (dateTo !== null && !Number.isNaN(dateTo) && createdMs > dateTo + 86400_000) return false;

      if (search) {
        const hay = `${link.code} ${link.targetUrl} ${link.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'clicks') {
        cmp = a.clicks - b.clicks;
      } else if (sortBy === 'code') {
        cmp = a.code.localeCompare(b.code);
      } else {
        cmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    res.json({
      items: filtered.slice(offset, offset + pageSize),
      total,
      page: safePage,
      pageSize,
      totalPages,
      availableTags: Array.from(tagSet).sort(),
    });
  });

  // Create single shortened link (rate-limited 20/min/IP)
  app.post('/api/links', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const rate = linkCreateRateLimiter.check(getClientIp(req));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      res.status(429).json({
        error: 'Rate limit exceeded: maximum 20 links per minute per IP.',
        retryAfterSeconds: rate.retryAfterSeconds,
      });
      return;
    }

    if (req.user && isBillingConfigured()) {
      const billing = store.getUserBilling(req.user.uid);
      if (billing.plan === 'free' && store.countLinksForOwner(req.user.uid) >= MAX_FREE_ACTIVE_LINKS) {
        res.status(402).json({
          error: `Free plan limit of ${MAX_FREE_ACTIVE_LINKS} saved links reached. Upgrade to Pro for unlimited links.`,
          code: 'PLAN_LIMIT_REACHED',
        });
        return;
      }
    }

    const body = (req.body || {}) as {
      url?: string;
      customAlias?: string;
      expiresAt?: string | null;
      password?: string;
      tags?: string[];
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    };

    const urlCheck = validateAndSanitizeUrl(body.url || '');
    if (!urlCheck.valid || !urlCheck.sanitizedUrl) {
      res.status(400).json({ error: urlCheck.error || 'Invalid URL.' });
      return;
    }

    let cleanAlias: string | undefined;
    if (typeof body.customAlias === 'string' && body.customAlias.trim()) {
      const aliasCheck = validateAlias(body.customAlias);
      if (!aliasCheck.valid || !aliasCheck.normalized) {
        res.status(400).json({ error: aliasCheck.error || 'Invalid custom alias.' });
        return;
      }
      if (!store.isCodeAvailable(aliasCheck.normalized)) {
        res.status(409).json({ error: `Custom alias "${aliasCheck.normalized}" is already in use.` });
        return;
      }
      cleanAlias = aliasCheck.normalized;
    }

    let validExpiresAt: string | null = null;
    if (body.expiresAt) {
      const ms = Date.parse(body.expiresAt);
      if (Number.isNaN(ms) || ms <= Date.now()) {
        res.status(400).json({ error: 'Expiration date must be a valid future date.' });
        return;
      }
      validExpiresAt = new Date(ms).toISOString();
    }

    if (body.password !== undefined && body.password !== '' && body.password.length < 3) {
      res.status(400).json({ error: 'Password must be at least 3 characters long.' });
      return;
    }

    const created = store.createLink({
      ownerId: req.user?.uid || null,
      targetUrl: urlCheck.sanitizedUrl,
      originalInputUrl: body.url?.trim(),
      customAlias: cleanAlias,
      expiresAt: validExpiresAt,
      password: body.password ? String(body.password) : undefined,
      interstitialEnabled: Boolean(body.interstitialEnabled),
      sponsorId: typeof body.sponsorId === 'string' && body.sponsorId.trim() ? body.sponsorId.trim() : null,
      tags: normalizeTags(body.tags),
    });

    res.status(201).json({
      link: created,
      sanitization: {
        autoPrependedProtocol: Boolean(urlCheck.autoPrependedProtocol),
        strippedTrackingParams: urlCheck.strippedTrackingParams,
      },
    });
  });

  // Bulk URL shortening
  app.post('/api/links/bulk', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const rate = linkCreateRateLimiter.check(getClientIp(req));
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      res.status(429).json({
        error: 'Rate limit exceeded: please wait before creating more links.',
        retryAfterSeconds: rate.retryAfterSeconds,
      });
      return;
    }

    let remainingQuota = Infinity;
    if (req.user && isBillingConfigured()) {
      const billing = store.getUserBilling(req.user.uid);
      if (billing.plan === 'free') {
        const current = store.countLinksForOwner(req.user.uid);
        remainingQuota = Math.max(0, MAX_FREE_ACTIVE_LINKS - current);
        if (remainingQuota === 0) {
          res.status(402).json({
            error: `Free plan limit of ${MAX_FREE_ACTIVE_LINKS} saved links reached. Upgrade to Pro for unlimited links.`,
            code: 'PLAN_LIMIT_REACHED',
          });
          return;
        }
      }
    }

    const body = (req.body || {}) as {
      urls?: string[];
      expiresAt?: string | null;
      tags?: string[];
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    };

    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      res.status(400).json({ error: 'Provide at least one URL to shorten.' });
      return;
    }

    const lines = body.urls.slice(0, 50);
    let validExpiresAt: string | null = null;
    if (body.expiresAt) {
      const ms = Date.parse(body.expiresAt);
      if (!Number.isNaN(ms) && ms > Date.now()) {
        validExpiresAt = new Date(ms).toISOString();
      }
    }

    const tags = normalizeTags(body.tags);
    const interstitialEnabled = Boolean(body.interstitialEnabled);
    const sponsorId = typeof body.sponsorId === 'string' && body.sponsorId.trim() ? body.sponsorId.trim() : null;

    const results: BulkCreateItemResult[] = lines.map((raw) => {
      if (remainingQuota <= 0) {
        return {
          input: raw,
          success: false,
          error: `Free plan limit (${MAX_FREE_ACTIVE_LINKS} links) reached.`,
        };
      }
      const check = validateAndSanitizeUrl(raw);
      if (!check.valid || !check.sanitizedUrl) {
        return { input: raw, success: false, error: check.error || 'Invalid URL' };
      }
      const link = store.createLink({
        ownerId: req.user?.uid || null,
        targetUrl: check.sanitizedUrl,
        originalInputUrl: raw.trim(),
        expiresAt: validExpiresAt,
        interstitialEnabled,
        sponsorId,
        tags,
      });
      if (Number.isFinite(remainingQuota)) {
        remainingQuota -= 1;
      }
      return { input: raw, success: true, link };
    });

    res.status(200).json({
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  });

  // Bulk actions: delete, disable, activate, export-csv, export-json
  app.post('/api/links/bulk-action', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const body = (req.body || {}) as {
      action?: 'delete' | 'disable' | 'activate' | 'export-csv' | 'export-json';
      ids?: string[];
    };

    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      res.status(400).json({ error: 'Select at least one link.' });
      return;
    }

    const callerUid = req.user?.uid || null;
    const canModify = (rec: StoredLinkRecord | undefined): rec is StoredLinkRecord =>
      Boolean(
        rec && (!rec.ownerId || rec.ownerId === 'demo' || (callerUid !== null && rec.ownerId === callerUid)),
      );

    const ids = body.ids.filter((id) => typeof id === 'string');

    if (body.action === 'export-json') {
      const selected = ids
        .map((id) => store.getRecordById(id))
        .filter(canModify)
        .map((r) => store.toPublicLink(r));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="linkcraft-export.json"');
      res.send(JSON.stringify(selected, null, 2));
      return;
    }

    if (body.action === 'export-csv') {
      const selected = ids
        .map((id) => store.getRecordById(id))
        .filter(canModify)
        .map((r) => store.toPublicLink(r));

      const header = [
        'id',
        'code',
        'targetUrl',
        'status',
        'clicks',
        'uniqueClicks',
        'tags',
        'createdAt',
        'expiresAt',
        'passwordProtected',
        'interstitialEnabled',
      ];
      const rows = selected.map((l) =>
        [
          l.id,
          l.code,
          l.targetUrl,
          l.status,
          l.clicks,
          l.uniqueClicks,
          l.tags.join('|'),
          l.createdAt,
          l.expiresAt || '',
          l.isPasswordProtected,
          l.interstitialEnabled,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="linkcraft-export.csv"');
      res.send([header.join(','), ...rows].join('\n'));
      return;
    }

    let affected = 0;
    for (const id of ids) {
      const rec = store.getRecordById(id);
      if (!rec || !canModify(rec)) continue;
      if (body.action === 'delete') {
        if (store.deleteLink(id)) affected += 1;
      } else if (body.action === 'disable') {
        if (store.updateLink(id, { isDisabled: true })) affected += 1;
      } else if (body.action === 'activate') {
        if (store.updateLink(id, { isDisabled: false })) affected += 1;
      }
    }

    res.json({ ok: true, affected });
  });

  // Aggregate overview analytics (60s TTL cached)
  app.get('/api/analytics/overview', (_req, res) => {
    res.json(store.getOverviewAnalytics());
  });

  // Single link details & management
  app.get('/api/links/:id', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const rec = store.getRecordById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    if (rec.ownerId && rec.ownerId !== 'demo' && rec.ownerId !== req.user?.uid) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    res.json({ link: store.toPublicLink(rec) });
  });

  app.patch('/api/links/:id', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const rec = store.getRecordById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    if (rec.ownerId && rec.ownerId !== 'demo' && rec.ownerId !== req.user?.uid) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    const body = (req.body || {}) as {
      expiresAt?: string | null;
      isDisabled?: boolean;
      tags?: string[];
      password?: string | null;
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    };

    if (body.expiresAt !== undefined && body.expiresAt !== null) {
      const ms = Date.parse(body.expiresAt);
      if (Number.isNaN(ms) || ms <= Date.now()) {
        res.status(400).json({ error: 'New expiration date must be in the future.' });
        return;
      }
    }

    if (typeof body.password === 'string' && body.password.length > 0 && body.password.length < 3) {
      res.status(400).json({ error: 'Password must be at least 3 characters.' });
      return;
    }

    const updated = store.updateLink(req.params.id, {
      expiresAt: body.expiresAt,
      isDisabled: body.isDisabled,
      tags: body.tags,
      password: body.password,
      interstitialEnabled: body.interstitialEnabled,
      sponsorId: body.sponsorId,
    });
    res.json({ link: updated });
  });

  app.delete('/api/links/:id', optionalAuthMiddleware, (req: AuthenticatedRequest, res) => {
    const rec = store.getRecordById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    if (rec.ownerId && rec.ownerId !== 'demo' && rec.ownerId !== req.user?.uid) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    store.deleteLink(req.params.id);
    res.json({ ok: true });
  });

  // Per-link analytics (60s TTL cached)
  app.get('/api/links/:id/analytics', (req, res) => {
    const rawRange = typeof req.query.range === 'string' ? req.query.range : '30d';
    const validRanges = new Set<AnalyticsRange>(['24h', '7d', '30d', '90d', 'all']);
    const range: AnalyticsRange = validRanges.has(rawRange as AnalyticsRange)
      ? (rawRange as AnalyticsRange)
      : '30d';

    const report = store.getLinkAnalytics(req.params.id, range);
    if (!report) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    res.json(report);
  });

  // Gate status, interstitial sponsor view, & password unlock endpoints
  app.get('/api/gate/:code', (req, res) => {
    const rawCode = req.params.code;
    if (rawCode === 'preview') {
      const sponsor = store.getLatestActiveSponsor();
      res.json({
        code: 'preview',
        state: 'interstitial',
        expiresAt: null,
        targetUrl: 'https://example.com/sample-destination',
        sponsor,
        adNetwork: store.getAdConfig(),
        waitSeconds: 5,
        isPreview: true,
      });
      return;
    }

    const rec = store.getRecordByCode(rawCode);
    if (!rec) {
      if (rawCode === 'flash-offer') {
        const sponsor = store.getLatestActiveSponsor();
        res.json({
          code: 'flash-offer',
          state: 'interstitial',
          expiresAt: null,
          targetUrl: 'https://store.example.com/autumn-collection',
          sponsor,
          adNetwork: store.getAdConfig(),
          waitSeconds: 5,
          isPreview: true,
        });
        return;
      }
      res.status(404).json({ code: rawCode, state: 'not_found', expiresAt: null });
      return;
    }

    // Auto-heal expired demo link if requested
    if (rawCode === 'flash-offer' && isLinkExpired(rec.expiresAt)) {
      store.updateLink(rec.id, {
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        isDisabled: false,
        interstitialEnabled: true,
      });
    }

    const status = computeLinkStatus(rec.isDisabled, rec.expiresAt);
    if (status === 'disabled') {
      res.json({ code: rec.code, state: 'disabled', expiresAt: rec.expiresAt });
      return;
    }
    if (status === 'expired') {
      res.json({ code: rec.code, state: 'expired', expiresAt: rec.expiresAt });
      return;
    }
    if (rec.passwordHash) {
      res.json({ code: rec.code, state: 'password_required', expiresAt: rec.expiresAt });
      return;
    }

    const safeCheck = validateAndSanitizeUrl(rec.targetUrl);
    if (!safeCheck.valid || !safeCheck.sanitizedUrl) {
      res.status(400).json({ error: 'Unsafe destination URL blocked.' });
      return;
    }

    if (rec.interstitialEnabled) {
      const sponsor = store.getSponsorForLink(rec);
      if (sponsor) {
        store.recordSponsorImpression(sponsor.id);
      }
      res.json({
        code: rec.code,
        state: 'interstitial',
        expiresAt: rec.expiresAt,
        targetUrl: safeCheck.sanitizedUrl,
        sponsor,
        adNetwork: store.getAdConfig(),
        waitSeconds: 5,
      });
      return;
    }

    res.json({
      code: rec.code,
      state: 'active',
      expiresAt: rec.expiresAt,
      targetUrl: safeCheck.sanitizedUrl,
    });
  });

  app.post('/api/gate/:code/continue', (req, res) => {
    const rawCode = req.params.code;
    if (rawCode === 'preview' || (rawCode === 'flash-offer' && !store.getRecordByCode('flash-offer'))) {
      res.json({ targetUrl: 'https://example.com/sample-destination' });
      return;
    }
    const rec = store.getRecordByCode(rawCode);
    if (!rec) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    if (rec.isDisabled) {
      res.status(410).json({ error: 'This link has been disabled.' });
      return;
    }
    if (isLinkExpired(rec.expiresAt)) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }
    if (rec.passwordHash) {
      res.status(403).json({ error: 'Password unlock required.' });
      return;
    }
    const safeCheck = validateAndSanitizeUrl(rec.targetUrl);
    if (!safeCheck.valid || !safeCheck.sanitizedUrl) {
      res.status(400).json({ error: 'Unsafe destination URL blocked.' });
      return;
    }
    recordVisitAsync(req, res, rec);
    res.json({ targetUrl: safeCheck.sanitizedUrl });
  });

  app.post('/api/gate/:code/unlock', (req, res) => {
    const code = req.params.code;
    const rec = store.getRecordByCode(code);
    if (!rec) {
      res.status(404).json({ error: 'Link not found.' });
      return;
    }
    if (rec.isDisabled) {
      res.status(410).json({ error: 'This link has been disabled.' });
      return;
    }
    if (isLinkExpired(rec.expiresAt)) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }

    const ip = getClientIp(req);
    const rate = passwordUnlockRateLimiter.check(`${ip}:${rec.id}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      res.status(429).json({
        error: `Too many failed attempts. Try again in ${rate.retryAfterSeconds} seconds.`,
        retryAfterSeconds: rate.retryAfterSeconds,
      });
      return;
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!rec.passwordHash || !verifyPassword(password, rec.passwordHash)) {
      res.status(401).json({
        error: 'Incorrect password. Please try again.',
        remainingAttempts: rate.remaining,
      });
      return;
    }

    // Re-validate redirect target against safe schemes before returning
    const safeCheck = validateAndSanitizeUrl(rec.targetUrl);
    if (!safeCheck.valid || !safeCheck.sanitizedUrl) {
      res.status(400).json({ error: 'Unsafe destination URL blocked.' });
      return;
    }

    recordVisitAsync(req, res, rec);
    res.json({ targetUrl: safeCheck.sanitizedUrl });
  });

  // Redirect route handler for /:code and /r/:code
  const handleRedirect = (req: Request, res: Response, next: NextFunction) => {
    const code = (req.params.code || '').trim();
    if (!code) {
      next();
      return;
    }

    // Never intercept Vite internal assets, files with extensions, or SPA routes
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/src/') ||
      req.path.startsWith('/node_modules/') ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/@') ||
      req.path.startsWith('/__') ||
      code.includes('.') ||
      SPA_ROUTES.has(code.toLowerCase()) ||
      RESERVED_ALIASES.has(code.toLowerCase())
    ) {
      next();
      return;
    }

    const rec = store.getRecordByCode(code);
    if (!rec) {
      // Let SPA render friendly 404 gate screen
      next();
      return;
    }

    const status = computeLinkStatus(rec.isDisabled, rec.expiresAt);
    if (status === 'expired' || status === 'disabled' || rec.passwordHash || rec.interstitialEnabled) {
      // Serve the SPA shell so the user sees the Sponsor Interstitial, Password Gate, or Expired page
      next();
      return;
    }

    // Open-redirect safeguard: validate destination protocol before 302
    const safeCheck = validateAndSanitizeUrl(rec.targetUrl);
    if (!safeCheck.valid || !safeCheck.sanitizedUrl) {
      res.status(400).send('Blocked unsafe redirect target.');
      return;
    }

    recordVisitAsync(req, res, rec);
    res.redirect(302, safeCheck.sanitizedUrl);
  };

  app.get('/r/:code', handleRedirect);
  app.get('/:code', handleRedirect);

  const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    const candidateDistDirs = [
      path.resolve(process.cwd(), 'dist'),
      path.resolve(moduleDir, 'dist'),
      path.resolve(moduleDir, '..', 'dist'),
    ];
    const distDir =
      candidateDistDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ||
      candidateDistDirs[0];
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  void createApp().then((app) => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Linkcraft server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
