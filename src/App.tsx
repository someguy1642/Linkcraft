import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AccountBillingModal } from './components/AccountBillingModal';
import { ApiDocsView } from './components/ApiDocsView';
import { AuthProvider, useAuth } from './components/AuthContext';
import { EditLinkModal } from './components/EditLinkModal';
import { GatePage } from './components/GatePage';
import { Header, type NavSection } from './components/Header';
import { HeroShortener } from './components/HeroShortener';
import { LinksTable } from './components/LinksTable';
import { AdNetworkBanner } from './components/AdNetworkBanner';
import { OfflineBanner } from './components/OfflineBanner';
import { QrModal } from './components/QrModal';
import { SponsorManager } from './components/SponsorManager';
import { ToastProvider, useToast } from './components/ToastProvider';
import type { AdNetworkConfig, CreateLinkPayload, ShortLink, SponsorCampaign } from './shared/types';
import { api, type ListLinksParams } from './utils/api';
import {
  enqueueOfflineShorten,
  loadOfflineQueue,
  saveOfflineQueue,
  upsertGuestLink,
} from './utils/guestStorage';

const LazyAnalyticsDashboard = React.lazy(() => import('./components/AnalyticsDashboard'));

const APP_SHELL_PATHS = new Set(['', 'links', 'analytics', 'monetize', 'docs', 'index.html']);

function detectGateCode(): string | null {
  if (typeof window === 'undefined') return null;
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!pathname) return null;
  if (pathname.startsWith('r/')) return pathname.slice(2) || null;
  if (pathname.startsWith('gate/')) return pathname.slice(5) || null;
  const firstSegment = pathname.split('/')[0];
  if (APP_SHELL_PATHS.has(firstSegment.toLowerCase())) return null;
  return firstSegment;
}

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem('linkcraft_theme');
    if (stored === 'dark' || stored === 'light') return stored;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    // Ignore storage access errors
  }
  return 'light';
}

