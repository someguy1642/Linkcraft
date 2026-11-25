import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReferrerHost, parseUserAgent } from './uaParser';

test('parses desktop Chrome on macOS', () => {
  const res = parseUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  );
  assert.deepEqual(res, { deviceType: 'desktop', os: 'macOS', browser: 'Chrome' });
});

test('parses mobile Safari on iOS', () => {
  const res = parseUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  );
  assert.deepEqual(res, { deviceType: 'mobile', os: 'iOS', browser: 'Safari' });
});

test('parses Edge on Windows and Android Tablet', () => {
  const edge = parseUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  );
  assert.deepEqual(edge, { deviceType: 'desktop', os: 'Windows', browser: 'Edge' });

  const tablet = parseUserAgent(
    'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  );
  assert.deepEqual(tablet, { deviceType: 'tablet', os: 'Android', browser: 'Chrome' });
});

test('extracts clean referrer host or Direct', () => {
  assert.equal(parseReferrerHost('https://www.linkedin.com/feed/'), 'linkedin.com');
  assert.equal(parseReferrerHost('https://localhost:3000/links', 'localhost:3000'), 'Direct');
  assert.equal(parseReferrerHost(undefined), 'Direct');
});
