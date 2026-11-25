import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLinkStatus,
  formatTimeRemaining,
  normalizeTags,
  parseExpirationPreset,
  validateAlias,
  validateAndSanitizeUrl,
} from './urlUtils';

test('auto-prepends https:// when protocol is missing and normalizes host', () => {
  const res = validateAndSanitizeUrl('Example.COM/docs//getting-started');
  assert.equal(res.valid, true);
  assert.equal(res.autoPrependedProtocol, true);
  assert.equal(res.sanitizedUrl, 'https://example.com/docs/getting-started');
});

test('strips UTM, fbclid, and gclid tracking parameters while keeping functional query params', () => {
  const res = validateAndSanitizeUrl(
    'https://shop.example.com/item?id=42&utm_source=twitter&fbclid=abc123&gclid=xyz&color=navy',
  );
  assert.equal(res.valid, true);
  assert.equal(res.sanitizedUrl, 'https://shop.example.com/item?id=42&color=navy');
  assert.deepEqual(res.strippedTrackingParams, ['utm_source', 'fbclid', 'gclid']);
});

test('blocks dangerous schemes such as javascript:, data:, and file:', () => {
  for (const dangerous of [
    'javascript:alert(1)',
    'JAVASCRIPT:fetch("//evil.com")',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
  ]) {
    const res = validateAndSanitizeUrl(dangerous);
    assert.equal(res.valid, false, `Expected ${dangerous} to be rejected`);
  }
});

test('supports internationalized domain names (IDN) and rejects overly long URLs', () => {
  const idn = validateAndSanitizeUrl('https://münchen.de/rathaus');
  assert.equal(idn.valid, true);
  assert.equal(idn.sanitizedUrl, 'https://xn--mnchen-3ya.de/rathaus');

  const tooLong = `https://example.com/${'a'.repeat(2050)}`;
  assert.equal(validateAndSanitizeUrl(tooLong).valid, false);
});

test('validates custom aliases and blocks reserved system keywords', () => {
  assert.equal(validateAlias('my-brand_26').valid, true);
  assert.equal(validateAlias('ab').valid, false);
  assert.equal(validateAlias('a'.repeat(31)).valid, false);
  assert.equal(validateAlias('bad space').valid, false);
  assert.equal(validateAlias('admin').valid, false);
  assert.equal(validateAlias('API').valid, false);
  assert.equal(validateAlias('static').valid, false);
});

test('normalizes tags safely without HTML characters', () => {
  const tags = normalizeTags(['  Marketing ', '<script>q4', 'Social Media', 'marketing']);
  assert.deepEqual(tags, ['marketing', 'scriptq4', 'social-media']);
});

test('computes expiration presets, status, and remaining time', () => {
  const base = Date.UTC(2026, 10, 24, 12, 0, 0);
  const inOneHour = parseExpirationPreset('1h', null, base);
  assert.equal(inOneHour, new Date(base + 3600_000).toISOString());
  assert.equal(computeLinkStatus(false, inOneHour, base), 'active');
  assert.equal(formatTimeRemaining(inOneHour, base), 'Expires in 1h');
  assert.equal(computeLinkStatus(false, inOneHour, base + 3600_001), 'expired');
  assert.equal(computeLinkStatus(true, inOneHour, base), 'disabled');
});