function MainWorkspace() {
  const { showToast } = useToast();
  const { user, refreshBilling } = useAuth();

  const [gateCode, setGateCode] = useState<string | null>(() => detectGateCode());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => getInitialTheme());
  const [activeSection, setActiveSection] = useState<NavSection>('shorten');

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [queuedActions, setQueuedActions] = useState(() => loadOfflineQueue());
  const [syncingQueue, setSyncingQueue] = useState(false);

  // Links & Sponsors state
  const [links, setLinks] = useState<ShortLink[]>([]);
  const [totalLinks, setTotalLinks] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [demoActive, setDemoActive] = useState(true);
  const [lastCreatedLink, setLastCreatedLink] = useState<ShortLink | null>(null);

  const [sponsors, setSponsors] = useState<SponsorCampaign[]>([]);
  const [sponsorsLoading, setSponsorsLoading] = useState(true);
  const [adConfig, setAdConfig] = useState<AdNetworkConfig | null>(null);

  const [query, setQuery] = useState<ListLinksParams>({
    search: '',
    status: 'all',
    tag: '',
    sortBy: 'createdAt',
    sortDir: 'desc',
    page: 1,
    pageSize: 25,
  });

  // Modals & Analytics Focus
  const [qrLink, setQrLink] = useState<ShortLink | null>(null);
  const [editingLink, setEditingLink] = useState<ShortLink | null>(null);
  const [analyticsLink, setAnalyticsLink] = useState<ShortLink | null>(null);
  const [billingModalOpen, setBillingModalOpen] = useState(false);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('linkcraft_theme', theme);
    } catch {
      // Ignore
    }
  }, [theme]);

  // Listen to browser back/forward navigation for gate preview
  useEffect(() => {
    const onPopState = () => {
      setGateCode(detectGateCode());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchAdSettings = useCallback(async () => {
    try {
      const res = await api.getAdSettings();
      setAdConfig(res.adConfig);
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchSponsors = useCallback(async () => {
    setSponsorsLoading(true);
    try {
      const res = await api.listSponsors();
      setSponsors(res.sponsors);
    } catch {
      // Non-fatal
    } finally {
      setSponsorsLoading(false);
    }
  }, []);

  const fetchLinks = useCallback(async () => {
    setLinksLoading(true);
    try {
      const [listRes, demoRes] = await Promise.all([api.listLinks(query), api.getDemoStatus()]);
      setLinks(listRes.items);
      setTotalLinks(listRes.total);
      setPage(listRes.page);
      setTotalPages(listRes.totalPages);
      setAvailableTags(listRes.availableTags);
      setDemoActive(demoRes.demoActive);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load links.', 'error');
    } finally {
      setLinksLoading(false);
    }
  }, [query, showToast]);

  useEffect(() => {
    if (!gateCode) {
      void fetchLinks();
      void fetchSponsors();
      void fetchAdSettings();
    }
  }, [gateCode, user?.uid, fetchLinks, fetchSponsors, fetchAdSettings]);

  // Flush offline queue when connection returns
  const flushOfflineQueue = useCallback(async () => {
    const pending = loadOfflineQueue();
    if (pending.length === 0 || !navigator.onLine) return;
    setSyncingQueue(true);
    const remaining = [...pending];
    let syncedCount = 0;

    for (const item of pending) {
      try {
        const res = await api.createLink(item.payload);
        upsertGuestLink(res.link);
        setLastCreatedLink(res.link);
        remaining.shift();
        syncedCount += 1;
      } catch {
        break;
      }
    }

    saveOfflineQueue(remaining);
    setQueuedActions(remaining);
    setSyncingQueue(false);

    if (syncedCount > 0) {
      showToast(`Synced ${syncedCount} queued link${syncedCount === 1 ? '' : 's'}!`, 'success');
      void fetchLinks();
      void refreshBilling();
    }
  }, [fetchLinks, refreshBilling, showToast]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void flushOfflineQueue();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flushOfflineQueue]);

  // IntersectionObserver for subtle scroll-reveal sections
  useEffect(() => {
    if (gateCode) return;
    const nodes = document.querySelectorAll('.reveal-on-scroll');
    if (typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('is-visible'));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08 },
    );
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, [gateCode, activeSection]);

  const handleNavigate = (section: NavSection) => {
    setActiveSection(section);
    const el = document.getElementById(section);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleQueueOffline = (payload: CreateLinkPayload) => {
    const next = enqueueOfflineShorten(payload);
    setQueuedActions(next);
    showToast('Saved offline — will shorten automatically when reconnected.', 'info');
  };

  const handleToggleDemo = async (enable: boolean) => {
    try {
      if (enable) {
        await api.loadDemoData();
        showToast('Sample dataset loaded', 'success');
      } else {
        await api.clearDemoData();
        showToast('Demo dataset cleared', 'info');
      }
      await Promise.all([fetchLinks(), fetchSponsors()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update demo mode.', 'error');
    }
  };

  if (gateCode) {
    return (
      <GatePage
        code={gateCode}
        onBackHome={() => {
          window.history.pushState({}, '', '/');
          setGateCode(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>

      <Header
        activeSection={activeSection}
        onNavigate={handleNavigate}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenAccount={() => setBillingModalOpen(true)}
      />

      <OfflineBanner
        isOnline={isOnline}
        queuedCount={queuedActions.length}
        isSyncing={syncingQueue}
        onRetrySync={() => void flushOfflineQueue()}
      />

      <main id="main-content" className="flex-1">
        <HeroShortener
          sponsors={sponsors}
          onLinkCreated={(link) => {
            upsertGuestLink(link);
            setLastCreatedLink(link);
            void fetchLinks();
          }}
          onBulkCreated={(created) => {
            created.forEach(upsertGuestLink);
            if (created[0]) setLastCreatedLink(created[0]);
            void fetchLinks();
          }}
          onQueueOffline={handleQueueOffline}
          onOpenQr={(link) => setQrLink(link)}
          onOpenAnalytics={(link) => {
            setAnalyticsLink(link);
            handleNavigate('analytics');
          }}
          onOpenBilling={() => setBillingModalOpen(true)}
          lastCreatedLink={lastCreatedLink}
          isOnline={isOnline}
        />

        {adConfig?.enabled && adConfig?.showOnHomepage && (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <AdNetworkBanner config={adConfig} placement="homepage" />
          </div>
        )}

        <div className="border-t border-slate-200/80 dark:border-slate-800/80" />

        <div className="reveal-on-scroll is-visible">
          <LinksTable
            links={links}
            total={totalLinks}
            page={page}
            totalPages={totalPages}
            availableTags={availableTags}
            loading={linksLoading}
            demoActive={demoActive}
            query={query}
            onQueryChange={(patch) => setQuery((prev) => ({ ...prev, ...patch }))}
            onRefresh={() => {
              void fetchLinks();
              void refreshBilling();
            }}
            onOpenQr={(link) => setQrLink(link)}
            onOpenAnalytics={(link) => {
              setAnalyticsLink(link);
              handleNavigate('analytics');
            }}
            onEditLink={(link) => setEditingLink(link)}
            onToggleDemo={(enable) => void handleToggleDemo(enable)}
          />
        </div>

        <div className="border-t border-slate-200/80 dark:border-slate-800/80" />

        <div className="reveal-on-scroll">
          <Suspense
            fallback={
              <section id="analytics" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
                <div className="h-8 w-56 rounded bg-slate-200 animate-pulse dark:bg-slate-800" />
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-28 rounded-xl border border-slate-200 bg-white animate-pulse dark:border-slate-800 dark:bg-slate-900"
                    />
                  ))}
                </div>
              </section>
            }
          >
            <LazyAnalyticsDashboard
              links={links}
              selectedLink={analyticsLink}
              onSelectLink={(link) => setAnalyticsLink(link)}
              theme={theme}
            />
          </Suspense>
        </div>

        <div className="border-t border-slate-200/80 dark:border-slate-800/80" />

        <div className="reveal-on-scroll">
          <SponsorManager
            sponsors={sponsors}
            loading={sponsorsLoading}
            onRefresh={async () => {
              await Promise.all([fetchSponsors(), fetchAdSettings()]);
            }}
            onPreviewInterstitial={(code) => {
              window.history.pushState({}, '', `/gate/${code}`);
              setGateCode(code);
            }}
          />
        </div>

        <div className="border-t border-slate-200/80 dark:border-slate-800/80" />

        <div className="reveal-on-scroll">
          <ApiDocsView />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
          <span>Linkcraft — Full-Stack URL Shortener, Monetization &amp; Analytics</span>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="mailto:someking2026@outlook.com"
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Support: someking2026@outlook.com
            </a>
            <a href="/openapi.json" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 dark:hover:text-white">
              OpenAPI 3.0 Spec
            </a>
            <button
              type="button"
              onClick={() => setBillingModalOpen(true)}
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Plans &amp; Billing
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('shorten')}
              className="hover:text-slate-900 dark:hover:text-white"
            >
              Back to top
            </button>
          </div>
        </div>
      </footer>

      <QrModal link={qrLink} onClose={() => setQrLink(null)} />
      <EditLinkModal
        link={editingLink}
        sponsors={sponsors}
        onClose={() => setEditingLink(null)}
        onUpdated={(updated) => {
          upsertGuestLink(updated);
          if (analyticsLink?.id === updated.id) setAnalyticsLink(updated);
          void fetchLinks();
        }}
      />
      <AccountBillingModal open={billingModalOpen} onClose={() => setBillingModalOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <MainWorkspace />
      </AuthProvider>
    </ToastProvider>
  );
}
