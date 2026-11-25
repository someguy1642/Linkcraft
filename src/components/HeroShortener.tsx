import React, { useEffect, useMemo, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import QRCode from 'qrcode';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Lock,
  Megaphone,
  QrCode,
  Sparkles,
  Tag,
} from 'lucide-react';
import type {
  BulkCreateItemResult,
  CreateLinkPayload,
  ExpirationPreset,
  ShortLink,
  SponsorCampaign,
} from '../shared/types';
import {
  normalizeTags,
  parseExpirationPreset,
  validateAlias,
  validateAndSanitizeUrl,
} from '../shared/urlUtils';
import { ApiError, api } from '../utils/api';
import { buildShortUrl, copyToClipboard } from '../utils/clipboard';
import { useAuth } from './AuthContext';
import { useToast } from './ToastProvider';

interface HeroShortenerProps {
  sponsors: SponsorCampaign[];
  onLinkCreated: (link: ShortLink) => void;
  onBulkCreated: (links: ShortLink[]) => void;
  onQueueOffline: (payload: CreateLinkPayload) => void;
  onOpenQr: (link: ShortLink) => void;
  onOpenAnalytics: (link: ShortLink) => void;
  onOpenBilling: () => void;
  lastCreatedLink: ShortLink | null;
  isOnline: boolean;
}

