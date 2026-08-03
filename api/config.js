// cTrader app credentials for the browser (public config endpoint).
// Reads from env vars so you never commit secrets to the repo.
// Falls back to legacy constants for existing deployments.
// The secret is technically visible to the client at runtime (browser WebSocket
// handshake requires it). To keep it private, deploy this with your own
// CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET env vars set in Vercel.

const FALLBACK_CLIENT_ID = '30945_Xq33WNRLYcZlfuZ2edXYWf1i2WC7fbiAsIqj0SvfZpOf5pWSoW';
const FALLBACK_CLIENT_SECRET = 'Fg2dOfCVrJoNsLeCyl4PVTw8EMiHiJFJ9dEYIimm3hZG9REi6N';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    clientId: process.env.CTRADER_CLIENT_ID || FALLBACK_CLIENT_ID,
    clientSecret: process.env.CTRADER_CLIENT_SECRET || FALLBACK_CLIENT_SECRET,
  });
}
