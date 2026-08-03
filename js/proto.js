// ============================================================
// cTrader Open API v2 — protocol constants & helpers
// ============================================================
window.PAYLOAD = {
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106,
  CANCEL_ORDER_REQ: 2108,
  AMEND_ORDER_REQ: 2109,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  CLOSE_POSITION_RES: 2112,
  GET_SYMBOLS_REQ: 2114,
  GET_SYMBOLS_RES: 2115,
  GET_SYMBOL_REQ: 2116,
  GET_SYMBOL_RES: 2117,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  TRADER_UPDATE_EVENT: 2123,
  EXECUTION_EVENT: 2126,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  SPOT_EVENT: 2131,
  GET_TRENDBARS_REQ: 2132,
  GET_TRENDBARS_RES: 2133,
  ORDER_ERROR_EVENT: 2135,
  MARGIN_CHANGED_EVENT: 2141,
  ERROR_RES: 2142,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  GET_TICK_DATA_REQ: 2574,
  GET_TICK_DATA_RES: 2575,
};

// ProtoOAPeriod enum
window.TF_PERIOD = { M1: 1, M2: 2, M3: 3, M4: 4, M5: 5, M10: 6, M15: 7, M30: 8, H1: 9, H4: 10, D1: 11, W1: 12, MN1: 13 };
window.TF_SECONDS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };
window.TFS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

window.EXEC_TYPE = { 1: 'ACCEPTED', 2: 'FILLED', 3: 'REJECTED', 4: 'CANCELLED', 5: 'MODIFIED', 6: 'PARTIALLY_FILLED' };

// ---- Symbol categorisation ---------------------------------
const CRYPTO_RE = /(BTC|ETH|LTC|XRP|SOL|DOGE|ADA|TRX|DOT|BCH|LINK|UNI|AVAX|MATIC|SHIB|XLM|ETC|NEAR|ATOM|ALGO|FTM|MKR|TON|XMR|EOS|ZEC|DASH|BNB|AXS|GMT|GALA|SAND|MANA|APE|LDO|ARB|OP|SUI|SEI|PEPE|WLD|RUNE|TIA|INJ|JUP|ORDI|BONK|WIF|AAVE|CRV|FIL|LUNC|DYDX|ENJ|KSM|XTZ|ICP|EGLD|HBAR|VET|THETA|CHZ|BAT|ZIL|IOTA|QTUM|NEO|OKB|CRO|KAVA|ROSE|MINA|FLOW|IMX|ENS|BLUR|PYTH|JTO|CYBER|SSV|LQTY|FXS|COMP|SNX|MASK|GTC|LOOM|GODS|APE|GNS|RDNT|JOE|KP3R|CVC|GNO|LRC|REN|RSR|SUSHI|TWT|1INCH|YFI|ZRX)(USD|USDC|EUR|USDT|JPY|ETH|LTC|BNB|TRY|BRL|AUD|GBP|CHF)\b/i;

window.categorizeSymbol = function (name, base, quote, extra) {
  name = String(name || '').toUpperCase();
  base = String(base || '').toUpperCase();
  quote = String(quote || '').toUpperCase();
  const n = (name + ' ' + (extra || '')).toUpperCase();

  if (CRYPTO_RE.test(name)) return 'Crypto';
  if (quote === 'USDT' || quote === 'USDC' || quote === 'DAI' || quote === 'USDE' || quote === 'TUSD' || quote === 'FDUSD') return 'Crypto';
  if (['BTC', 'ETH', 'XRP', 'SOL', 'LTC', 'DOGE', 'ADA', 'DOT', 'BCH', 'LINK', 'TRX', 'AVAX', 'MATIC', 'SHIB', 'XLM', 'UNI', 'ETC', 'NEAR', 'ATOM', 'FIL', 'SUI', 'ARB', 'OP', 'TIA', 'INJ', 'PEPE', 'WIF', 'BONK'].includes(base)) return 'Crypto';

  if (/XAU|XAG|XPT|XPD|GOLD|SILVER|PALLADIUM|PLATINUM/i.test(n)) return 'Metals';
  if (/\b(US30|NAS100|NASDX|SPX500|SP500|GER30|DAX40|CAC40|UK100|FTSE|JP225|NIKKEI|HKG50|HSCI|AUS200|EU50|ESP35|ITA40|SWI20|ZAR40|USDX|DXY|VIX|OIL|WTI|BRENT|NGAS|NATGAS|GAS|COPPER|NICKEL|PLAT|PALL|SUGAR|COFFEE|COCOA|CORN|WHEAT|SOYBEAN|A50|CH50|SGX)\d*$/i.test(n)) return 'Indices';
  if (/(\bEUR\b.*\bUSD\b)|(\bUSD\b.*\bJPY\b)|(\bGBP\b.*\bUSD\b)|(\bUSD\b.*\bCHF\b)|(\bAUD\b.*\bUSD\b)|(\bUSD\b.*\bCAD\b)|(\bNZD\b.*\bUSD\b)/i.test(name) && !CRYPTO_RE.test(name)) return 'Forex';
  if (/^[A-Z]{6}$/.test(name) && /(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|TRY|ZAR|MXN|PLN|HUF|NOK|SEK|DKK|CZK|RON|SGD|HKD|BRL|TWD|KRW|CNH|THB|INR|IDR|MYR|PHP)$/.test(quote)) return 'Forex';

  if (/\b(BTC|ETH|XRP|SOL|LTC|DOGE|ADA|DOT|BCH|LINK|TRX|AVAX|MATIC|SHIB|XLM|UNI|ETC|NEAR|ATOM|FIL|SUI|ARB|OP)\b/i.test(n)) return 'Crypto';
  return 'Stocks';
};

window.pipFromSym = function (sym) {
  const p = sym && sym.pipPosition != null ? sym.pipPosition : (sym && sym.digits != null ? Math.max(sym.digits - 1, 0) : 2);
  return Math.pow(10, -p);
};
window.pointFromSym = function (sym) {
  const d = sym && sym.digits != null ? sym.digits : 5;
  return Math.pow(10, -d);
};
// Convert "lots" to integer base units, respecting the symbol's min/max/step
window.volumeUnits = function (lots, sym) {
  const lotSize = (sym && sym.lotSize) || 100000;
  const minVol = (sym && sym.minVolume) || 1;
  const maxVol = (sym && sym.maxVolume) || 0;
  let step;
  if (sym && sym.volumeStep != null && sym.volumeStep > 0) step = sym.volumeStep;
  else step = lotSize >= 1000 ? lotSize / 10 : (minVol || 1);
  let v = Math.round((lots * lotSize) / step) * step;
  if (!isFinite(v) || v < 1) v = minVol || step;
  if (minVol && v < minVol) v = minVol;
  if (maxVol && v > maxVol) v = maxVol;
  return Math.round(v);
};
window.lotsFromVolume = function (vol, sym) {
  const lotSize = (sym && sym.lotSize) || 100000;
  return vol / lotSize;
};
// Number of pips between two prices
window.pipsBetween = function (p1, p2, sym) {
  return Math.abs(p1 - p2) / window.pipFromSym(sym);
};
