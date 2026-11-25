import React, { useEffect, useState } from 'react';
import {
  Code,
  ExternalLink,
  Eye,
  HelpCircle,
  LayoutTemplate,
  Megaphone,
  MousePointerClick,
  Pause,
  Play,
  Plus,
  Radio,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AdNetworkConfig, SponsorCampaign } from '../shared/types';
import { validateAndSanitizeUrl } from '../shared/urlUtils';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastProvider';

interface SponsorManagerProps {
  sponsors: SponsorCampaign[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onPreviewInterstitial: (code: string) => void;
}

interface AffiliatePreset {
  id: string;
  name: string;
  payoutBadge: string;
  category: string;
  title: string;
  description: string;
  ctaLabel: string;
  badgeText: string;
  defaultPlaceholderUrl: string;
  programUrl: string;
  setupTip: string;
}

const AFFILIATE_PRESETS: AffiliatePreset[] = [
  {
    id: 'nordvpn',
    name: 'NordVPN',
    payoutBadge: '40%–100% Commission',
    category: 'Cybersecurity',
    title: 'NordVPN — 72% Off + 3 Free Months Extra',
    description: 'Protect your browsing with malware defense, super-fast streaming servers, and strict no-logs policy.',
    ctaLabel: 'Claim VPN Discount',
    badgeText: 'VPN Deal',
    defaultPlaceholderUrl: 'https://nordvpn.com',
    programUrl: 'https://nordvpn.com/affiliate',
    setupTip: 'Sign up free at nordvpn.com/affiliate to get your referral link and paste it in the URL box.',
  },
  {
    id: 'hostinger',
    name: 'Hostinger',
    payoutBadge: '$60+ Per Sale',
    category: 'Web Hosting',
    title: 'Hostinger — Fast Cloud & WordPress Hosting from $2.99/mo',
    description: 'Launch websites with 99.9% uptime guarantee, free SSL certificate, free domain, and 24/7 live support.',
    ctaLabel: 'Get Web Hosting',
    badgeText: 'Special Offer',
    defaultPlaceholderUrl: 'https://hostinger.com',
    programUrl: 'https://www.hostinger.com/affiliates',
    setupTip: 'Join free at hostinger.com/affiliates. Every visitor who signs up earns you $60 or more.',
  },
  {
    id: 'amazon',
    name: 'Amazon Deals',
    payoutBadge: '1%–10% Entire Cart',
    category: 'Shopping',
    title: 'Amazon Trending Electronics & Work Essentials',
    description: 'Explore today’s discounts on wireless headphones, laptops, smart home gear, and office tech.',
    ctaLabel: 'Explore Amazon Deals',
    badgeText: 'Amazon Partner',
    defaultPlaceholderUrl: 'https://amazon.com',
    programUrl: 'https://affiliate-program.amazon.com',
    setupTip: 'Join Amazon Associates. You earn commission on anything the visitor buys on Amazon for 24 hours!',
  },
  {
    id: 'notion',
    name: 'Notion AI',
    payoutBadge: '20% Monthly Recurring',
    category: 'Productivity',
    title: 'Notion — Connected Workspace with Built-in AI',
    description: 'Organize notes, team docs, tasks, and project workflows with effortless AI writing assistance.',
    ctaLabel: 'Try Notion Free',
    badgeText: 'Featured Tool',
    defaultPlaceholderUrl: 'https://notion.so',
    programUrl: 'https://www.notion.so/affiliates',
    setupTip: 'Join the Notion Affiliate Program to earn 20% recurring monthly income for every paying subscriber.',
  },
];

export function SponsorManager({
  sponsors,
  loading,
  onRefresh,
  onPreviewInterstitial,
}: SponsorManagerProps) {
  const { showToast } = useToast();
  const { syncSponsorToFirestore } = useAuth();

  const [activeTab, setActiveTab] = useState<'sponsors' | 'templates' | 'adnetwork'>('sponsors');

  // Sponsor Offer form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Visit Offer');
  const [ctaUrl, setCtaUrl] = useState('');
  const [badgeText, setBadgeText] = useState('Sponsored');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedPresetTip, setSelectedPresetTip] = useState<string | null>(null);

