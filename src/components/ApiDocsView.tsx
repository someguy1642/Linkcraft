import { Check, Copy, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import { useToast } from './ToastProvider';

interface EndpointSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  params: string;
  response: string;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    method: 'POST',
    path: '/api/links',
    summary: 'Create shortened link (20 req/min/IP)',
    params: 'url, customAlias?, expiresAt?, password?, interstitialEnabled?, sponsorId?, tags?',
    response: '201 { link, sanitization }',
  },
  {
    method: 'POST',
    path: '/api/links/bulk',
    summary: 'Shorten up to 50 URLs in one request',
    params: 'urls[], expiresAt?, interstitialEnabled?, sponsorId?, tags?',
    response: '200 { total, succeeded, failed, results }',
  },
  {
    method: 'GET',
    path: '/api/links',
    summary: 'Search, filter, sort, and paginate links',
    params: 'search, status, tag, sortBy, sortDir, page, pageSize',
    response: '200 { items, total, page, totalPages }',
  },
  {
    method: 'GET',
    path: '/api/alias/check',
    summary: 'Validate & check custom alias availability',
    params: 'alias (query)',
    response: '200 { valid, available, reason? }',
  },
  {
    method: 'PATCH',
    path: '/api/links/:id',
    summary: 'Update expiration, status, tags, password, or sponsor interstitial',
    params: 'expiresAt?, isDisabled?, tags?, password?, interstitialEnabled?, sponsorId?',
    response: '200 { link }',
  },
  {
    method: 'DELETE',
    path: '/api/links/:id',
    summary: 'Delete a shortened link permanently',
    params: 'id (path)',
    response: '200 { ok: true }',
  },
  {
    method: 'GET',
    path: '/api/links/:id/analytics',
    summary: 'Detailed link telemetry (cached 60s)',
    params: 'range=24h|7d|30d|90d|all',
    response: '200 { timeSeries, countries, devices, referrers, heatmap }',
  },
  {
    method: 'GET',
    path: '/api/analytics/overview',
    summary: 'Workspace summary KPIs & 7-day trend',
    params: '—',
    response: '200 { totalLinks, totalClicks, mostPopularLink, dailyTrend }',
  },
  {
    method: 'GET',
    path: '/api/sponsors',
    summary: 'List active and paused sponsor/affiliate interstitial offers',
    params: '—',
    response: '200 { sponsors }',
  },
  {
    method: 'POST',
    path: '/api/sponsors',
    summary: 'Create a sponsor/affiliate interstitial offer',
    params: 'title, description?, ctaLabel, ctaUrl, badgeText?',
    response: '201 { sponsor }',
  },
  {
    method: 'GET',
    path: '/api/billing/status',
    summary: 'Get user plan, free quota usage, and Stripe config state',
    params: 'Bearer Firebase ID token (optional)',
    response: '200 { plan, activeLinksCount, maxFreeLinks, stripeConfigured }',
  },
  {
    method: 'POST',
    path: '/api/billing/create-checkout-session',
    summary: 'Create a Stripe Checkout session for Pro plan',
    params: 'Bearer Firebase ID token',
    response: '200 { url } | 503',
  },
  {
    method: 'POST',
    path: '/api/gate/:code/unlock',
    summary: 'Verify password for protected link (5 req/min/IP)',
    params: 'password',
    response: '200 { targetUrl } | 401 | 429',
  },
  {
    method: 'GET',
    path: '/:code',
    summary: 'Sub-10ms 302 redirect or sponsor/password/expired gate',
    params: 'code (path)',
    response: '302 Location | 200 Gate HTML',
  },
];

export function ApiDocsView() {
  const { showToast } = useToast();
  const [copiedCurl, setCopiedCurl] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const curlSnippet = `curl -X POST ${origin}/api/links \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: demo-client-key" \\
  -d '{"url":"https://example.com/docs?utm_source=api","customAlias":"api-demo","tags":["docs"]}'`;

  const handleCopyCurl = async () => {
    const ok = await copyToClipboard(curlSnippet);
    if (ok) {
      setCopiedCurl(true);
      showToast('Copied cURL example', 'success', 2000);
      window.setTimeout(() => setCopiedCurl(false), 2000);
    }
  };

  return (
    <section id="docs" aria-labelledby="docs-heading" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="docs-heading" className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            REST API &amp; OpenAPI 3.0 Reference
          </h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Rate-limited JSON endpoints with CSRF protection, scrypt password verification, and OpenAPI schema.
          </p>
        </div>
        <a
          href="/openapi.json"
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span>View openapi.json</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>

      {/* Quick cURL example */}
      <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 pb-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Quick Start Example</span>
          <button
            type="button"
            onClick={handleCopyCurl}
            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {copiedCurl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedCurl ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-slate-100">
          {curlSnippet}
        </pre>
      </div>

      {/* Endpoint Reference Table */}
      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <th className="py-3 pl-4 pr-3 font-semibold">Method</th>
                <th className="py-3 px-3 font-semibold">Endpoint</th>
                <th className="py-3 px-3 font-semibold">Description</th>
                <th className="py-3 px-3 font-semibold">Parameters</th>
                <th className="py-3 pl-3 pr-4 font-semibold">Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ENDPOINTS.map((ep) => (
                <tr key={`${ep.method}:${ep.path}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 pl-4 pr-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                    {ep.method}
                  </td>
                  <td className="py-3 px-3 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {ep.path}
                  </td>
                  <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{ep.summary}</td>
                  <td className="py-3 px-3 font-mono text-slate-500 dark:text-slate-400">{ep.params}</td>
                  <td className="py-3 pl-3 pr-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {ep.response}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
