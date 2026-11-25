import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLinkAnalytics, computeOverviewAnalytics } from './analyticsUtils';
import type { ClickEvent, ShortLink } from './types';

const nowMs = Date.UTC(2026, 10, 24, 15, 0, 0);

const sampleLink: ShortLink = {
  id: 'lnk_demo_1',
  code: 'launch',
  targetUrl: 'https://example.com/launch',
  isCustomAlias: true,
  tags: ['marketing'],
  createdAt: new Date(nowMs - 5 * 86400_000).toISOString(),
  expiresAt: null,
  isPasswordProtected: false,
  interstitialEnabled: false,
  isDisabled: false,
  status: 'active',
  clicks: 3,
  uniqueClicks: 2,
  lastClickedAt: new Date(nowMs - 3600_000).toISOString(),
};

const sampleClicks: ClickEvent[] = [
  {
    id: 'c1',
    linkId: 'lnk_demo_1',
    timestamp: new Date(nowMs - 2 * 3600_000).toISOString(),
    country: 'United States',
    city: 'San Francisco',
    deviceType: 'desktop',
    os: 'macOS',
    browser: 'Chrome',
    referrer: 'github.com',
    isUnique: true,
  },
  {
    id: 'c2',
    linkId: 'lnk_demo_1',
    timestamp: new Date(nowMs - 3600_000).toISOString(),
    country: 'United States',
    city: 'New York',
    deviceType: 'mobile',
    os: 'iOS',
    browser: 'Safari',
    referrer: 'github.com',
    isUnique: false,
  },
  {
    id: 'c3',
    linkId: 'lnk_demo_1',
    timestamp: new Date(nowMs - 10 * 86400_000).toISOString(),
    country: 'Germany',
    city: 'Berlin',
    deviceType: 'desktop',
    os: 'Linux',
    browser: 'Firefox',
    referrer: 'Direct',
    isUnique: true,
  },
];

test('computes filtered link analytics across 24h vs all time', () => {
  const last24h = computeLinkAnalytics(sampleLink, sampleClicks, '24h', nowMs);
  assert.equal(last24h.totalClicks, 2);
  assert.equal(last24h.uniqueClicks, 1);
  assert.equal(last24h.topCountry, 'United States');
  assert.equal(last24h.timeSeries.length, 24);
  assert.equal(last24h.heatmap.length, 7 * 24);
  assert.equal(last24h.referrers[0].referrer, 'github.com');

  const all = computeLinkAnalytics(sampleLink, sampleClicks, 'all', nowMs);
  assert.equal(all.totalClicks, 3);
  assert.equal(all.uniqueClicks, 2);
});

test('computes aggregate overview analytics correctly', () => {
  const overview = computeOverviewAnalytics([sampleLink], sampleClicks, nowMs);
  assert.equal(overview.totalLinks, 1);
  assert.equal(overview.activeLinks, 1);
  assert.equal(overview.recentClicks24h, 2);
  assert.equal(overview.mostPopularLink?.code, 'launch');
});
