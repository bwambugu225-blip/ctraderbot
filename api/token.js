// cTrader Open API token endpoint (Vercel serverless)
// Proxies OAuth token exchange/refresh to ctrader so the client secret
// never needs to be shipped to the browser.
//
// Prefer credentials from env vars (CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET).
// Falls back to legacy constants ONLY so existing deployments keep working.

const FALLBACK_CLIENT_ID = '30945_Xq33WNRLYcZlfuZ2edXYWf1i2WC7fbiAsIqj0SvfZpOf5pWSoW';
const FALLBACK_CLIENT_SECRET = 'Fg2dOfCVrJoNsLeCyl4PVTw8EMiHiJFJ9dEYIimm3hZG9REi6N';

function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body || {}).toString();
    const params = new URLSearchParams(body);

    // Allow per-request override, but env vars take precedence when present.
    const clientId = process.env.CTRADER_CLIENT_ID || params.get('client_id') || FALLBACK_CLIENT_ID;
    const clientSecret = process.env.CTRADER_CLIENT_SECRET || params.get('client_secret') || FALLBACK_CLIENT_SECRET;

    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);

    const response = await fetch('https://openapi.ctrader.com/apps/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return json(res, response.status, data);
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}
