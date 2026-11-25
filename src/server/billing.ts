import Stripe from 'stripe';
import type { Request } from 'express';

export const MAX_FREE_ACTIVE_LINKS = 25;
export const PRO_PRICE_MONTHLY_USD = 15;

export function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

export function getStripePriceId(): string | null {
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  return priceId || null;
}

export function isBillingConfigured(): boolean {
  return Boolean(getStripeClient() && getStripePriceId());
}

export function resolveRequestOrigin(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}