export function HeroShortener({
  sponsors,
  onLinkCreated,
  onBulkCreated,
  onQueueOffline,
  onOpenQr,
  onOpenAnalytics,
  onOpenBilling,
  lastCreatedLink,
  isOnline,
}: HeroShortenerProps) {
  const { showToast } = useToast();
  const { syncLinkToFirestore, refreshBilling } = useAuth();
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  // Single URL state
  const [rawUrl, setRawUrl] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced options
  const [customAlias, setCustomAlias] = useState('');
  const [aliasStatus, setAliasStatus] = useState<{
    checking: boolean;
    valid: boolean;
    available: boolean;
    message?: string;
  }>({ checking: false, valid: true, available: true });

  const [expirationPreset, setExpirationPreset] = useState<ExpirationPreset>('never');
  const [customExpiresIso, setCustomExpiresIso] = useState<string>('');
  const flatpickrRef = useRef<HTMLInputElement | null>(null);
  const fpInstanceRef = useRef<flatpickr.Instance | null>(null);

  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [interstitialEnabled, setInterstitialEnabled] = useState(false);
  const [selectedSponsorId, setSelectedSponsorId] = useState<string>('');
  const [tagsRaw, setTagsRaw] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [recentResult, setRecentResult] = useState<{
    link: ShortLink;
    strippedTrackingParams: string[];
    autoPrependedProtocol: boolean;
  } | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkCreateItemResult[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>('');

  const activeSponsors = useMemo(() => sponsors.filter((s) => s.active), [sponsors]);

  // Real-time URL validation preview
  const liveValidation = useMemo(() => {
    if (!rawUrl.trim()) return null;
    return validateAndSanitizeUrl(rawUrl);
  }, [rawUrl]);

  // Debounced custom alias check (300ms)
  useEffect(() => {
    const trimmed = customAlias.trim();
    if (!trimmed) {
      setAliasStatus({ checking: false, valid: true, available: true });
      return;
    }

    const localCheck = validateAlias(trimmed);
    if (!localCheck.valid) {
      setAliasStatus({
        checking: false,
        valid: false,
        available: false,
        message: localCheck.error,
      });
      return;
    }

    setAliasStatus({ checking: true, valid: true, available: true, message: 'Checking availability...' });
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.checkAlias(trimmed);
        setAliasStatus({
          checking: false,
          valid: res.valid,
          available: res.available,
          message: res.available ? `"${trimmed}" is available` : res.reason || 'Already taken',
        });
      } catch {
        setAliasStatus({
          checking: false,
          valid: true,
          available: true,
          message: 'Format valid (offline check skipped)',
        });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [customAlias]);

  // Flatpickr initialization for custom expiration date
  useEffect(() => {
    if (expirationPreset !== 'custom' || !flatpickrRef.current) {
      if (fpInstanceRef.current) {
        fpInstanceRef.current.destroy();
        fpInstanceRef.current = null;
      }
      return;
    }

    const instance = flatpickr(flatpickrRef.current, {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      minDate: new Date(Date.now() + 5 * 60_000),
      defaultDate: customExpiresIso ? new Date(customExpiresIso) : new Date(Date.now() + 24 * 3600_000),
      onChange: (selectedDates) => {
        if (selectedDates[0]) {
          setCustomExpiresIso(selectedDates[0].toISOString());
        }
      },
    });
    fpInstanceRef.current = instance;
    if (!customExpiresIso) {
      setCustomExpiresIso(new Date(Date.now() + 24 * 3600_000).toISOString());
    }

    return () => {
      instance.destroy();
      fpInstanceRef.current = null;
    };
  }, [expirationPreset]);

  // Generate QR preview data URL when a link is created
  useEffect(() => {
    const activeLink = recentResult?.link || lastCreatedLink;
    if (!activeLink) {
      setQrPreviewUrl('');
      return;
    }
    const shortUrl = buildShortUrl(activeLink.code);
    QRCode.toDataURL(shortUrl, {
      width: 160,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    })
      .then((dataUrl) => setQrPreviewUrl(dataUrl))
      .catch(() => setQrPreviewUrl(''));
  }, [recentResult, lastCreatedLink]);

  // Keyboard shortcut: Ctrl+Shift+C (or Cmd+Shift+C) copies most recently created link
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        const targetLink = recentResult?.link || lastCreatedLink;
        if (!targetLink) return;
        e.preventDefault();
        const shortUrl = buildShortUrl(targetLink.code);
        void copyToClipboard(shortUrl).then((ok) => {
          if (ok) {
            setCopiedId(targetLink.id);
            showToast('Copied!', 'success', 2000);
            window.setTimeout(() => setCopiedId((curr) => (curr === targetLink.id ? null : curr)), 2000);
          }
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [recentResult, lastCreatedLink, showToast]);

  const handleCopy = async (link: ShortLink) => {
    const shortUrl = buildShortUrl(link.code);
    const ok = await copyToClipboard(shortUrl);
    if (ok) {
      setCopiedId(link.id);
      showToast('Copied!', 'success', 2000);
      window.setTimeout(() => setCopiedId((curr) => (curr === link.id ? null : curr)), 2000);
    } else {
      showToast('Unable to copy automatically. Please copy the URL manually.', 'error');
    }
  };

  const parsedTags = useMemo(
    () =>
      normalizeTags(
        tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    [tagsRaw],
  );

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const urlCheck = validateAndSanitizeUrl(rawUrl);
    if (!urlCheck.valid || !urlCheck.sanitizedUrl) {
      setSubmitError(urlCheck.error || 'Please enter a valid URL.');
      return;
    }

    if (customAlias.trim() && (!aliasStatus.valid || !aliasStatus.available)) {
      setSubmitError(aliasStatus.message || 'Please choose a valid, available custom alias.');
      return;
    }

    if (passwordEnabled && password.length < 3) {
      setSubmitError('Password must be at least 3 characters.');
      return;
    }

    const expiresAt = parseExpirationPreset(expirationPreset, customExpiresIso);
    const payload: CreateLinkPayload = {
      url: rawUrl.trim(),
      customAlias: customAlias.trim() || undefined,
      expiresAt,
      password: passwordEnabled && password ? password : undefined,
      interstitialEnabled: !passwordEnabled && interstitialEnabled,
      sponsorId: !passwordEnabled && interstitialEnabled && selectedSponsorId ? selectedSponsorId : null,
      tags: parsedTags,
    };

    if (!isOnline) {
      onQueueOffline(payload);
      setRawUrl('');
      setCustomAlias('');
      setPassword('');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createLink(payload);
      setRecentResult({
        link: res.link,
        strippedTrackingParams: res.sanitization.strippedTrackingParams,
        autoPrependedProtocol: res.sanitization.autoPrependedProtocol,
      });
      setBulkResults(null);
      void syncLinkToFirestore(res.link);
      void refreshBilling();
      onLinkCreated(res.link);
      setRawUrl('');
      setCustomAlias('');
      setPassword('');
      setPasswordEnabled(false);
      setInterstitialEnabled(false);
      setSelectedSponsorId('');
      setTagsRaw('');
      setExpirationPreset('never');
      showToast('Short link created!', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        onQueueOffline(payload);
      } else if (err instanceof ApiError && (err.status === 402 || err.code === 'PLAN_LIMIT_REACHED')) {
        setSubmitError(err.message);
        onOpenBilling();
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Unable to create short link.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const lines = bulkInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setSubmitError('Paste at least one URL (one per line).');
      return;
    }

    if (lines.length > 50) {
      setSubmitError('Bulk shortening supports up to 50 URLs per batch.');
      return;
    }

    const expiresAt = parseExpirationPreset(expirationPreset, customExpiresIso);
    setSubmitting(true);
    try {
      const res = await api.bulkCreateLinks({
        urls: lines,
        expiresAt,
        tags: parsedTags,
        interstitialEnabled,
        sponsorId: interstitialEnabled && selectedSponsorId ? selectedSponsorId : null,
      });
      setBulkResults(res.results);
      setRecentResult(null);
      const created = res.results.filter((r) => r.success && r.link).map((r) => r.link!);
      if (created.length > 0) {
        created.forEach((lnk) => void syncLinkToFirestore(lnk));
        void refreshBilling();
        onBulkCreated(created);
        setBulkInput('');
      }
      showToast(
        `Shortened ${res.succeeded} of ${res.total} links${res.failed > 0 ? ` (${res.failed} skipped)` : ''}.`,
        res.succeeded > 0 ? 'success' : 'error',
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.code === 'PLAN_LIMIT_REACHED')) {
        setSubmitError(err.message);
        onOpenBilling();
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Bulk shortening failed.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const originPrefix =
    typeof window !== 'undefined' ? `${window.location.host}/` : 'linkcraft/';

  return (
    <section
      id="shorten"
      aria-labelledby="hero-heading"
      className="scroll-mt-20 mx-auto max-w-4xl px-4 pt-10 pb-8 sm:px-6 sm:pt-14 sm:pb-10"
    >
      <div className="text-center">
        <h1
          id="hero-heading"
          className="hero-title mx-auto max-w-2xl font-display font-bold text-slate-900 dark:text-white"
        >
          Shorten, protect, and monetize every link
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-slate-600 dark:text-slate-300">
          Create clean links with automatic tracking-parameter removal, custom aliases, QR codes,
          sponsor interstitials, and real-time analytics.
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="mt-7 flex justify-center">
        <div
          role="tablist"
          aria-label="Shortener mode"
          className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'single'}
            onClick={() => {
              setMode('single');
              setSubmitError(null);
            }}
            className={`min-h-[38px] rounded-md px-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'single'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Single URL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'bulk'}
            onClick={() => {
              setMode('bulk');
              setSubmitError(null);
            }}
            className={`min-h-[38px] rounded-md px-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              mode === 'bulk'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Bulk Shorten
          </button>
        </div>
      </div>

      {/* Primary Shortener Card */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
        {mode === 'single' ? (
          <form onSubmit={handleSingleSubmit} noValidate>
            <label htmlFor="hero-url-input" className="sr-only">
              Destination URL to shorten
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Link2
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="hero-url-input"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={rawUrl}
                  onChange={(e) => {
                    setRawUrl(e.target.value);
                    if (submitError) setSubmitError(null);
                  }}
                  placeholder="Paste a long URL (e.g., https://example.com/launch?utm_source=x)"
                  aria-invalid={Boolean(rawUrl.trim() && liveValidation && !liveValidation.valid)}
                  aria-describedby="url-live-feedback"
                  className="min-h-[52px] w-full rounded-lg border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-900 placeholder:text-slate-400 transition-colors focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[52px] inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-blue-700 active:scale-[0.99] disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {submitting ? 'Shortening...' : 'Shorten URL'}
              </button>
            </div>

            {/* Real-time validation & sanitization feedback */}
            <div id="url-live-feedback" aria-live="polite" className="mt-2.5 min-h-[20px] text-xs">
              {rawUrl.trim() && liveValidation && !liveValidation.valid && (
                <p className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{liveValidation.error}</span>
                </p>
              )}
              {rawUrl.trim() && liveValidation && liveValidation.valid && (
                <p className="flex flex-wrap items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Valid destination
                    {liveValidation.autoPrependedProtocol ? ' (auto-added https://)' : ''}
                    {liveValidation.strippedTrackingParams.length > 0
                      ? ` · stripping ${liveValidation.strippedTrackingParams.length} tracking param${
                          liveValidation.strippedTrackingParams.length > 1 ? 's' : ''
                        }`
                      : ''}
                  </span>
                </p>
              )}
            </div>

            {/* Quick Monetization Interstitial Toggle */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-slate-950/60">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={interstitialEnabled}
                  onChange={(e) => {
                    setInterstitialEnabled(e.target.checked);
                    if (e.target.checked && passwordEnabled) setPasswordEnabled(false);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <Megaphone className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <span>Monetize link with 5s Sponsor &amp; Ad Interstitial</span>
              </label>

              {interstitialEnabled ? (
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  {selectedSponsorId
                    ? `Offer: ${activeSponsors.find((s) => s.id === selectedSponsorId)?.title || 'Selected'}`
                    : activeSponsors.length > 0
                      ? `Offer: ${activeSponsors[0].title}`
                      : 'Ad network banner will be displayed'}
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">
                  Enable to show your sponsor or ads on redirect
                </span>
              )}
            </div>
          </form>
        ) : (
          <form onSubmit={handleBulkSubmit} noValidate>
            <label htmlFor="bulk-url-input" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              Paste multiple URLs (one per line, up to 50)
            </label>
            <textarea
              id="bulk-url-input"
              rows={4}
              value={bulkInput}
              onChange={(e) => {
                setBulkInput(e.target.value);
                if (submitError) setSubmitError(null);
              }}
              placeholder={'https://example.com/docs\nexample.org/pricing?utm_medium=email\nhttps://github.com/features'}
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3.5 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {bulkInput.split(/\r?\n/).filter((l) => l.trim()).length} / 50 URLs detected
              </span>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {submitting ? 'Shortening batch...' : 'Shorten All URLs'}
              </button>
            </div>
          </form>
        )}

        {/* Advanced Options Disclosure */}
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800/80">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls="advanced-options-panel"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            <span>Custom alias, expiration, password, monetization &amp; tags</span>
          </button>

          {showAdvanced && (
            <div
              id="advanced-options-panel"
              className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800/80"
            >
              {/* Custom Alias (Single mode) */}
              {mode === 'single' && (
                <div>
                  <label
                    htmlFor="custom-alias-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Custom alias (optional, 3–30 chars)
                  </label>
                  <div className="mt-1.5 flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-600 dark:border-slate-700 dark:bg-slate-950">
                    <span className="select-none border-r border-slate-200 px-3 py-2.5 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      /{' '}
                    </span>
                    <input
                      id="custom-alias-input"
                      type="text"
                      value={customAlias}
                      onChange={(e) => setCustomAlias(e.target.value)}
                      placeholder="my-brand"
                      maxLength={30}
                      className="min-h-[42px] w-full bg-transparent px-3 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                    />
                  </div>
                  {customAlias.trim() && (
                    <p
                      aria-live="polite"
                      className={`mt-1 text-xs ${
                        aliasStatus.checking
                          ? 'text-slate-500 dark:text-slate-400'
                          : aliasStatus.valid && aliasStatus.available
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {aliasStatus.message}
                    </p>
                  )}
                </div>
              )}

              {/* Tags */}
              <div>
                <label
                  htmlFor="link-tags-input"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Tags (comma-separated)
                </label>
                <div className="relative mt-1.5">
                  <Tag
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="link-tags-input"
                    type="text"
                    value={tagsRaw}
                    onChange={(e) => setTagsRaw(e.target.value)}
                    placeholder="marketing, campaign-q4"
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Expiration Presets & Custom Picker */}
              <div className="sm:col-span-2">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Link expiration
                </span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(
                    [
                      ['never', 'No expiry'],
                      ['1h', '1 hour'],
                      ['24h', '24 hours'],
                      ['7d', '7 days'],
                      ['30d', '30 days'],
                      ['custom', 'Custom date'],
                    ] as Array<[ExpirationPreset, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setExpirationPreset(value)}
                      className={`min-h-[38px] rounded-md border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        expirationPreset === value
                          ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {expirationPreset === 'custom' && (
                  <div className="mt-2.5 flex items-center gap-2 max-w-xs">
                    <div className="relative flex-1">
                      <Calendar
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        ref={flatpickrRef}
                        type="text"
                        aria-label="Custom expiration date and time"
                        placeholder="Select date & time"
                        readOnly
                        className="min-h-[42px] w-full cursor-pointer rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Password Protection (Single mode) */}
              {mode === 'single' && (
                <div className="sm:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={passwordEnabled}
                        onChange={(e) => {
                          setPasswordEnabled(e.target.checked);
                          if (e.target.checked) setInterstitialEnabled(false);
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <Lock className="h-4 w-4 text-slate-500" aria-hidden="true" />
                      <span>Require password before redirecting</span>
                    </label>
                  </div>

                  {passwordEnabled && (
                    <div className="mt-2 max-w-sm">
                      <label htmlFor="link-password-input" className="sr-only">
                        Link access password
                      </label>
                      <div className="relative">
                        <input
                          id="link-password-input"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter access password (min 3 chars)"
                          className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => !p)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Monetized Sponsor Interstitial */}
              {!passwordEnabled && (
                <div className="sm:col-span-2">
                  <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={interstitialEnabled}
                      onChange={(e) => setInterstitialEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <Megaphone className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    <span>Show 5s monetized sponsor page before redirecting</span>
                  </label>

                  {interstitialEnabled && (
                    <div className="mt-2 max-w-sm">
                      <label htmlFor="hero-sponsor-select" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Sponsor / affiliate offer
                      </label>
                      <select
                        id="hero-sponsor-select"
                        value={selectedSponsorId}
                        onChange={(e) => setSelectedSponsorId(e.target.value)}
                        className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Auto-select active offer</option>
                        {activeSponsors.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submission Error Alert */}
        {submitError && (
          <div
            role="alert"
            className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}
      </div>

      {/* Instant Result Card for Single Link */}
      {recentResult && (
        <div
          aria-live="polite"
          className="animate-scale-pop mt-5 rounded-xl border border-emerald-200 bg-white p-5 dark:border-emerald-900/50 dark:bg-slate-900"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 min-w-0">
              {qrPreviewUrl && (
                <button
                  type="button"
                  onClick={() => onOpenQr(recentResult.link)}
                  aria-label="Open QR Code Studio"
                  className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 hover:border-blue-500 transition-colors"
                >
                  <img
                    src={qrPreviewUrl}
                    alt={`QR code for ${recentResult.link.code}`}
                    referrerPolicy="no-referrer"
                    className="h-16 w-16"
                  />
                </button>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">Ready to share</span>
                  {recentResult.link.isPasswordProtected && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        Password protected
                      </span>
                    </>
                  )}
                  {recentResult.link.interstitialEnabled && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400">
                        <Megaphone className="h-3 w-3" aria-hidden="true" />
                        Sponsored interstitial
                      </span>
                    </>
                  )}
                  {recentResult.strippedTrackingParams.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Cleaned {recentResult.strippedTrackingParams.length} tracking parameter
                        {recentResult.strippedTrackingParams.length > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={`/${recentResult.link.code}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-mono text-lg font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {originPrefix}
                    {recentResult.link.code}
                  </a>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                </div>

                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={recentResult.link.targetUrl}>
                  {recentResult.link.targetUrl}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(recentResult.link)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
              >
                {copiedId === recentResult.link.id ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onOpenQr(recentResult.link)}
                aria-label="Customize QR code"
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <QrCode className="h-4 w-4" aria-hidden="true" />
                <span>QR Studio</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenAnalytics(recentResult.link)}
                aria-label="View link analytics"
                className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                <span>Analytics</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Shorten Results */}
      {bulkResults && (
        <div
          aria-live="polite"
          className="animate-fade-slide-up mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Bulk Shortening Results ({bulkResults.filter((r) => r.success).length}/{bulkResults.length})
            </h2>
            <button
              type="button"
              onClick={() => setBulkResults(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {bulkResults.map((item, idx) => (
              <li key={idx} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.input}</p>
                  {item.success && item.link ? (
                    <a
                      href={`/${item.link.code}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {buildShortUrl(item.link.code)}
                    </a>
                  ) : (
                    <p className="text-xs text-rose-600 dark:text-rose-400">{item.error}</p>
                  )}
                </div>
                {item.success && item.link && (
                  <button
                    type="button"
                    onClick={() => handleCopy(item.link!)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {copiedId === item.link.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Subtle shortcut hint */}
      {lastCreatedLink && !recentResult && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            Tip: Press <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700">Ctrl+Shift+C</kbd> anytime to copy your latest link.
          </span>
        </p>
      )}
    </section>
  );
}
