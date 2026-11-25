import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { GateStatusResponse } from '../shared/types';
import { validateAndSanitizeUrl } from '../shared/urlUtils';
import { ApiError, api } from '../utils/api';
import { AdNetworkBanner } from './AdNetworkBanner';

interface GatePageProps {
  code: string;
  onBackHome: () => void;
}

export function GatePage({ code, onBackHome }: GatePageProps) {
  const [status, setStatus] = useState<GateStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(5);
  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getGateStatus(code)
      .then((res) => {
        if (cancelled) return;
        setStatus(res);
        if (res.state === 'interstitial') {
          setSecondsLeft(typeof res.waitSeconds === 'number' ? res.waitSeconds : 5);
        } else if (res.state === 'active' && res.targetUrl) {
          window.location.replace(res.targetUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus({ code, state: 'not_found', expiresAt: null });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (status?.state !== 'interstitial' || secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status?.state, secondsLeft]);

  // Auto-redirect to target destination when countdown reaches 0s (for non-preview visitors)
  useEffect(() => {
    if (status?.state !== 'interstitial' || secondsLeft > 0 || continuing || status?.isPreview) return;
    const autoRedirectTimer = window.setTimeout(() => {
      void handleContinueDestination();
    }, 500);
    return () => window.clearTimeout(autoRedirectTimer);
  }, [status?.state, secondsLeft, continuing, status?.isPreview]);

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setLockoutSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockoutSeconds]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || lockoutSeconds > 0) return;
    setError(null);
    setUnlocking(true);
    try {
      const res = await api.unlockGate(code, password);
      window.location.assign(res.targetUrl);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && err.retryAfterSeconds) {
        setLockoutSeconds(err.retryAfterSeconds);
      }
      setError(err instanceof Error ? err.message : 'Unable to unlock link.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleContinueDestination = async () => {
    if (secondsLeft > 0 || continuing || status?.isPreview) return;
    setContinuing(true);
    setError(null);

    try {
      const res = await api.continueGate(code);
      window.location.assign(res.targetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue to destination.');
      setContinuing(false);
    }
  };

  const totalWait = status?.waitSeconds || 5;
  const elapsedPercent = Math.min(100, Math.round(((totalWait - secondsLeft) / totalWait) * 100));
  const safeSponsorUrl = status?.sponsor?.ctaUrl
    ? validateAndSanitizeUrl(status.sponsor.ctaUrl).sanitizedUrl
    : undefined;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="animate-pulse space-y-4 py-4">
            <div className="mx-auto h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-800" />
            <div className="mx-auto h-5 w-48 rounded bg-slate-200 dark:bg-slate-800" />
            <div className="mx-auto h-4 w-64 rounded bg-slate-100 dark:bg-slate-800/70" />
          </div>
        ) : status?.state === 'interstitial' ? (
          <div>
            {status?.isPreview && (
              <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50/90 px-3.5 py-2 text-xs text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/60 dark:text-blue-200">
                <span className="font-semibold flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Interstitial Live Preview</span>
                </span>
                <span className="rounded bg-blue-200/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  Preview Active
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Linkcraft
              </span>
              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {secondsLeft > 0 ? `Redirect ready in ${secondsLeft}s` : 'Ready to continue'}
              </span>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-blue-600 transition-all duration-500 dark:bg-blue-500"
                style={{ width: `${Math.max(8, elapsedPercent)}%` }}
              />
            </div>

            <div className="mt-5">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                You are visiting <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">/{code}</span>
              </p>
              {status.targetUrl && (
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400" title={status.targetUrl}>
                  Destination: {status.targetUrl}
                </p>
              )}
            </div>

            {/* Automated Ad Network Banner (Monetag, Adsterra, Custom) */}
            {status.adNetwork?.enabled && status.adNetwork?.showOnInterstitial && (
              <div className="mt-4">
                <AdNetworkBanner config={status.adNetwork} placement="interstitial" />
              </div>
            )}

            {/* Sponsor / Affiliate Showcase Card */}
            {status.sponsor ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    {status.sponsor.badgeText || 'Sponsored'}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">Featured Partner</span>
                </div>
                <h1 className="mt-2 font-display text-lg font-bold text-slate-900 dark:text-white">
                  {status.sponsor.title}
                </h1>
                {status.sponsor.description && (
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    {status.sponsor.description}
                  </p>
                )}
                {safeSponsorUrl && (
                  <div className="mt-4">
                    <a
                      href={safeSponsorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        void api.recordSponsorClick(status.sponsor!.id);
                      }}
                      className="min-h-[42px] inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-slate-800"
                    >
                      <span>{status.sponsor.ctaLabel}</span>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  </div>
                )}
              </div>
            ) : !status.adNetwork?.enabled || !status.adNetwork?.showOnInterstitial ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-950/60">
                <h1 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Preparing your destination
                </h1>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  Verifying target URL safety and stripping tracking parameters.
                </p>
              </div>
            ) : null}

            {error && (
              <p role="alert" className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              {status.isPreview && secondsLeft === 0 && status.targetUrl ? (
                <a
                  href={status.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[46px] flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  <span>Test Destination (Preview)</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled={secondsLeft > 0 || continuing}
                  onClick={() => void handleContinueDestination()}
                  className="min-h-[46px] flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-55 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                  <span>
                    {continuing
                      ? 'Redirecting...'
                      : secondsLeft > 0
                        ? `Continue in ${secondsLeft}s`
                        : 'Continue to Destination'}
                  </span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={onBackHome}
                className="min-h-[46px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span>Back to Linkcraft</span>
              </button>
            </div>
          </div>
        ) : status?.state === 'password_required' ? (
          <div>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              <Lock className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-center font-display text-xl font-bold text-slate-900 dark:text-white">
              Password Protected Link
            </h1>
            <p className="mt-1.5 text-center text-sm text-slate-600 dark:text-slate-400">
              Enter the password to continue to <span className="font-mono font-medium">/{code}</span>.
            </p>

            <form onSubmit={handleUnlock} className="mt-6 space-y-4">
              <div>
                <label htmlFor="gate-password" className="sr-only">
                  Link password
                </label>
                <div className="relative">
                  <input
                    id="gate-password"
                    type={showPassword ? 'text' : 'password'}
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={lockoutSeconds > 0}
                    placeholder="Enter password"
                    className="min-h-[46px] w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
                >
                  {lockoutSeconds > 0
                    ? `Too many attempts. Please wait ${lockoutSeconds}s before trying again.`
                    : error}
                </div>
              )}

              <button
                type="submit"
                disabled={unlocking || !password || lockoutSeconds > 0}
                className="min-h-[46px] w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {unlocking ? 'Verifying...' : 'Unlock & Continue'}
              </button>
            </form>
          </div>
        ) : status?.state === 'expired' ? (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
              <Clock className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-white">
              This link has expired
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              The short link <span className="font-mono font-medium">/{code}</span> passed its scheduled
              expiration date and is no longer redirecting.
            </p>
            <button
              type="button"
              onClick={onBackHome}
              className="mt-6 min-h-[44px] w-full rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              Return to Linkcraft
            </button>
          </div>
        ) : status?.state === 'disabled' ? (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <ShieldAlert className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-white">
              This link is disabled
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              The owner of <span className="font-mono font-medium">/{code}</span> has paused redirects.
            </p>
            <button
              type="button"
              onClick={onBackHome}
              className="mt-6 min-h-[44px] w-full rounded-lg bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              Return to Linkcraft
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-white">
              Short link not found
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              No active destination is registered for <span className="font-mono font-medium">/{code}</span>.
            </p>
            <button
              type="button"
              onClick={onBackHome}
              className="mt-6 min-h-[44px] w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              Create a Short Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