  // Ad Network Settings
  const [adConfig, setAdConfig] = useState<AdNetworkConfig>({
    enabled: false,
    networkType: 'banner_html',
    networkName: 'Monetag / Adsterra / Custom',
    bannerHtml: '',
    bannerImageUrl: '',
    bannerTargetUrl: '',
    directAdUrl: '',
    showOnInterstitial: true,
    showOnHomepage: false,
    updatedAt: new Date().toISOString(),
  });
  const [adSaving, setAdSaving] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);

  useEffect(() => {
    void api.getAdSettings().then((res) => {
      if (res.adConfig) {
        setAdConfig(res.adConfig);
      }
    }).catch(() => {
      // Ignore if offline
    });
  }, []);

  const totalImpressions = sponsors.reduce((sum, s) => sum + s.impressions, 0);
  const totalClicks = sponsors.reduce((sum, s) => sum + s.clicks, 0);
  const overallCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0';

  const applyPreset = (preset: AffiliatePreset) => {
    setTitle(preset.title);
    setDescription(preset.description);
    setCtaLabel(preset.ctaLabel);
    setBadgeText(preset.badgeText);
    setCtaUrl(preset.defaultPlaceholderUrl);
    setSelectedPresetTip(preset.setupTip);
    setShowForm(true);
    setActiveTab('sponsors');
    showToast(`Template applied: ${preset.name}! Paste your referral link below.`, 'success');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (title.trim().length < 3) {
      setFormError('Headline must be at least 3 characters.');
      return;
    }
    const urlCheck = validateAndSanitizeUrl(ctaUrl);
    if (!urlCheck.valid || !urlCheck.sanitizedUrl) {
      setFormError(urlCheck.error || 'Enter a valid http(s) offer URL.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.createSponsor({
        title: title.trim(),
        description: description.trim(),
        ctaLabel: ctaLabel.trim() || 'Learn More',
        ctaUrl: urlCheck.sanitizedUrl,
        badgeText: badgeText.trim() || 'Sponsored',
        active: true,
      });
      void syncSponsorToFirestore(res.sponsor);
      showToast('Sponsor offer created!', 'success');
      setTitle('');
      setDescription('');
      setCtaLabel('Visit Offer');
      setCtaUrl('');
      setBadgeText('Sponsored');
      setSelectedPresetTip(null);
      setShowForm(false);
      await onRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to create sponsor offer.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (sp: SponsorCampaign) => {
    try {
      const res = await api.updateSponsor(sp.id, { active: !sp.active });
      void syncSponsorToFirestore(res.sponsor);
      showToast(res.sponsor.active ? 'Campaign activated' : 'Campaign paused', 'info');
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update campaign.', 'error');
    }
  };

  const handleDelete = async (sp: SponsorCampaign) => {
    try {
      await api.deleteSponsor(sp.id);
      showToast('Sponsor campaign deleted', 'info');
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete campaign.', 'error');
    }
  };

  const handleSaveAdSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdNotice(null);

    if (adConfig.enabled) {
      if (adConfig.networkType === 'banner_html' && !(adConfig.bannerHtml || '').trim()) {
        setAdNotice('Paste your HTML or <script> ad code before enabling ads.');
        return;
      }
      if (adConfig.networkType === 'image_banner' && !(adConfig.bannerImageUrl || '').trim()) {
        setAdNotice('Enter a Banner Image URL before enabling Image Banner mode.');
        return;
      }
      if (adConfig.networkType === 'direct_link' && !(adConfig.directAdUrl || '').trim()) {
        setAdNotice('Enter a Direct Ad / Smartlink URL before enabling Direct Link mode.');
        return;
      }
    }

    setAdSaving(true);
    try {
      const res = await api.saveAdSettings(adConfig);
      setAdConfig(res.adConfig);
      await onRefresh();
      showToast('Ad network settings saved!', 'success');
    } catch (err) {
      setAdNotice(err instanceof Error ? err.message : 'Failed to save ad settings.');
    } finally {
      setAdSaving(false);
    }
  };

  return (
    <section
      id="monetize"
      aria-labelledby="monetize-heading"
      className="scroll-mt-20 mx-auto max-w-6xl px-4 py-8 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="monetize-heading" className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            Monetization &amp; Ads
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Earn money from shortened links using pre-built affiliate offers, custom sponsors, or third-party ad networks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPreviewInterstitial('preview')}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Preview Interstitial</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('sponsors');
              setShowForm((p) => !p);
            }}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showForm ? 'Close Form' : 'New Offer'}</span>
          </button>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setActiveTab('sponsors')}
          className={`flex min-h-[42px] items-center gap-2 border-b-2 px-4 text-xs font-semibold transition-colors ${
            activeTab === 'sponsors'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Active Offers ({sponsors.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`flex min-h-[42px] items-center gap-2 border-b-2 px-4 text-xs font-semibold transition-colors ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          <span>Affiliate Presets (No Sponsors Needed)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('adnetwork')}
          className={`flex min-h-[42px] items-center gap-2 border-b-2 px-4 text-xs font-semibold transition-colors ${
            activeTab === 'adnetwork'
              ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
              : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
          }`}
        >
          <Code className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Ad Network Script / Code</span>
          {adConfig.enabled && (
            <span className="h-2 w-2 rounded-full bg-emerald-500" title="Active" />
          )}
        </button>
      </div>

      {/* Summary KPI strip */}
      {activeTab === 'sponsors' && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Interstitial Views</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalImpressions.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Offer Clicks</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {totalClicks.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Average Click-Through (CTR)</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {overallCtr}%
            </p>
          </div>
        </div>
      )}

      {/* Create Campaign Form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-5 rounded-xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900/60 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Create Offer or Affiliate Banner
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Shown to visitors during the 5-second countdown on links with the Interstitial toggle enabled.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('templates')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              <Sparkles className="h-3 w-3" />
              <span>Use a Template</span>
            </button>
          </div>

          {selectedPresetTip && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/80 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-200">
              <HelpCircle className="h-4 w-4 shrink-0 text-blue-600 mt-0.5" />
              <p className="leading-relaxed">{selectedPresetTip}</p>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sp-title" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Offer headline
              </label>
              <input
                id="sp-title"
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="NordVPN — 72% Off + 3 Months Free"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="sp-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Your affiliate or referral link URL
              </label>
              <input
                id="sp-url"
                type="url"
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://your-affiliate-link.com/?ref=yourid"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="sp-desc" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Short description (pitch for visitors)
              </label>
              <input
                id="sp-desc"
                type="text"
                maxLength={200}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Browse securely with malware defense, ultra-fast streaming, and zero tracking logs."
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="sp-cta" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Button label
              </label>
              <input
                id="sp-cta"
                type="text"
                maxLength={30}
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Claim Discount"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="sp-badge" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Tag / disclosure badge
              </label>
              <input
                id="sp-badge"
                type="text"
                maxLength={24}
                value={badgeText}
                onChange={(e) => setBadgeText(e.target.value)}
                placeholder="Partner Deal"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          {formError && (
            <p role="alert" className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400">
              {formError}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setSelectedPresetTip(null);
              }}
              className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[40px] rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Offer'}
            </button>
          </div>
        </form>
      )}

      {/* TAB 1: ACTIVE SPONSOR OFFERS */}
      {activeTab === 'sponsors' && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {loading ? (
            Array.from({ length: 2 }).map((_, idx) => (
              <div
                key={idx}
                className="h-36 rounded-xl border border-slate-200 bg-white animate-pulse dark:border-slate-800 dark:bg-slate-900"
              />
            ))
          ) : sponsors.length === 0 ? (
            <div className="md:col-span-2 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
              <Megaphone className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-200">No active offers yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Click <strong>"Affiliate Presets"</strong> above to pick a ready-to-use template like NordVPN or Amazon!
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('templates')}
                className="mt-4 inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Browse Affiliate Presets</span>
              </button>
            </div>
          ) : (
            sponsors.map((sp) => {
              const ctr = sp.impressions > 0 ? ((sp.clicks / sp.impressions) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={sp.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                            {sp.badgeText}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={sp.active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}>
                            {sp.active ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <h3 className="mt-1 font-display text-base font-semibold text-slate-900 dark:text-white">
                          {sp.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleActive(sp)}
                          title={sp.active ? 'Pause offer' : 'Activate offer'}
                          aria-label={sp.active ? `Pause ${sp.title}` : `Activate ${sp.title}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {sp.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(sp)}
                          title="Delete offer"
                          aria-label={`Delete ${sp.title}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {sp.description && (
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {sp.description}
                      </p>
                    )}

                    <a
                      href={sp.ctaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <span className="truncate max-w-[260px]">{sp.ctaLabel}: {sp.ctaUrl}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        <strong className="font-mono text-slate-900 dark:text-slate-100">
                          {sp.impressions.toLocaleString()}
                        </strong>{' '}
                        views
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
                        <strong className="font-mono text-slate-900 dark:text-slate-100">
                          {sp.clicks.toLocaleString()}
                        </strong>{' '}
                        clicks ({ctr}% CTR)
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onPreviewInterstitial('preview')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      <Eye className="h-3 w-3" />
                      <span>Preview Gate</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: AFFILIATE PRESETS */}
      {activeTab === 'templates' && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-semibold flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-600" />
              <span>How Affiliate Presets Work (No Direct Sponsors Required)</span>
            </p>
            <p className="mt-1 leading-relaxed">
              1. Choose any brand below and click <strong>"Get Affiliate Link"</strong> to create a free account.<br />
              2. Click <strong>"Use Template"</strong> to load the high-converting copy.<br />
              3. Replace the placeholder URL with your referral link and save. Every visitor who signs up earns you cash!
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {AFFILIATE_PRESETS.map((p) => (
              <div
                key={p.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {p.category}
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      {p.payoutBadge}
                    </span>
                  </div>

                  <h3 className="mt-2 font-display text-base font-semibold text-slate-900 dark:text-white">
                    {p.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {p.description}
                  </p>

                  <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <p className="font-medium text-slate-900 dark:text-white">Example Preview:</p>
                    <p className="mt-0.5 font-semibold text-blue-600 dark:text-blue-400">{p.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Button: "{p.ctaLabel}"</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <a
                    href={p.programUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  >
                    <span>Join Free</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>

                  <button
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <LayoutTemplate className="h-3 w-3" />
                    <span>Use Template</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: AD NETWORK SCRIPT / BANNER EMBED */}
      {activeTab === 'adnetwork' && (
        <form
          onSubmit={handleSaveAdSettings}
          className="mt-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Automated Ad Network &amp; Banner Code
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connect external networks like Monetag, Adsterra, Google AdSense, or your own HTML banner snippet.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
              <input
                type="checkbox"
                checked={adConfig.enabled}
                onChange={(e) => setAdConfig({ ...adConfig, enabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span className={adConfig.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
                {adConfig.enabled ? 'Ads Active' : 'Ads Disabled'}
              </span>
            </label>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Ad Display Mode
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'banner_html', label: 'HTML / JS Ad Script', icon: Code },
                  { id: 'image_banner', label: 'Image Banner + Link', icon: LayoutTemplate },
                  { id: 'direct_link', label: 'Direct Ad Link (Pop/Direct)', icon: Radio },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setAdConfig({ ...adConfig, networkType: mode.id as any })}
                    className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                      adConfig.networkType === mode.id
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                    }`}
                  >
                    <mode.icon className="h-3.5 w-3.5" />
                    <span>{mode.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {adConfig.networkType === 'banner_html' && (
              <div>
                <label htmlFor="ad-html" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Ad Network Snippet (HTML, &lt;script&gt;, or &lt;iframe&gt;)
                </label>
                <textarea
                  id="ad-html"
                  rows={4}
                  value={adConfig.bannerHtml || ''}
                  onChange={(e) => setAdConfig({ ...adConfig, bannerHtml: e.target.value })}
                  placeholder={'<!-- Paste Monetag, Adsterra, or AdSense code snippet here -->\n<script ...></script>'}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Renders inside a secure, responsive container on the redirect screen and/or homepage.
                </p>
              </div>
            )}

            {adConfig.networkType === 'image_banner' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ad-img-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Banner Image URL
                  </label>
                  <input
                    id="ad-img-url"
                    type="url"
                    value={adConfig.bannerImageUrl || ''}
                    onChange={(e) => setAdConfig({ ...adConfig, bannerImageUrl: e.target.value })}
                    placeholder="https://example.com/banner-728x90.png"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label htmlFor="ad-target-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Target Click URL
                  </label>
                  <input
                    id="ad-target-url"
                    type="url"
                    value={adConfig.bannerTargetUrl || ''}
                    onChange={(e) => setAdConfig({ ...adConfig, bannerTargetUrl: e.target.value })}
                    placeholder="https://network-click.com/ref=123"
                    className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            )}

            {adConfig.networkType === 'direct_link' && (
              <div>
                <label htmlFor="ad-direct-url" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Direct Ad / Smartlink URL (e.g. Monetag Direct Link)
                </label>
                <input
                  id="ad-direct-url"
                  type="url"
                  value={adConfig.directAdUrl || ''}
                  onChange={(e) => setAdConfig({ ...adConfig, directAdUrl: e.target.value })}
                  placeholder="https://direct.adnetwork.com/smartlink-url"
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            )}

            {/* Display Locations */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                Ad Placement Locations
              </span>
              <div className="flex flex-col sm:flex-row gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adConfig.showOnInterstitial}
                    onChange={(e) => setAdConfig({ ...adConfig, showOnInterstitial: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Show on 5s Redirect Interstitial Gate</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={adConfig.showOnHomepage}
                    onChange={(e) => setAdConfig({ ...adConfig, showOnHomepage: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>Show Banner Slot on Linkcraft Homepage</span>
                </label>
              </div>
            </div>
          </div>

          {adNotice && (
            <p role="alert" className="mt-3 text-xs font-medium text-rose-600 dark:text-rose-400">
              {adNotice}
            </p>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={adSaving}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{adSaving ? 'Saving...' : 'Save Ad Settings'}</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
