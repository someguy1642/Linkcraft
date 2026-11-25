# Linkcraft — Full-Stack URL Shortening, Monetization & Analytics Service

Linkcraft is a full-stack URL shortening application featuring real-time URL validation and tracking-parameter sanitization, custom aliases, customizable QR code generation, password protection, link expiration, sponsor/affiliate redirect interstitials, Firebase Google Sign-In, Stripe SaaS billing, and click analytics.

## Features

- **URL Shortening Engine**:
  - Real-time URL validation (`URL` constructor + domain regex) with automatic `https://` prefixing.
  - Tracking-parameter sanitization (strips `utm_*`, `fbclid`, `gclid`, `mc_cid`, `mc_eid`, `igshid`), redundant slash normalization, and IDN punycode support.
  - **Bulk Shortening**: Paste up to 50 URLs (one per line) and shorten in one batch.
- **Custom Aliases**:
  - 3–30 alphanumeric/hyphen/underscore characters with reserved keyword protection and 300ms debounced availability checking.
- **QR Code Studio**:
  - Auto-generated scannable QR codes with customizable foreground/background colors, optional center logo overlay, `1024×1024` PNG export, and scalable SVG export.
- **Click Tracking & Analytics Dashboard**:
  - Cookie-free daily visitor hashing + UTC timestamps, device type, OS, browser, referrer host, and non-blocking geolocation.
  - Interactive Chart.js visualizations: time-series trends (`24h`, `7d`, `30d`, `90d`, `all`), top countries bar chart, device/OS/browser breakdowns, top referrers table, and 7×24 day-of-week × hour heatmap.
- **Monetization — Sponsor Interstitials & SaaS Billing**:
  - **Sponsor / Affiliate Interstitials**: Configurable 5-second wait screen displaying custom sponsor/affiliate cards with impression, click, and CTR tracking (`#monetize`).
  - **User Accounts & Stripe Billing**: Firebase Google Sign-In + Firestore sync (`users`, `sponsors`, `userLinks`), Free plan (up to 25 saved links) vs. Pro ($15/mo unlimited) via Stripe Checkout, Billing Portal, and signed Stripe Webhook verification.
- **Expiration & Password Protection**:
  - Presets (`1h`, `24h`, `7d`, `30d`) and custom date/time picker via `flatpickr`, plus friendly expired-link screen and post-creation extension.
  - Server-side `scrypt` password hashing with per-IP rate-limited unlock gate (`5 attempts/min`).

## Environment Variables (AI Studio Secrets)

- `STRIPE_SECRET_KEY` — Stripe secret API key (`sk_test_...` or `sk_live_...`)
- `STRIPE_PRICE_ID` — Recurring monthly Stripe Price ID (`price_...`)
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret (`whsec_...`) for `/api/billing/webhook`
- `VITE_PUBLIC_BASE_URL` — Optional custom domain prefix for displayed/copied short URLs

## Commands

```bash
npm install
npm test
npm run dev
npm run build
npm start
```
