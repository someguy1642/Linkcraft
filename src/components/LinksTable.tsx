import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  Lock,
  Megaphone,
  Pencil,
  QrCode,
  Search,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { ShortLink } from '../shared/types';
import { formatTimeRemaining } from '../shared/urlUtils';
import { api, type ListLinksParams } from '../utils/api';
import { buildShortUrl, copyToClipboard } from '../utils/clipboard';
import { useToast } from './ToastProvider';

interface LinksTableProps {
  links: ShortLink[];
  total: number;
  page: number;
  totalPages: number;
  availableTags: string[];
  loading: boolean;
  demoActive: boolean;
  query: ListLinksParams;
  onQueryChange: (patch: Partial<ListLinksParams>) => void;
  onRefresh: () => void;
  onOpenQr: (link: ShortLink) => void;
  onOpenAnalytics: (link: ShortLink) => void;
  onEditLink: (link: ShortLink) => void;
  onToggleDemo: (enable: boolean) => void;
}

export function LinksTable({
  links,
  total,
  page,
  totalPages,
  availableTags,
  loading,
  demoActive,
  query,
  onQueryChange,
  onRefresh,
  onOpenQr,
  onOpenAnalytics,
  onEditLink,
  onToggleDemo,
}: LinksTableProps) {
  const { showToast } = useToast();
  const [searchInput, setSearchInput] = useState(query.search || '');
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // Debounce search input (250ms)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput !== (query.search || '')) {
        onQueryChange({ search: searchInput, page: 1 });
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Prune selections when list changes
  useEffect(() => {
    const currentSet = new Set(links.map((l) => l.id));
    setSelectedIds((prev) => prev.filter((id) => currentSet.has(id)));
  }, [links]);

  const allOnPageSelected = links.length > 0 && links.every((l) => selectedIds.includes(l.id));

  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(links.map((l) => l.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCopy = async (link: ShortLink) => {
    const ok = await copyToClipboard(buildShortUrl(link.code));
    if (ok) {
      setCopiedId(link.id);
      showToast('Copied!', 'success', 2000);
      window.setTimeout(() => setCopiedId((c) => (c === link.id ? null : c)), 2000);
    }
  };

  const handleDeleteOne = async (link: ShortLink) => {
    setBusyAction(true);
    try {
      await api.deleteLink(link.id);
      showToast(`Deleted /${link.code}`, 'info');
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete link.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleBulkAction = async (action: 'delete' | 'disable' | 'activate') => {
    if (selectedIds.length === 0) return;
    setBusyAction(true);
    try {
      const res = await api.bulkAction(action, selectedIds);
      setSelectedIds([]);
      const label = action === 'delete' ? 'Deleted' : action === 'disable' ? 'Disabled' : 'Activated';
      showToast(`${label} ${res.affected} link${res.affected === 1 ? '' : 's'}`, 'success');
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bulk action failed.', 'error');
    } finally {
      setBusyAction(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    const ids = selectedIds.length > 0 ? selectedIds : links.map((l) => l.id);
    if (ids.length === 0) return;
    try {
      await api.exportLinks(format, ids);
      showToast(`Exported ${ids.length} link${ids.length === 1 ? '' : 's'} as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed.', 'error');
    }
  };

  const toggleSort = (col: 'createdAt' | 'clicks' | 'code') => {
    if (query.sortBy === col) {
      onQueryChange({ sortDir: query.sortDir === 'asc' ? 'desc' : 'asc', page: 1 });
    } else {
      onQueryChange({ sortBy: col, sortDir: col === 'code' ? 'asc' : 'desc', page: 1 });
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        new Date(iso),
      );
    } catch {
      return iso.slice(0, 10);
    }
  };

  return (
    <section id="links" aria-labelledby="links-heading" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="links-heading" className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            Link History &amp; Management
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400 tabular-nums">
            {total} {total === 1 ? 'link' : 'links'} matching current filters
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleDemo(!demoActive)}
            className={`min-h-[40px] inline-flex items-center gap-2 rounded-lg border px-3.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              demoActive
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/60 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{demoActive ? 'Demo Data: On' : 'Load Demo Data'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={links.length === 0}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search input */}
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search links by URL, alias, or tag"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search URLs, aliases, or tags..."
              className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {/* Status segmented filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Filter links by status"
              className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950"
            >
              {(
                [
                  ['all', 'All'],
                  ['active', 'Active'],
                  ['protected', 'Protected'],
                  ['sponsored', 'Sponsored'],
                  ['expired', 'Expired'],
                  ['disabled', 'Disabled'],
                ] as const
              ).map(([val, label]) => {
                const active = (query.status || 'all') === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onQueryChange({ status: val, page: 1 })}
                    className={`min-h-[34px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              aria-expanded={showMoreFilters}
              onClick={() => setShowMoreFilters((p) => !p)}
              className={`min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                showMoreFilters
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Filters</span>
            </button>
          </div>
        </div>

        {/* Extended Filters Row (Tags, Date Range, Click Range) */}
        {showMoreFilters && (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800">
            <div>
              <label htmlFor="filter-tag" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Tag
              </label>
              <select
                id="filter-tag"
                value={query.tag || ''}
                onChange={(e) => onQueryChange({ tag: e.target.value, page: 1 })}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">All tags</option>
                {availableTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-date-from" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Created from
              </label>
              <input
                id="filter-date-from"
                type="date"
                value={query.dateFrom || ''}
                onChange={(e) => onQueryChange({ dateFrom: e.target.value, page: 1 })}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="filter-date-to" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Created to
              </label>
              <input
                id="filter-date-to"
                type="date"
                value={query.dateTo || ''}
                onChange={(e) => onQueryChange({ dateTo: e.target.value, page: 1 })}
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div>
              <label htmlFor="filter-min-clicks" className="block text-xs font-medium text-slate-600 dark:text-slate-400">
                Min clicks
              </label>
              <input
                id="filter-min-clicks"
                type="number"
                min={0}
                value={query.minClicks || ''}
                onChange={(e) => onQueryChange({ minClicks: e.target.value, page: 1 })}
                placeholder="0"
                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  onQueryChange({
                    search: '',
                    status: 'all',
                    tag: '',
                    dateFrom: '',
                    dateTo: '',
                    minClicks: '',
                    maxClicks: '',
                    page: 1,
                  });
                }}
                className="min-h-[38px] w-full rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Reset filters
              </button>
            </div>
          </div>
        )}

        {/* Bulk selection action bar */}
        {selectedIds.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/80 px-3.5 py-2.5 dark:border-blue-900/60 dark:bg-blue-950/40">
            <span className="text-xs font-semibold text-blue-900 dark:text-blue-200 tabular-nums">
              {selectedIds.length} link{selectedIds.length === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleBulkAction('activate')}
                className="min-h-[34px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Enable
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleBulkAction('disable')}
                className="min-h-[34px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Disable
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="min-h-[34px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => handleExport('json')}
                className="min-h-[34px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                JSON
              </button>
              <button
                type="button"
                disabled={busyAction}
                onClick={() => handleBulkAction('delete')}
                className="min-h-[34px] rounded-md bg-rose-600 px-2.5 text-xs font-medium text-white hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="divide-y divide-slate-100 p-4 dark:divide-slate-800" aria-busy="true" aria-label="Loading links">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4 py-3.5 animate-pulse">
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-44 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-72 rounded bg-slate-100 dark:bg-slate-800/60" />
                </div>
                <div className="h-4 w-16 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-8 w-28 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ) : links.length === 0 ? (
          /* Clean Empty State */
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <svg
              width="64"
              height="64"
              viewBox="0 0 64 64"
              fill="none"
              aria-hidden="true"
              className="text-slate-300 dark:text-slate-700"
            >
              <rect x="8" y="14" width="48" height="36" rx="6" stroke="currentColor" strokeWidth="2" />
              <path d="M18 26h28M18 34h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="46" cy="40" r="9" className="fill-white dark:fill-slate-900" stroke="currentColor" strokeWidth="2" />
              <path d="M43 40h6M46 37v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <h3 className="mt-4 font-display text-base font-semibold text-slate-900 dark:text-white">
              No shortened links found
            </h3>
            <p className="mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-400">
              {query.search || (query.status && query.status !== 'all') || query.tag
                ? 'Try clearing your search or status filters to see more links.'
                : 'Shorten your first URL above or load the sample dataset to explore analytics.'}
            </p>
            {!demoActive && !query.search && (
              <button
                type="button"
                onClick={() => onToggleDemo(true)}
                className="mt-4 min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                <Database className="h-4 w-4" aria-hidden="true" />
                <span>Load Sample Dataset</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="w-10 py-3 pl-4 pr-2">
                    <input
                      type="checkbox"
                      aria-label="Select all links on this page"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    />
                  </th>
                  <th className="py-3 px-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('code')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Short Link &amp; Destination</span>
                      {query.sortBy === 'code' && (
                        <span aria-hidden="true">{query.sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('clicks')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Clicks</span>
                      {query.sortBy === 'clicks' && (
                        <span aria-hidden="true">{query.sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 px-3 hidden md:table-cell">
                    <button
                      type="button"
                      onClick={() => toggleSort('createdAt')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
                    >
                      <span>Created</span>
                      {(query.sortBy || 'createdAt') === 'createdAt' && (
                        <span aria-hidden="true">{query.sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  </th>
                  <th className="py-3 pl-3 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {links.map((link) => {
                  const fullShort = buildShortUrl(link.code);
                  const remaining = formatTimeRemaining(link.expiresAt);
                  return (
                    <tr
                      key={link.id}
                      className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3.5 pl-4 pr-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select link /${link.code}`}
                          checked={selectedIds.includes(link.id)}
                          onChange={() => toggleSelectOne(link.id)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                      </td>
                      <td className="py-3.5 px-3 max-w-[320px] sm:max-w-md">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`/${link.code}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm font-semibold text-blue-600 hover:underline truncate dark:text-blue-400"
                          >
                            /{link.code}
                          </a>
                          {link.isPasswordProtected && (
                            <span
                              title="Password protected"
                              aria-label="Password protected"
                              className="inline-flex items-center text-amber-600 dark:text-amber-400"
                            >
                              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                          )}
                          {link.interstitialEnabled && (
                            <span
                              title="Monetized sponsor interstitial"
                              aria-label="Monetized sponsor interstitial"
                              className="inline-flex items-center text-blue-600 dark:text-blue-400"
                            >
                              <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
                            </span>
                          )}
                          <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                        </div>

                        <p
                          className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-400"
                          title={link.targetUrl}
                        >
                          {link.targetUrl}
                        </p>

                        {/* Zero-pill metadata line */}
                        {(link.tags.length > 0 || link.expiresAt || link.interstitialEnabled) && (
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {link.tags.length > 0 && <span>{link.tags.join(' · ')}</span>}
                            {link.tags.length > 0 && (link.expiresAt || link.interstitialEnabled) && (
                              <span aria-hidden="true">/</span>
                            )}
                            {link.interstitialEnabled && (
                              <span className="text-blue-700 dark:text-blue-400">Sponsored</span>
                            )}
                            {link.interstitialEnabled && link.expiresAt && <span aria-hidden="true">/</span>}
                            {link.expiresAt && (
                              <span
                                className={
                                  link.status === 'expired'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }
                              >
                                {remaining}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-3 align-top whitespace-nowrap">
                        <span
                          className={`text-xs font-medium ${
                            link.status === 'active'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : link.status === 'expired'
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {link.status === 'active'
                            ? 'Active'
                            : link.status === 'expired'
                              ? 'Expired'
                              : 'Disabled'}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 align-top text-right tabular-nums whitespace-nowrap">
                        <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">
                          {link.clicks.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {link.uniqueClicks.toLocaleString()} unique
                        </div>
                      </td>

                      <td className="py-3.5 px-3 align-top hidden md:table-cell whitespace-nowrap text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {formatDate(link.createdAt)}
                      </td>

                      <td className="py-3.5 pl-3 pr-4 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopy(link)}
                            aria-label={`Copy short link ${fullShort}`}
                            title="Copy short link"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            {copiedId === link.id ? (
                              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            ) : (
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenQr(link)}
                            aria-label={`QR code for /${link.code}`}
                            title="QR Code Studio"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <QrCode className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenAnalytics(link)}
                            aria-label={`Analytics for /${link.code}`}
                            title="View Analytics"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <BarChart3 className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditLink(link)}
                            aria-label={`Manage /${link.code}`}
                            title="Edit or Extend Expiration"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => handleDeleteOne(link)}
                            aria-label={`Delete /${link.code}`}
                            title="Delete Link"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
            <span className="tabular-nums">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onQueryChange({ page: page - 1 })}
                aria-label="Previous page"
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span>Previous</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onQueryChange({ page: page + 1 })}
                aria-label="Next page"
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 px-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <span>Next</span>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
