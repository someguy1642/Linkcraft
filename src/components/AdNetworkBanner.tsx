import React from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import type { AdNetworkConfig } from '../shared/types';
import { validateAndSanitizeUrl } from '../shared/urlUtils';

interface AdNetworkBannerProps {
  config?: AdNetworkConfig | null;
  placement: 'interstitial' | 'homepage';
  className?: string;
}

export function AdNetworkBanner({ config, placement, className = '' }: AdNetworkBannerProps) {
  if (!config || !config.enabled) return null;

  if (placement === 'interstitial' && !config.showOnInterstitial) return null;
  if (placement === 'homepage' && !config.showOnHomepage) return null;

  // 1. HTML / Script / Iframe Ad Mode
  if (config.networkType === 'banner_html') {
    if (!config.bannerHtml || !config.bannerHtml.trim()) return null;

    // Securely embed HTML/JS snippet in an isolated iframe with a base target
    const sandboxedHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
  </style>
</head>
<body>
  ${config.bannerHtml}
</body>
</html>`;

    return (
      <div
        className={`overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900 ${className}`}
      >
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <span>Advertisement</span>
          <span>{config.networkName || 'Sponsored Network'}</span>
        </div>
        <div className="flex w-full min-h-[100px] items-center justify-center overflow-hidden">
          <iframe
            title="Advertisement"
            srcDoc={sandboxedHtml}
            className="w-full border-0 min-h-[100px] h-[120px]"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-same-origin"
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  // 2. Image Banner + Click Target Mode
  if (config.networkType === 'image_banner') {
    if (!config.bannerImageUrl) return null;
    const sanitizedTarget = config.bannerTargetUrl
      ? validateAndSanitizeUrl(config.bannerTargetUrl).sanitizedUrl
      : undefined;

    return (
      <div
        className={`overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xs dark:border-slate-800 dark:bg-slate-900 ${className}`}
      >
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <span>Advertisement</span>
          <span>Sponsored Banner</span>
        </div>
        {sanitizedTarget ? (
          <a
            href={sanitizedTarget}
            target="_blank"
            rel="noopener noreferrer"
            className="group block overflow-hidden rounded-lg transition-opacity hover:opacity-95"
          >
            <img
              src={config.bannerImageUrl}
              alt="Sponsored Banner"
              className="mx-auto max-h-[140px] w-full object-contain transition-transform group-hover:scale-[1.01]"
            />
          </a>
        ) : (
          <div className="overflow-hidden rounded-lg">
            <img
              src={config.bannerImageUrl}
              alt="Sponsored Banner"
              className="mx-auto max-h-[140px] w-full object-contain"
            />
          </div>
        )}
      </div>
    );
  }

  // 3. Direct Link / Smartlink Mode
  if (config.networkType === 'direct_link') {
    if (!config.directAdUrl) return null;
    const sanitizedDirect = validateAndSanitizeUrl(config.directAdUrl).sanitizedUrl;
    if (!sanitizedDirect) return null;

    return (
      <div
        className={`rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/40 ${className}`}
      >
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            <span>Special Partner Promotion</span>
          </span>
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
            Ad
          </span>
        </div>
        <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300">
          Explore curated deals, free services, and tools from our network partners.
        </p>
        <div className="mt-3">
          <a
            href={sanitizedDirect}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            <span>Visit Partner Offer</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return null;
}
