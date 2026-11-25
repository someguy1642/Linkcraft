import { useEffect, useState } from 'react';
import { Check, CreditCard, LogOut, ShieldCheck, Sparkles, X } from 'lucide-react';
import { ApiError, api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastProvider';

interface AccountBillingModalProps {
  open: boolean;
  onClose: () => void;
}

export function AccountBillingModal({ open, onClose }: AccountBillingModalProps) {
  const { user, signingIn, billing, signInWithGoogle, logout } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [stripeNotice, setStripeNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStripeNotice(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleUpgrade = async () => {
    setStripeNotice(null);
    if (!user) {
      await signInWithGoogle();
      return;
    }
    setBusy(true);
    try {
      const res = await api.createCheckoutSession();
      if (res.url) {
        window.location.assign(res.url);
      } else {
        setStripeNotice('Stripe did not return a checkout URL.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.configured === false) {
        setStripeNotice(err.message);
      } else {
        showToast(err instanceof Error ? err.message : 'Unable to start checkout.', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePortal = async () => {
    setBusy(true);
    setStripeNotice(null);
    try {
      const res = await api.openBillingPortal();
      if (res.url) {
        window.location.assign(res.url);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to open billing portal.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const usagePercent =
    billing.plan === 'pro'
      ? 100
      : Math.min(100, Math.round((billing.activeLinksCount / Math.max(1, billing.maxFreeLinks)) * 100));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-billing-title"
        className="animate-scale-pop w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 id="account-billing-title" className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Account &amp; Plan
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Sync shortened links to your account and manage your subscription.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account and billing dialog"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Auth Section */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
          {user ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Account avatar'}
                    referrerPolicy="no-referrer"
                    className="h-10 w-10 rounded-full border border-slate-200 object-cover dark:border-slate-700"
                  />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                    {(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                    {user.displayName || 'Linkcraft Member'}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {user.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Sign in with Google
                </p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Save links to your cloud workspace and unlock Pro billing.
                </p>
              </div>
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void signInWithGoogle()}
                className="min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>{signingIn ? 'Signing in...' : 'Continue with Google'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Usage Quota */}
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {billing.stripeConfigured ? (
                <>
                  Current plan:{' '}
                  <span className={billing.plan === 'pro' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'}>
                    {billing.plan === 'pro' ? 'Pro ($15/mo)' : 'Free Starter'}
                  </span>
                </>
              ) : (
                'Workspace Summary'
              )}
            </span>
            <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
              {!billing.stripeConfigured || billing.plan === 'pro'
                ? `${billing.activeLinksCount} saved links`
                : `${billing.activeLinksCount} / ${billing.maxFreeLinks} saved links`}
            </span>
          </div>
          {billing.stripeConfigured && billing.plan === 'free' && (
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full transition-all ${usagePercent >= 90 ? 'bg-amber-500' : 'bg-blue-600'}`}
                style={{ width: `${Math.max(4, usagePercent)}%` }}
              />
            </div>
          )}
        </div>

        {/* Plan Comparison (shown when Stripe billing is enabled) */}
        {billing.stripeConfigured && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">Free</h3>
                <span className="font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">$0</span>
              </div>
              <ul className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>Up to {billing.maxFreeLinks} saved links</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>QR studio, passwords &amp; expiry</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>Sponsor interstitial monetization</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 dark:border-blue-900/70 dark:bg-blue-950/20">
              <div className="flex items-baseline justify-between">
                <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-slate-900 dark:text-white">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  <span>Pro</span>
                </h3>
                <span className="font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                  ${billing.priceMonthlyUsd}
                  <span className="text-xs font-normal text-slate-500">/mo</span>
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-xs text-slate-700 dark:text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Unlimited saved short links</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Direct redirects (no forced wait screens)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>Full CSV/JSON analytics exports</span>
                </li>
              </ul>

              <div className="mt-4">
                {billing.plan === 'pro' ? (
                  <button
                    type="button"
                    disabled={busy || !billing.hasStripeCustomer}
                    onClick={() => void handlePortal()}
                    className="min-h-[40px] w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300"
                  >
                    <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{busy ? 'Opening...' : 'Manage Subscription'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleUpgrade()}
                    className="min-h-[40px] w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
                  >
                    <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{busy ? 'Redirecting...' : user ? 'Upgrade to Pro' : 'Sign in to Upgrade'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {stripeNotice && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="leading-relaxed">{stripeNotice}</p>
          </div>
        )}

        <div className="mt-4 border-t border-slate-100 pt-3 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Need help? Contact{' '}
          <a
            href="mailto:someking2026@outlook.com"
            className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-blue-600 dark:text-slate-200 dark:decoration-slate-600 dark:hover:text-blue-400"
          >
            someking2026@outlook.com
          </a>
        </div>
      </div>
    </div>
  );
}
