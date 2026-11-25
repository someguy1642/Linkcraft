import React, { useEffect, useRef, useState } from 'react';
import flatpickr from 'flatpickr';
import { Calendar, Lock, Megaphone, X } from 'lucide-react';
import type { ExpirationPreset, ShortLink, SponsorCampaign } from '../shared/types';
import { normalizeTags, parseExpirationPreset } from '../shared/urlUtils';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastProvider';

interface EditLinkModalProps {
  link: ShortLink | null;
  sponsors: SponsorCampaign[];
  onClose: () => void;
  onUpdated: (link: ShortLink) => void;
}

export function EditLinkModal({ link, sponsors, onClose, onUpdated }: EditLinkModalProps) {
  const { showToast } = useToast();
  const { syncLinkToFirestore } = useAuth();
  const [isDisabled, setIsDisabled] = useState(false);
  const [tagsRaw, setTagsRaw] = useState('');
  const [expirationPreset, setExpirationPreset] = useState<ExpirationPreset>('never');
  const [customExpiresIso, setCustomExpiresIso] = useState<string>('');
  const [passwordAction, setPasswordAction] = useState<'keep' | 'set' | 'remove'>('keep');
  const [newPassword, setNewPassword] = useState('');
  const [interstitialEnabled, setInterstitialEnabled] = useState(false);
  const [sponsorId, setSponsorId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fpInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!link) return;
    setIsDisabled(link.isDisabled);
    setTagsRaw(link.tags.join(', '));
    setExpirationPreset(link.expiresAt ? 'custom' : 'never');
    setCustomExpiresIso(link.expiresAt || new Date(Date.now() + 7 * 86400_000).toISOString());
    setPasswordAction('keep');
    setNewPassword('');
    setInterstitialEnabled(Boolean(link.interstitialEnabled));
    setSponsorId(link.sponsorId || '');
    setError(null);
  }, [link]);

  useEffect(() => {
    if (!link || expirationPreset !== 'custom' || !fpInputRef.current) return;
    const fp = flatpickr(fpInputRef.current, {
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      minDate: new Date(Date.now() + 5 * 60_000),
      defaultDate: customExpiresIso ? new Date(customExpiresIso) : new Date(Date.now() + 7 * 86400_000),
      onChange: (dates) => {
        if (dates[0]) setCustomExpiresIso(dates[0].toISOString());
      },
    });
    return () => fp.destroy();
  }, [link, expirationPreset]);

  useEffect(() => {
    if (!link) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [link, onClose]);

  if (!link) return null;

  const activeSponsors = sponsors.filter((s) => s.active);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (passwordAction === 'set' && newPassword.length < 3) {
      setError('New password must be at least 3 characters.');
      return;
    }

    const nextExpiresAt = parseExpirationPreset(expirationPreset, customExpiresIso);
    const patch: {
      expiresAt?: string | null;
      isDisabled?: boolean;
      tags?: string[];
      password?: string | null;
      interstitialEnabled?: boolean;
      sponsorId?: string | null;
    } = {
      isDisabled,
      expiresAt: nextExpiresAt,
      interstitialEnabled,
      sponsorId: interstitialEnabled && sponsorId ? sponsorId : null,
      tags: normalizeTags(
        tagsRaw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    };

    if (passwordAction === 'set') patch.password = newPassword;
    else if (passwordAction === 'remove') patch.password = null;

    setSaving(true);
    try {
      const res = await api.updateLink(link.id, patch);
      void syncLinkToFirestore(res.link);
      onUpdated(res.link);
      showToast(`Updated /${res.link.code}`, 'success');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update link.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-link-title"
        className="animate-scale-pop w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 id="edit-link-title" className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              Manage /{link.code}
            </h2>
            <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500 dark:text-slate-400">
              {link.targetUrl}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close manage link dialog"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          {/* Active / Disabled */}
          <label className="flex min-h-[40px] cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3.5 py-2 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
              Disable redirects temporarily
            </span>
            <input
              type="checkbox"
              checked={isDisabled}
              onChange={(e) => setIsDisabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
          </label>

          {/* Monetized Sponsor Interstitial */}
          <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                <Megaphone className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>5s Sponsor Interstitial</span>
              </span>
              <input
                type="checkbox"
                checked={interstitialEnabled}
                onChange={(e) => setInterstitialEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
            </label>
            {interstitialEnabled && (
              <select
                aria-label="Select sponsor offer"
                value={sponsorId}
                onChange={(e) => setSponsorId(e.target.value)}
                className="mt-2.5 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Auto-select active sponsor offer</option>
                {activeSponsors.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Expiration controls */}
          <div>
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Expiration schedule
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  ['never', 'Remove expiry'],
                  ['24h', '+24h'],
                  ['7d', '+7d'],
                  ['30d', '+30d'],
                  ['custom', 'Custom'],
                ] as Array<[ExpirationPreset, string]>
              ).map(([val, lbl]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setExpirationPreset(val)}
                  className={`min-h-[34px] rounded-md border px-2.5 text-xs font-medium ${
                    expirationPreset === val
                      ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {expirationPreset === 'custom' && (
              <div className="relative mt-2">
                <Calendar
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  ref={fpInputRef}
                  type="text"
                  readOnly
                  aria-label="Custom expiration date"
                  className="min-h-[40px] w-full cursor-pointer rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label htmlFor="edit-tags" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tags (comma-separated)
            </label>
            <input
              id="edit-tags"
              type="text"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {/* Password settings */}
          <div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Password protection ({link.isPasswordProtected ? 'Currently enabled' : 'Not set'})</span>
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPasswordAction('keep')}
                className={`min-h-[34px] rounded-md border px-2.5 text-xs font-medium ${
                  passwordAction === 'keep'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                Keep unchanged
              </button>
              <button
                type="button"
                onClick={() => setPasswordAction('set')}
                className={`min-h-[34px] rounded-md border px-2.5 text-xs font-medium ${
                  passwordAction === 'set'
                    ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                    : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                {link.isPasswordProtected ? 'Change password' : 'Add password'}
              </button>
              {link.isPasswordProtected && (
                <button
                  type="button"
                  onClick={() => setPasswordAction('remove')}
                  className={`min-h-[34px] rounded-md border px-2.5 text-xs font-medium ${
                    passwordAction === 'remove'
                      ? 'border-rose-600 bg-rose-50 text-rose-700 dark:border-rose-500 dark:bg-rose-950/60 dark:text-rose-300'
                      : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  Remove password
                </button>
              )}
            </div>
            {passwordAction === 'set' && (
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 3 chars)"
                className="mt-2 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
