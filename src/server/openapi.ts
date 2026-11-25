export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Linkcraft URL Shortener & Monetization API',
      version: '1.1.0',
      description:
        'RESTful API for creating, managing, protecting, expiring, monetizing, and analyzing shortened URLs.',
      contact: {
        name: 'Linkcraft Support',
        email: 'someking2026@outlook.com',
      },
    },
    servers: [{ url: baseUrl || '/' }],
    paths: {
      '/api/links': {
        get: {
          summary: 'List shortened links',
          parameters: [
            { name: 'search', in: 'query', schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['all', 'active', 'protected', 'sponsored', 'expired', 'disabled'],
              },
            },
            { name: 'tag', in: 'query', schema: { type: 'string' } },
            { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['createdAt', 'clicks', 'code'] } },
            { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 25 } },
          ],
          responses: {
            '200': { description: 'Paginated list of shortened links' },
          },
        },
        post: {
          summary: 'Create a shortened link (rate limit: 20/min per IP)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    customAlias: { type: 'string', minLength: 3, maxLength: 30 },
                    expiresAt: { type: 'string', format: 'date-time', nullable: true },
                    password: { type: 'string', minLength: 3 },
                    tags: { type: 'array', items: { type: 'string' } },
                    interstitialEnabled: { type: 'boolean' },
                    sponsorId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Shortened link created' },
            '400': { description: 'Invalid URL or alias' },
            '402': { description: 'Free plan link limit reached' },
            '409': { description: 'Custom alias already taken' },
            '429': { description: 'Rate limit exceeded' },
          },
        },
      },
      '/api/links/bulk': {
        post: {
          summary: 'Bulk shorten up to 50 URLs at once',
          responses: {
            '200': { description: 'Per-URL creation outcomes' },
          },
        },
      },
      '/api/links/{id}': {
        get: {
          summary: 'Get link details by public nanoid',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Link metadata' },
            '404': { description: 'Link not found' },
          },
        },
        patch: {
          summary: 'Update expiration, password, status, tags, or interstitial sponsor',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Updated link' } },
        },
        delete: {
          summary: 'Delete a shortened link',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted confirmation' } },
        },
      },
      '/api/alias/check': {
        get: {
          summary: 'Check custom alias validity and availability',
          parameters: [{ name: 'alias', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ available, valid, reason? }' } },
        },
      },
      '/api/links/{id}/analytics': {
        get: {
          summary: 'Get time-series, geo, device, referrer, and heatmap analytics (60s cached)',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'range', in: 'query', schema: { type: 'string', enum: ['24h', '7d', '30d', '90d', 'all'] } },
          ],
          responses: { '200': { description: 'Link analytics report' } },
        },
      },
      '/api/analytics/overview': {
        get: {
          summary: 'Get aggregate workspace analytics (60s cached)',
          responses: { '200': { description: 'Workspace analytics overview' } },
        },
      },
      '/api/sponsors': {
        get: {
          summary: 'List active and paused sponsor/affiliate interstitial campaigns',
          responses: { '200': { description: '{ sponsors }' } },
        },
        post: {
          summary: 'Create a sponsor/affiliate interstitial campaign',
          responses: { '201': { description: '{ sponsor }' } },
        },
      },
      '/api/sponsors/{id}': {
        patch: {
          summary: 'Update sponsor campaign copy, CTA URL, or active status',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ sponsor }' } },
        },
        delete: {
          summary: 'Delete sponsor campaign',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ ok: true }' } },
        },
      },
      '/api/sponsors/{id}/click': {
        post: {
          summary: 'Record sponsor CTA click and return validated destination URL',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ ok: true, ctaUrl }' } },
        },
      },
      '/api/billing/status': {
        get: {
          summary: 'Get current plan, usage quota, and Stripe configuration status',
          responses: { '200': { description: 'BillingStatusResponse' } },
        },
      },
      '/api/billing/create-checkout-session': {
        post: {
          summary: 'Create a Stripe Checkout subscription session (requires Firebase Bearer token)',
          responses: {
            '200': { description: '{ url }' },
            '503': { description: 'Stripe environment variables not configured' },
          },
        },
      },
      '/api/billing/verify-session': {
        post: {
          summary: 'Verify a completed Stripe Checkout session and activate Pro plan',
          responses: { '200': { description: 'Updated BillingStatusResponse' } },
        },
      },
      '/api/billing/portal': {
        post: {
          summary: 'Create a Stripe Billing Portal session for managing subscriptions',
          responses: { '200': { description: '{ url }' } },
        },
      },
      '/api/gate/{code}/continue': {
        post: {
          summary: 'Record visit and continue past sponsor interstitial screen',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: '{ targetUrl }' } },
        },
      },
      '/api/gate/{code}/unlock': {
        post: {
          summary: 'Verify password for a protected short link (5 attempts/min per IP)',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Password verified; returns destination targetUrl' },
            '401': { description: 'Incorrect password' },
            '429': { description: 'Too many failed attempts' },
          },
        },
      },
      '/{code}': {
        get: {
          summary: 'Resolve short link and redirect (302) or render sponsor/password/expired gate',
          parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '302': { description: 'Redirects to sanitized target URL' },
            '200': { description: 'Renders Sponsor Interstitial, Password Gate, or Expired Link screen' },
          },
        },
      },
    },
  };
}
