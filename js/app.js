// ============================================================
// cTrader Bot Studio Pro — Main Application Engine
// ============================================================
(function () {
  'use strict';

  const P = window.PAYLOAD;
  const $ = (id) => document.getElementById(id);

  // ---------------- application unified state ----------------
  const S = {
    clientId: localStorage.getItem('ctrader_client_id') || '',
    clientSecret: localStorage.getItem('ctrader_client_secret') || '',
    env: localStorage.getItem('ctrader_env') || 'demo',
    accountId: localStorage.getItem('ctrader_account') || '',
    redirectUri: localStorage.getItem('ctrader_redirect') || 'https://ctraderbot.vercel.app',
    accessToken: localStorage.getItem('ctrader_access') || '',
    refreshToken: localStorage.getItem('ctrader_refresh') || '',

    connected: false,
    currentTF: localStorage.getItem('ctrader_tf') || 'M15',

    symbols: new Map(),       // symbolId -> details
    byName: new Map(),        // symbolName -> details
    byCat: { Crypto: [], Forex: [], Metals: [], Indices: [], Stocks: [] },
    catOrder: ['Crypto', 'Forex', 'Metals', 'Indices', 'Stocks'],
    spots: new Map(),         // symbolName -> {bid, ask, open, ts}
    subscribed: [],

    currentSymbol: null,
    ohlc: {},                 // "SYM_TF" -> bars[]
    liveBar: null,

    trader: { balance: 0, equity: 0, margin: 0, marginLevel: 0, currency: 'USD', moneyDigits: 2 },
    positions: [],            // {id, symbol, side, volume, units, entry, sl, tp, profit, swap, currency}
    pending: [],
    history: [],

    activeCat: 'All',
    search: '',

    botRunning: false,
    ea: loadEA(),

    chart: null, cs: null, bs: null, ls: null,
    ema9: null, ema21: null, sma50: null, bbU: null, bbL: null, bbB: null,
    rsiChart: null, rsiS: null,
    ind: { ema9: true, ema21: true, sma50: false, bb: true, rsi: true },
    grid: true,
    chartType: 'candles',
    _indThrottle: 0,
    _slState: {},             // positionId -> {sl, lastAmend}
  };

  function loadEA() {
    try {
      const d = JSON.parse(localStorage.getItem('ctrader_ea') || 'null');
      if (d) return Object.assign(defaultsEA(), d);
    } catch (e) { /* ignore */ }
    return defaultsEA();
  }

  function defaultsEA() {
    return {
      mode: 'risk', riskPct: 1.0, fixedLot: 0.10,
      maxPos: 3, maxSpread: 5, atrMult: 2.5, rr: 3.0,
      trail: true, trailTrigger: 40, trailDist: 20,
      be: true, beTrigger: 30, beLock: 2,
      maxDailyLoss: 0, minCooldown: 60, onlyCurrent: true,
    };
  }

  // ---------------- UI notification & logs ----------------
  function log(msg, cls) {
    cls = cls || '';
    console.log('[System]', cls, msg);
    const box = $('logJournal');
    if (!box) return;
    const t = new Date().toTimeString().slice(0, 8);
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = '<span class="t">[' + t + ']</span><span class="m ' + cls + '">' + escapeHtml(msg) + '</span>';
    box.appendChild(div);
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function elog(msg, cls) {
    cls = cls || '';
    console.log('[Bot]', cls, msg);
    const box = $('logEA');
    if (!box) return;
    const t = new Date().toTimeString().slice(0, 8);
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = '<span class="t">[' + t + ']</span><span class="m ' + (cls || '') + '">' + escapeHtml(msg) + '</span>';
    box.appendChild(div);
    while (box.childNodes.length > 300) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function toast(msg, cls) {
    const box = $('toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + (cls || '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => {
      d.style.opacity = '0';
      d.style.transition = 'opacity 0.4s';
      setTimeout(() => d.remove(), 400);
    }, 3000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmt(n, d) {
    return (n == null || !isFinite(n)) ? '—' : Number(n).toFixed(d == null ? 2 : d);
  }

  // ============================================================
  // CONNECTION INTERFACES
  // ============================================================
  function statusPill(text, cls) {
    const pill = $('connPill');
    if (!pill) return;
    pill.className = 'status-pill ' + cls;
    const lbl = pill.querySelector('.status-lbl') || pill.querySelector('.lbl');
    if (lbl) lbl.textContent = text;

    // Also sync the modal banner state
    const banner = $('connBanner');
    if (banner) {
      banner.className = 'connection-state-banner ' + cls;
      banner.textContent = text;
    }
  }

  Conn.init({
    getCredentials: () => {
      const cid = $('clientIdInput') ? $('clientIdInput').value.trim() : '';
      const csec = $('clientSecretInput') ? $('clientSecretInput').value.trim() : '';
      return {
        env: S.env,
        clientId: cid || S.clientId,
        clientSecret: csec || S.clientSecret,
        accessToken: $('tokInput') ? $('tokInput').value.trim() || S.accessToken : S.accessToken,
        accountId: S.accountId,
      };
    },
    onStatus: (text, cls) => statusPill(text, cls),
    onLog: log,
    onConnected: () => {
      S.connected = true;
      const tok = $('tokInput');
      if (tok) tok.value = Conn.creds.accessToken;
      statusPill('Connected', 'connected');
      updateHeader();
      getSymbols();
      getTrader();
      getOrders();
      if (S.currentSymbol) loadHistory(S.currentSymbol, S.currentTF);
      log('Socket session authenticated successfully.', 'ok');
    },
    onDisconnected: (reason) => {
      S.connected = false;
      updateHeader();
      if (reason === 'manual') {
        renderWatchlist();
      }
    },
    onAccounts: (accounts) => {
      window._accounts = accounts;
      const sel = $('accSelect');
      if (!accounts.length) {
        if (sel) sel.innerHTML = '<option value="">No accounts available</option>';
        log('Access token has no linked trading scopes.', 'err');
        toast('No accounts linked', 'err');
        Conn.disconnect();
        return;
      }
      if (sel) {
        sel.innerHTML = '';
        accounts.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.ctidTraderAccountId;
          opt.textContent = '#' + a.ctidTraderAccountId + ' — ' + (a.accountType || 'Trading');
          sel.appendChild(opt);
        });
        const pick = accounts.find((a) => String(a.ctidTraderAccountId) === String(S.accountId)) || accounts[0];
        if (pick) {
          sel.value = pick.ctidTraderAccountId;
          S.accountId = String(pick.ctidTraderAccountId);
          S.env = pick.isLive ? 'live' : 'demo';
          savePrefs();
        }
      } else {
        const pick = accounts.find((a) => String(a.ctidTraderAccountId) === String(S.accountId)) || accounts[0];
        if (pick) {
          S.accountId = String(pick.ctidTraderAccountId);
          S.env = pick.isLive ? 'live' : 'demo';
          savePrefs();
        }
      }
      if (!Conn.connected && (Conn.phase === 'app_authed' || Conn.phase === 'accounts_loaded')) {
        Conn.accountAuth(S.accountId, Conn.creds.accessToken);
      }
    },
    onTokenError: () => {
      log('OAuth token expired — attempting auto-refresh…', 'warn');
      refreshAccessToken().then(() => {
        Conn.reconnectNow();
      }).catch((e) => {
        log('Token refresh failed: ' + e.message, 'err');
        toast('OAuth authorization expired', 'err');
      });
    },
    onMessage: (type, payload, raw) => handleMessage(type, payload, raw),
  });

  // ============================================================
  // PROTOCOL MESSAGE HANDLERS
  // ============================================================
  function handleMessage(type, payload, raw) {
    switch (type) {
      case P.GET_SYMBOLS_RES: handleSymbols(payload); break;
      case P.SPOT_EVENT: handleSpot(payload); break;
      case P.TRADER_RES: handleTrader(payload); break;
      case P.TRADER_UPDATE_EVENT: handleTrader(payload); break;
      case P.MARGIN_CHANGED_EVENT: handleMargin(payload); break;
      case P.ORDER_LIST_RES: handleOrders(payload); break;
      case P.RECONCILE_RES: handleReconcile(payload); break;
      case P.SYMBOL_BY_ID_RES: handleSymbolById(payload); break;
      case P.GET_SYMBOL_RES: handleSymbolById(payload); break;
      case P.EXECUTION_EVENT: handleExecution(payload); break;
      case P.GET_TRENDBARS_RES: handleTrendbars(payload); break;
      case P.SUBSCRIBE_SPOTS_RES: break;
      default: break;
    }
  }

  function handleSymbols(payload) {
    const list = payload.symbol || [];
    if (!list.length) { log('No markets returned from broker.', 'warn'); return; }
    S.symbols.clear();
    S.byName.clear();
    Object.keys(S.byCat).forEach((k) => (S.byCat[k] = []));
    list.forEach(normalizeSymbol);
    log('Successfully discovered ' + list.length + ' markets.', 'ok');
    populateSymbolSelects();
    const wl = buildWatchList();
    requestFullSymbols(wl);
    subscribeSpots(wl);
    renderWatchlist();
    if (!S.currentSymbol) {
      const first = S.byCat.Crypto[0] || S.byCat.Forex[0] || S.byCat.Metals[0] || S.byCat.Indices[0] || S.byCat.Stocks[0];
      if (first) selectSymbol(first.symbolName);
    }
  }

  function normalizeSymbol(s) {
    const id = s.symbolId;
    const name = s.symbolName || s.name || String(id);
    const det = {
      symbolId: id,
      symbolName: name,
      digits: s.digits != null ? s.digits : 5,
      pipPosition: s.pipPosition != null ? s.pipPosition : 2,
      lotSize: s.lotSize || 100000,
      minVolume: s.minVolume || 1,
      maxVolume: s.maxVolume || 0,
      volumeStep: s.volumeStep || 0,
      baseAsset: s.baseAsset || '',
      quoteAsset: s.quoteAsset || '',
      description: s.description || '',
      category: window.categorizeSymbol(name, s.baseAsset, s.quoteAsset, s.description),
      isFull: false
    };
    S.symbols.set(id, det);
    S.byName.set(name, det);
    S.byCat[det.category].push(det);
  }

  function requestFullSymbols(ids) {
    if (!ids.length || !Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    Conn.send({
      clientMsgId: Conn.nextId(),
      payloadType: P.SYMBOL_BY_ID_REQ,
      payload: { ctidTraderAccountId: acc, symbolId: ids }
    });
  }

  function handleSymbolById(payload) {
    const list = payload.symbol || [];
    list.forEach((s) => {
      const id = s.symbolId;
      const existing = S.symbols.get(id);
      if (existing) {
        existing.digits = s.digits != null ? s.digits : existing.digits;
        existing.pipPosition = s.pipPosition != null ? s.pipPosition : existing.pipPosition;
        existing.lotSize = s.lotSize != null ? s.lotSize : existing.lotSize;
        existing.minVolume = s.minVolume != null ? s.minVolume : existing.minVolume;
        existing.maxVolume = s.maxVolume != null ? s.maxVolume : existing.maxVolume;
        existing.volumeStep = s.stepVolume != null ? s.stepVolume : (s.volumeStep != null ? s.volumeStep : existing.volumeStep);
        existing.isFull = true;
      }
    });
    log('Updated full specifications for ' + list.length + ' symbols.', 'ok');
    populateSymbolSelects();
    renderWatchlist();
    if (S.currentSymbol) {
      const curDet = S.byName.get(S.currentSymbol);
      if (curDet) {
        renderChartHeader(curDet, S.spots.get(S.currentSymbol)?.bid, S.spots.get(S.currentSymbol)?.ask);
      }
    }
  }

  function buildWatchList() {
    const list = [];
    const seen = new Set();
    const prefer = ['Crypto', 'Forex', 'Metals', 'Indices', 'Stocks'];
    prefer.forEach((cat) => {
      S.byCat[cat].slice(0, 40).forEach((d) => {
        if (!seen.has(d.symbolId)) {
          seen.add(d.symbolId);
          list.push(d.symbolId);
        }
      });
    });
    if (S.currentSymbol && S.byName.has(S.currentSymbol) && !seen.has(S.byName.get(S.currentSymbol).symbolId)) {
      list.push(S.byName.get(S.currentSymbol).symbolId);
    }
    return list.slice(0, 160);
  }

  function subscribeSpots(ids) {
    if (!ids.length || !Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    Conn.send({
      clientMsgId: Conn.nextId(),
      payloadType: P.SUBSCRIBE_SPOTS_REQ,
      payload: { ctidTraderAccountId: acc, symbolId: ids }
    });
    S.subscribed = ids;
    log('Subscribed to real-time streams (' + ids.length + ' symbols).', 'info');
  }

  function handleSpot(payload) {
    const det = S.symbols.get(payload.symbolId);
    if (!det) return;
    const div = Math.pow(10, det.digits);
    const bid = payload.bid != null ? payload.bid / div : null;
    const ask = payload.ask != null ? payload.ask / div : null;
    const prev = S.spots.get(det.symbolName) || {};
    const spot = {
      bid, ask,
      open: prev.open != null ? prev.open : (bid || ask),
      ts: Date.now(),
    };
    S.spots.set(det.symbolName, spot);

    renderWatchlistRow(det.symbolName);

    if (det.symbolName === S.currentSymbol) {
      renderChartHeader(det, bid, ask);
      renderChartSpot(bid);
      if (S.botRunning) evaluateSignals(det.symbolName, bid);
    }
    if (S.ea.trail || S.ea.be) managePositions(det.symbolName, bid);
    if (S.positions.some((p) => p.symbol === det.symbolName)) {
      throttled(() => renderPositions(), 400);
    }
  }

  function handleTrader(payload) {
    const t = payload.trader;
    if (!t) return;
    const md = t.moneyDigits != null ? t.moneyDigits : 2;
    const d = Math.pow(10, md);
    S.trader = {
      balance: numMoney(t.balance) / d,
      equity: numMoney(t.equity) / d,
      margin: numMoney(t.margin) / d,
      marginLevel: t.marginLevel != null ? t.marginLevel : 0,
      currency: t.currency || 'USD',
      moneyDigits: md,
    };
    updateHeader();
    renderStats();
  }

  function numMoney(v) {
    return (v && typeof v === 'object' && 'amount' in v) ? v.amount : (Number(v) || 0);
  }

  function handleMargin(payload) {
    if (payload.usedMargin != null) {
      const d = Math.pow(10, payload.moneyDigits != null ? payload.moneyDigits : 2);
      S.trader.margin = payload.usedMargin / d;
      S.trader.marginLevel = S.trader.equity > 0 ? (S.trader.equity / S.trader.margin) * 100 : 0;
      renderStats();
    }
  }

  function handleOrders(payload) {
    // Replaced by handleReconcile but keeping as fallback safety
  }

  function handleReconcile(payload) {
    const ps = payload.position || [];
    const os = payload.order || [];
    S.positions = [];
    S.pending = [];

    ps.forEach((p) => {
      const det = S.symbols.get(p.tradeData.symbolId);
      const name = det ? det.symbolName : ('#' + p.tradeData.symbolId);
      const md = p.moneyDigits != null ? p.moneyDigits : (S.trader.moneyDigits || 2);
      const d = Math.pow(10, md);
      const side = (p.tradeData.tradeSide === 'BUY' || p.tradeData.tradeSide === 1) ? 'buy' : 'sell';
      const vol = p.tradeData.volume / (det ? det.lotSize : 100000);

      const pos = {
        id: p.positionId,
        symbol: name,
        side,
        volume: vol,
        units: p.tradeData.volume,
        entry: p.price || 0,
        sl: p.stopLoss || null,
        tp: p.takeProfit || null,
        profit: p.grossUnrealizedPnL != null ? p.grossUnrealizedPnL / d : (p.netUnrealizedPnL != null ? p.netUnrealizedPnL / d : 0),
        swap: p.swap != null ? p.swap / d : 0,
        commission: p.commission != null ? p.commission / d : 0,
        currency: S.trader.currency,
      };
      S.positions.push(pos);
    });

    os.forEach((o) => {
      const det = S.symbols.get(o.tradeData.symbolId);
      const name = det ? det.symbolName : ('#' + o.tradeData.symbolId);
      const side = (o.tradeData.tradeSide === 'BUY' || o.tradeData.tradeSide === 1) ? 'buy' : 'sell';

      S.pending.push({
        id: o.orderId,
        symbol: name,
        type: o.orderType,
        side,
        volume: (o.tradeData.volume || 0) / (det ? det.lotSize : 100000),
        price: o.stopPrice != null ? o.stopPrice : (o.limitPrice != null ? o.limitPrice : 0),
        sl: o.stopLoss || null,
        tp: o.takeProfit || null,
      });
    });

    renderPositions();
    renderPending();
  }

  function handleExecution(payload) {
    const et = window.EXEC_TYPE[payload.executionType] || ('TYPE_' + payload.executionType);
    const id = payload.orderId || payload.positionId || payload.dealId || '?';
    log('Execution Event [' + et + '] — ' + id, 'info');
    if (et === 'FILLED' || et === 'REJECTED' || et === 'CANCELLED') {
      setTimeout(getOrders, 400);
    }
  }

  function handleTrendbars(payload) {
    const bars = payload.trendbar || payload.bars || [];
    const name = S.currentSymbol, key = name + '_' + S.currentTF;
    if (!bars.length) {
      log('No historical trendbars found. Connecting Binance...', 'warn');
      seedExternalHistory(name, S.currentTF);
      return;
    }
    const det = S.byName.get(name);
    const div = Math.pow(10, det ? det.digits : 5);
    const arr = bars.map((b) => {
      const mins = b.utcTimestampInMinutes != null ? b.utcTimestampInMinutes : (b.utcTimestamp || 0);
      const t = (mins > 1e11 ? Math.floor(mins / 60) : mins) * 60;
      return {
        time: t,
        open: +(b.open || 0) / div,
        high: +(b.high || 0) / div,
        low: +(b.low || 0) / div,
        close: +(b.close || 0) / div,
      };
    }).filter((b) => b.close > 0).sort((a, b) => a.time - b.time);
    if (arr.length) {
      S.ohlc[key] = cleanBars(arr);
      S.liveBar = null;
      log('Rendered ' + arr.length + ' trendbars for ' + name + '.', 'ok');
      updateChartData();
    }
  }

  // ============================================================
  // RISK & TRADING MATH
  // ============================================================
  function buildOrderPayload(symName, side, orderType, lots, slPips, tpPips, price) {
    const det = S.byName.get(symName);
    if (!det) { toast('Instrument not found', 'err'); return null; }
    const volume = window.volumeUnits(lots, det);
    if (!volume || volume <= 0) { toast('Invalid position volume', 'err'); return null; }
    const pip = window.pipFromSym(det);
    let slPrice = null, tpPrice = null;
    const ref = price || (side === 'buy' ? (S.spots.get(symName) && S.spots.get(symName).ask) : (S.spots.get(symName) && S.spots.get(symName).bid)) || 0;
    if (slPips > 0) slPrice = ref - (side === 'buy' ? slPips * pip : -slPips * pip);
    if (tpPips > 0) tpPrice = ref + (side === 'buy' ? tpPips * pip : -tpPips * pip);
    const o = {
      ctidTraderAccountId: parseInt(S.accountId, 10) || 0,
      symbolId: det.symbolId,
      orderType,
      tradeSide: side === 'buy' ? 'BUY' : 'SELL',
      volume,
      accessToken: Conn.creds.accessToken,
      label: 'cTraderBot',
      comment: 'cTrader Studio',
    };
    if (orderType !== 'MARKET' && price) o.price = Math.round(price / window.pointFromSym(det)) * window.pointFromSym(det);
    if (slPrice) o.stopLoss = { price: Math.round(slPrice / window.pointFromSym(det)) * window.pointFromSym(det) };
    if (tpPrice) o.takeProfit = { price: Math.round(tpPrice / window.pointFromSym(det)) * window.pointFromSym(det) };
    return o;
  }

  function sendOrder(o) {
    if (!Conn.connected) { toast('Please connect socket first', 'err'); return false; }
    if (!o) return false;
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.NEW_ORDER_REQ, payload: o });
    log('Placed manual ticket: ' + o.tradeSide + ' ' + o.orderType + ' volume=' + o.volume, 'info');
    return true;
  }

  function placeTicketOrder(side) {
    const sym = $('ticketSymbol').value;
    const type = $('ticketType').value;
    const lots = parseFloat($('ticketVol').value) || 0.01;
    const sl = parseFloat($('ticketSL').value) || 0;
    const tp = parseFloat($('ticketTP').value) || 0;
    let price = null;
    if (type === 'LIMIT' || type === 'STOP') price = parseFloat($('ticketPrice').value);
    if ((type === 'LIMIT' || type === 'STOP') && !price) { toast('Price parameter required', 'err'); return; }
    const o = buildOrderPayload(sym, side, type, lots, sl, tp, price);
    if (sendOrder(o)) toast('Ticket order dispatched successfully', 'ok');
  }

  function placeQuick(side) {
    const sym = S.currentSymbol;
    if (!sym) { toast('Select a market first', 'err'); return; }
    const lots = parseFloat($('quickVol').value) || 0.10;
    const o = buildOrderPayload(sym, side, 'MARKET', lots, 0, 0, null);
    if (sendOrder(o)) toast('Dispatched ' + side.toUpperCase() + ' ' + sym + ' @ ' + lots + ' lots', 'ok');
  }

  function closePosition(id, units) {
    if (!Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    const p = { ctidTraderAccountId: acc, positionId: id, accessToken: Conn.creds.accessToken };
    if (units) p.volume = units;
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.CLOSE_POSITION_REQ, payload: p });
    log('Dispatching closure for Position #' + id, 'info');
    toast('Closing selected position…', 'warn');
  }

  function closeAll() {
    S.positions.forEach((p) => closePosition(p.id));
  }

  function amendSLTP(posId, slPrice, tpPrice) {
    if (!Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    const p = { ctidTraderAccountId: acc, positionId: posId, accessToken: Conn.creds.accessToken };
    if (slPrice != null) p.stopLoss = { price: slPrice };
    if (tpPrice != null) p.takeProfit = { price: tpPrice };
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.AMEND_POSITION_SLTP_REQ, payload: p });
  }

  function cancelOrder(id) {
    if (!Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    Conn.send({
      clientMsgId: Conn.nextId(),
      payloadType: P.CANCEL_ORDER_REQ,
      payload: { ctidTraderAccountId: acc, orderId: id, accessToken: Conn.creds.accessToken }
    });
    log('Cancelling pending order #' + id, 'info');
  }

  function setSLonPos(id, pips) {
    const pos = S.positions.find((p) => p.id === id);
    if (!pos) return;
    const det = S.byName.get(pos.symbol);
    const pip = window.pipFromSym(det);
    const spot = S.spots.get(pos.symbol);
    const ref = spot ? (pos.side === 'buy' ? spot.bid : spot.ask) : pos.entry;
    const slPrice = ref - (pos.side === 'buy' ? pips * pip : -pips * pip);
    amendSLTP(id, roundToPoint(slPrice, det), null);
    toast('SL adjusted on #' + id, 'ok');
  }

  function setTPonPos(id, pips) {
    const pos = S.positions.find((p) => p.id === id);
    if (!pos) return;
    const det = S.byName.get(pos.symbol);
    const pip = window.pipFromSym(det);
    const spot = S.spots.get(pos.symbol);
    const ref = spot ? (pos.side === 'buy' ? spot.bid : spot.ask) : pos.entry;
    const tpPrice = ref + (pos.side === 'buy' ? pips * pip : -pips * pip);
    amendSLTP(id, null, roundToPoint(tpPrice, det));
    toast('TP adjusted on #' + id, 'ok');
  }

  function roundToPoint(v, det) {
    return Math.round(v / window.pointFromSym(det)) * window.pointFromSym(det);
  }

  function getSymbols() {
    const acc = parseInt(S.accountId, 10);
    if (!acc) return;
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.GET_SYMBOLS_REQ, payload: { ctidTraderAccountId: acc } });
  }

  function getTrader() {
    const acc = parseInt(S.accountId, 10);
    if (!acc) return;
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.TRADER_REQ, payload: { ctidTraderAccountId: acc } });
  }

  function getOrders() {
    const acc = parseInt(S.accountId, 10);
    if (!acc) return;
    Conn.send({ clientMsgId: Conn.nextId(), payloadType: P.RECONCILE_REQ, payload: { ctidTraderAccountId: acc, returnProtectionOrders: true } });
  }

  // ============================================================
  // CHART CANVAS ENGINE
  // ============================================================
  function initChart() {
    const el = $('chartContainer');
    if (!el || !window.LightweightCharts) { log('Lightweight charts dependency missing.', 'err'); return; }
    S.chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { backgroundColor: '#050812', textColor: '#8899ac', fontSize: 11, fontFamily: 'Plus Jakarta Sans, sans-serif' },
      grid: { vertLines: { color: '#0d1326' }, horzLines: { color: '#0d1326' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#18233c' },
      timeScale: { borderColor: '#18233c', timeVisible: true, rightOffset: 4 },
      handleScroll: true,
      handleScale: true,
    });
    S.cs = S.chart.addCandlestickSeries({ upColor: '#10b981', downColor: '#f43f5e', borderUpColor: '#10b981', borderDownColor: '#f43f5e', wickUpColor: '#10b981', wickDownColor: '#f43f5e' });
    S.bs = S.chart.addBarSeries({ upColor: '#10b981', downColor: '#f43f5e' });
    S.ls = S.chart.addLineSeries({ color: '#22d3ee', lineWidth: 2 });
    applyChartType();

    window.addEventListener('resize', () => {
      if (S.chart) S.chart.resize(el.clientWidth, el.clientHeight);
      const r = $('rsiContainer');
      if (S.rsiChart && r) S.rsiChart.resize(r.clientWidth, r.clientHeight);
    });
  }

  function tfSeconds(tf) { return window.TF_SECONDS[tf] || 900; }
  function tfBarTime() {
    const bs = tfSeconds(S.currentTF);
    return Math.floor(Math.floor(Date.now() / 1000) / bs) * bs;
  }

  function renderBars() {
    const key = S.currentSymbol + '_' + S.currentTF;
    const base = (S.ohlc[key] || []).slice();
    if (S.liveBar && S.liveBar.time > 0) {
      if (base.length && base[base.length - 1].time === S.liveBar.time) base[base.length - 1] = S.liveBar;
      else if (!base.length || S.liveBar.time > base[base.length - 1].time) base.push(S.liveBar);
    }
    return cleanBars(base);
  }

  function cleanBars(data) {
    const seen = {}, out = [];
    data.slice().sort((a, b) => a.time - b.time).forEach((b) => {
      if (!seen[b.time]) {
        seen[b.time] = 1;
        out.push(b);
      }
    });
    return out;
  }

  function updateChartData() {
    if (!S.chart || !S.currentSymbol) return;
    const data = renderBars();
    if (!data.length) { S.cs.setData([]); S.bs.setData([]); S.ls.setData([]); return; }
    S.cs.setData(data);
    S.bs.setData(data);
    S.ls.setData(data.map((d) => ({ time: d.time, value: d.close })));
    calculateIndicators(data);
    if (S.chart.timeScale) S.chart.timeScale().fitContent();
  }

  function renderChartHeader(det, bid, ask) {
    const el = $('chartSymbolPrice');
    if (el) el.textContent = bid != null ? bid.toFixed(det.digits) : '—';
    const spr = $('chartSymbolSpr');
    if (spr && bid && ask) spr.textContent = 'Spread ' + ((ask - bid) / window.pipFromSym(det)).toFixed(1);
    const ob = $('octBid'), oa = $('octAsk');
    if (ob) ob.textContent = bid != null ? bid.toFixed(det.digits) : '—';
    if (oa) oa.textContent = ask != null ? ask.toFixed(det.digits) : '—';
  }

  function renderChartSpot(bid) {
    if (!bid || !S.currentSymbol || !S.cs) return;
    const bt = tfBarTime();
    const bar = { time: bt, open: bid, high: bid, low: bid, close: bid };
    const prev = S.liveBar;
    if (prev && prev.time === bt) {
      bar.open = prev.open;
      bar.high = Math.max(prev.high, bid);
      bar.low = Math.min(prev.low, bid);
      bar.close = bid;
    }
    S.liveBar = bar;
    S.cs.update(bar);
    S.bs.update(bar);
    S.ls.update({ time: bt, value: bid });
    const now = Date.now();
    if (now - S._indThrottle > 250) {
      S._indThrottle = now;
      calculateIndicators(renderBars());
    }
  }

  // ---------------- Math & Indicators Calculations ----------------
  function calcEMA(d, p) {
    const e = []; if (!d.length) return e;
    const k = 2 / (p + 1);
    let pe = d[0].close;
    e.push({ time: d[0].time, value: pe });
    for (let i = 1; i < d.length; i++) {
      pe = d[i].close * k + pe * (1 - k);
      e.push({ time: d[i].time, value: pe });
    }
    return e;
  }

  function calcSMA(d, p) {
    const s = [];
    for (let i = p - 1; i < d.length; i++) {
      let sum = 0;
      for (let j = 0; j < p; j++) sum += d[i - j].close;
      s.push({ time: d[i].time, value: sum / p });
    }
    return s;
  }

  function calcBB(d, p, m) {
    const b = { basis: [], upper: [], lower: [] };
    for (let i = p - 1; i < d.length; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += d[i - j].close;
      const a = s / p;
      let v = 0;
      for (let j = 0; j < p; j++) v += Math.pow(d[i - j].close - a, 2);
      const sd = Math.sqrt(v / p);
      b.basis.push({ time: d[i].time, value: a });
      b.upper.push({ time: d[i].time, value: a + m * sd });
      b.lower.push({ time: d[i].time, value: a - m * sd });
    }
    return b;
  }

  function calcRSI(d, p) {
    const r = []; if (d.length <= p) return r;
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) {
      const diff = d[i].close - d[i - 1].close;
      if (diff > 0) ag += diff; else al += Math.abs(diff);
    }
    ag /= p;
    al /= p;
    let rs = al === 0 ? 100 : ag / al;
    r.push({ time: d[p].time, value: 100 - 100 / (1 + rs) });
    for (let i = p + 1; i < d.length; i++) {
      const diff = d[i].close - d[i - 1].close, g = diff > 0 ? diff : 0, l = diff < 0 ? Math.abs(diff) : 0;
      ag = (ag * (p - 1) + g) / p;
      al = (al * (p - 1) + l) / p;
      rs = al === 0 ? 100 : ag / al;
      r.push({ time: d[i].time, value: 100 - 100 / (1 + rs) });
    }
    return r;
  }

  function calcATR(d, p) {
    const a = [];
    for (let i = 1; i < d.length; i++) {
      const tr = Math.max(d[i].high - d[i].low, Math.abs(d[i].high - d[i - 1].close), Math.abs(d[i].low - d[i - 1].close));
      a.push(tr);
    }
    if (a.length < p) return [];
    let sma = 0;
    for (let i = 0; i < p; i++) sma += a[i];
    const out = [{ time: d[p].time, value: sma / p }];
    for (let i = p; i < a.length; i++) {
      sma = (sma * (p - 1) + a[i]) / p;
      out.push({ time: d[i + 1].time, value: sma });
    }
    return out;
  }

  function calculateIndicators(data) {
    if (!S.chart || !data.length) return;
    const mk = (obj, prop, color, w, title) => {
      if (!obj[prop]) obj[prop] = S.chart.addLineSeries({ color, lineWidth: w || 1.5, title: title || prop.toUpperCase(), priceLineVisible: false });
      return obj[prop];
    };
    if (S.ind.ema9) mk(S, 'ema9', '#38bdf8').setData(calcEMA(data, 9));
    else if (S.ema9) { S.chart.removeSeries(S.ema9); S.ema9 = null; }

    if (S.ind.ema21) mk(S, 'ema21', '#f59e0b').setData(calcEMA(data, 21));
    else if (S.ema21) { S.chart.removeSeries(S.ema21); S.ema21 = null; }

    if (S.ind.sma50) mk(S, 'sma50', '#a78bfa', 1.5).setData(calcSMA(data, 50));
    else if (S.sma50) { S.chart.removeSeries(S.sma50); S.sma50 = null; }

    if (S.ind.bb) {
      if (!S.bbB) {
        S.bbB = S.chart.addLineSeries({ color: '#596a84', lineWidth: 1, priceLineVisible: false });
        S.bbU = S.chart.addLineSeries({ color: '#596a84', lineWidth: 1, priceLineVisible: false });
        S.bbL = S.chart.addLineSeries({ color: '#596a84', lineWidth: 1, priceLineVisible: false });
      }
      const bb = calcBB(data, 20, 2);
      S.bbB.setData(bb.basis);
      S.bbU.setData(bb.upper);
      S.bbL.setData(bb.lower);
    } else if (S.bbB) {
      S.chart.removeSeries(S.bbB); S.chart.removeSeries(S.bbU); S.chart.removeSeries(S.bbL);
      S.bbB = S.bbU = S.bbL = null;
    }

    const rc = $('rsiContainer');
    if (S.ind.rsi) {
      rc.style.display = 'block';
      if (!S.rsiChart) {
        S.rsiChart = LightweightCharts.createChart(rc, {
          width: rc.clientWidth,
          height: rc.clientHeight,
          layout: { backgroundColor: '#050812', textColor: '#596a84', fontSize: 10 },
          grid: { vertLines: { visible: false }, horzLines: { color: '#0d1326' } },
          rightPriceScale: { borderColor: '#18233c' },
          timeScale: { visible: false },
        });
        S.rsiS = S.rsiChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1.5 });
      }
      S.rsiS.setData(calcRSI(data, 14));
    } else {
      rc.style.display = 'none';
      if (S.rsiChart) { S.rsiChart = null; S.rsiS = null; rc.innerHTML = ''; }
    }
  }

  function applyChartType() {
    const t = S.chartType;
    if (!S.cs) return;
    S.cs.applyOptions({ visible: t === 'candles' });
    S.bs.applyOptions({ visible: t === 'bars' });
    S.ls.applyOptions({ visible: t === 'line' });
    updateChartData();
  }

  function setChartType(t) {
    S.chartType = t;
    ['candles', 'bars', 'line'].forEach((k) => {
      const b = $('ct_' + k); if (b) b.classList.toggle('active', k === t);
    });
    applyChartType();
  }

  function setTF(tf) {
    S.currentTF = tf;
    localStorage.setItem('ctrader_tf', tf);
    document.querySelectorAll('.tf-btn').forEach((b) => b.classList.toggle('active', b.dataset.tf === tf));
    const key = S.currentSymbol + '_' + tf;
    if (S.currentSymbol) {
      S.ohlc[key] = [];
      S.liveBar = null;
      updateChartData();
      loadHistory(S.currentSymbol, tf);
    }
  }

  function toggleGrid() {
    S.grid = !S.grid;
    const g = S.grid ? '#0d1326' : 'transparent';
    S.chart.applyOptions({ grid: { vertLines: { color: g }, horzLines: { color: g } } });
  }

  function toggleIndicator(k) {
    S.ind[k] = !S.ind[k];
    updateChartData();
    log('Indicator ' + k.toUpperCase() + ' toggled ' + (S.ind[k] ? 'ON' : 'OFF'), 'info');
  }

  function selectSymbol(name) {
    S.currentSymbol = name;
    S.liveBar = null;
    document.querySelectorAll('.instrument-row').forEach((r) => r.classList.toggle('active', r.dataset.name === name));
    $('chartSymbolName').textContent = name;
    $('chartSymbolPrice').textContent = '—';
    $('chartSymbolSpr').textContent = '';
    if ($('ticketSymbol')) $('ticketSymbol').value = name;
    const key = name + '_' + S.currentTF;
    if (!S.ohlc[key]) S.ohlc[key] = [];
    updateChartData();
    loadHistory(name, S.currentTF);
    updateTicket();

    const det = S.byName.get(name);
    if (det && !det.isFull) {
      requestFullSymbols([det.symbolId]);
    }

    if (window.matchMedia('(max-width:860px)').matches) {
      const wl = $('watchPanel'); if (wl) wl.style.display = 'none';
      document.querySelector('.chart-main-container').scrollIntoView({ behavior: 'smooth' });
    }
  }

  function loadHistory(name, tf) {
    const det = S.byName.get(name);
    if (!det || !Conn.connected) return;
    const acc = parseInt(S.accountId, 10);
    const period = window.TF_PERIOD[tf] || 7;
    const nowMin = Math.floor(Date.now() / 60000);
    Conn.send({
      clientMsgId: Conn.nextId(), payloadType: P.GET_TRENDBARS_REQ,
      payload: { ctidTraderAccountId: acc, symbolId: det.symbolId, period, fromTimestamp: nowMin - 60 * 24 * 7, count: 500 },
    });
    clearTimeout(S._histTimer);
    const key = name + '_' + tf;
    S._histTimer = setTimeout(() => {
      if (S.currentSymbol === name && (!S.ohlc[key] || !S.ohlc[key].length)) seedExternalHistory(name, tf);
    }, 2500);
  }

  function toBinance(sym) {
    const m = String(sym || '').match(/^([A-Za-z]{2,6})(USD|USDC|EUR|JPY|GBP|USDT)$/);
    if (!m) return null;
    let q = m[2].toUpperCase();
    if (q === 'USD') q = 'USDT';
    return m[1].toUpperCase() + q;
  }

  function seedExternalHistory(name, tf) {
    const bn = toBinance(name);
    if (!bn) return;
    const iv = { M1: '1m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H4: '4h', D1: '1d' }[tf] || '15m';
    fetch('https://api.binance.com/api/v3/klines?symbol=' + bn + '&interval=' + iv + '&limit=500')
      .then((r) => r.json())
      .then((k) => {
        if (!Array.isArray(k) || !k.length) return;
        const key = name + '_' + tf;
        S.ohlc[key] = k.map((x) => ({ time: Math.floor(x[0] / 1000), open: +x[1], high: +x[2], low: +x[3], close: +x[4] }));
        S.liveBar = null;
        log('Seeded ' + S.ohlc[key].length + ' bars from external feed (' + bn + ').', 'info');
        updateChartData();
      })
      .catch(() => { /* silent offline feed fallback */ });
  }

  // ============================================================
  // AUTO TRADING STRATEGY
  // ============================================================
  function evalProfitInPips(pos) {
    const det = S.byName.get(pos.symbol);
    const spot = S.spots.get(pos.symbol);
    const cur = spot ? (pos.side === 'buy' ? spot.bid : spot.ask) : pos.entry;
    return window.pipsBetween(cur, pos.entry, det) * (pos.side === 'buy' ? 1 : -1);
  }

  function managePositions(symName, price) {
    const now = Date.now();
    S.positions.forEach((pos) => {
      if (pos.symbol !== symName) return;
      const det = S.byName.get(symName);
      if (!det) return;
      const pip = window.pipFromSym(det);
      const pips = evalProfitInPips(pos);
      let target = null;
      if (S.ea.be && pips >= S.ea.beTrigger) {
        target = pos.entry + (pos.side === 'buy' ? S.ea.beLock * pip : -S.ea.beLock * pip);
      }
      if (S.ea.trail && pips >= S.ea.trailTrigger) {
        const t = price - (pos.side === 'buy' ? S.ea.trailDist * pip : -S.ea.trailDist * pip);
        if (target == null || (pos.side === 'buy' ? t > target : t < target)) target = t;
      }
      if (target == null) return;
      const better = pos.side === 'buy' ? target > (pos.sl || 0) : target < (pos.sl || 0);
      if (!better) return;
      const st = S._slState[pos.id];
      const near = st && Math.abs(st.sl - target) < pip * 0.5;
      if (near) return;
      if (st && now - st.lastAmend < 3000) return;
      S._slState[pos.id] = { sl: target, lastAmend: now };
      amendSLTP(pos.id, roundToPoint(target, det), null);
      elog('Managed SL on #' + pos.id + ' adjusted -> ' + roundToPoint(target, det).toFixed(det.digits), 'info');
    });
  }

  function riskLots(name, slPips, atr) {
    const det = S.byName.get(name);
    if (!det) return 0.01;
    if (S.ea.mode === 'fixed') return S.ea.fixedLot;
    const riskAmt = (S.trader.balance || 0) * (S.ea.riskPct / 100);
    if (riskAmt <= 0) return 0.01;
    const pip = window.pipFromSym(det);
    const slDist = slPips * pip;
    if (det.lotSize >= 1000) {
      const riskPerLot = slDist * det.lotSize;
      return Math.max(0.01, riskAmt / riskPerLot);
    }
    const units = Math.max(det.minVolume || 1, riskAmt / slDist);
    return units / det.lotSize;
  }

  function evaluateSignals(name, price) {
    if (!S.botRunning || !Conn.connected) return;
    const key = name + '_' + S.currentTF;
    const h = S.ohlc[key];
    if (!h || h.length < 60) return;
    const det = S.byName.get(name);
    if (!det) return;
    if (S.ea.onlyCurrent && name !== S.currentSymbol) return;
    if (S.positions.length >= S.ea.maxPos) return;
    const spot = S.spots.get(name);
    if (spot && spot.bid && spot.ask) {
      const spreadPips = window.pipsBetween(spot.bid, spot.ask, det);
      if (S.ea.maxSpread > 0 && spreadPips > S.ea.maxSpread) return;
    }
    if (S.ea.maxDailyLoss > 0) {
      const daily = S.history.slice(0, 50).reduce((a, hh) => a + (hh.profit || 0), 0);
      if (daily <= -S.ea.maxDailyLoss) { stopBot(true); return; }
    }
    const now = Date.now();
    if (S._lastSig && S._lastSig[name] && now - S._lastSig[name] < S.ea.minCooldown * 1000) return;

    const e9 = calcEMA(h, 9), e21 = calcEMA(h, 21), rsi = calcRSI(h, 14), bb = calcBB(h, 20, 2), atr = calcATR(h, 14);
    if (e9.length < 2 || e21.length < 2 || rsi.length < 2 || bb.basis.length < 2 || !atr.length) return;

    const l9 = e9[e9.length - 1].value, p9 = e9[e9.length - 2].value;
    const l21 = e21[e21.length - 1].value, p21 = e21[e21.length - 2].value;
    const lr = rsi[rsi.length - 1].value;
    const ub = bb.upper[bb.upper.length - 1].value, lb = bb.lower[bb.lower.length - 1].value;
    const atrV = atr[atr.length - 1].value;
    const pip = window.pipFromSym(det);
    const slPips = Math.max(8, (atrV * S.ea.atrMult) / pip);
    const tpPips = slPips * S.ea.rr;

    const signal = (p9 <= p21 && l9 > l21 && lr > 45 && lr < 68 && price <= ub)
      ? 'buy'
      : (p9 >= p21 && l9 < l21 && lr > 32 && lr < 55 && price >= lb)
        ? 'sell'
        : null;

    if (!signal) return;
    if (!S._lastSig) S._lastSig = {};
    S._lastSig[name] = now;
    const lots = riskLots(name, slPips, atrV);
    elog('Calculated signal: ' + signal.toUpperCase() + ' ' + name + ' @ ' + price + ' (SL ' + slPips.toFixed(0) + 'p, TP ' + tpPips.toFixed(0) + 'p)', 'ok');
    const o = buildOrderPayload(name, signal, 'MARKET', lots, slPips, tpPips, price);
    if (sendOrder(o)) elog('Automated trade placed successfully.', 'ok');
  }

  function toggleBot() {
    if (!Conn.connected) { toast('Authentication link required', 'err'); return; }
    if (!S.currentSymbol) { toast('Active market required', 'err'); return; }
    S.botRunning = !S.botRunning;
    const btn = $('eaBtn');
    if (btn) {
      btn.classList.toggle('running', S.botRunning);
      btn.innerHTML = S.botRunning ? '● Bot Active' : '○ Launch Bot';
    }
    elog('Bot Automated Engine ' + (S.botRunning ? 'LAUNCHED' : 'PAUSED') + '.', S.botRunning ? 'ok' : 'err');
    log('Automation ' + (S.botRunning ? 'enabled' : 'disabled') + '.', S.botRunning ? 'ok' : 'warn');
  }

  function stopBot(byLoss) {
    S.botRunning = false;
    const btn = $('eaBtn');
    if (btn) { btn.classList.remove('running'); btn.innerHTML = '○ Launch Bot'; }
    elog('Bot halted' + (byLoss ? ' (Daily loss threshold hit).' : ' manually.'), 'err');
  }

  function saveEA() {
    const read = (id, def) => { const v = parseFloat($(id).value); return isNaN(v) ? def : v; };
    S.ea.mode = $('eaMode').value;
    S.ea.riskPct = read('eaRisk', 1);
    S.ea.fixedLot = read('eaFixedLot', 0.1);
    S.ea.maxPos = parseInt($('eaMaxPos').value, 10) || 3;
    S.ea.maxSpread = read('eaMaxSpread', 5);
    S.ea.atrMult = read('eaAtrMult', 2.5);
    S.ea.rr = read('eaRR', 3);
    S.ea.trail = $('eaTrail').classList.contains('on');
    S.ea.trailTrigger = read('eaTrailTrigger', 40);
    S.ea.trailDist = read('eaTrailDist', 20);
    S.ea.be = $('eaBE').classList.contains('on');
    S.ea.beTrigger = read('eaBeTrigger', 30);
    S.ea.beLock = read('eaBeLock', 2);
    S.ea.maxDailyLoss = read('eaMaxLoss', 0);
    S.ea.minCooldown = read('eaCooldown', 60);
    S.ea.onlyCurrent = $('eaOnlyCurrent').checked;
    localStorage.setItem('ctrader_ea', JSON.stringify(S.ea));
    closeModal('eaModal');
    toast('Automated preferences applied', 'ok');
    log('Risk allocation parameters updated.', 'ok');
  }

  // ============================================================
  // HUD & TABLES UI RENDERING
  // ============================================================
  let _throttles = {};
  function throttled(fn, ms) {
    const k = fn._tk || (fn._tk = Math.random());
    const now = Date.now();
    if (_throttles[k] && now - _throttles[k] < ms) return;
    _throttles[k] = now;
    fn();
  }

  function populateSymbolSelects() {
    const sel = $('ticketSymbol');
    if (!sel) return;
    sel.innerHTML = '';
    S.catOrder.forEach((cat) => {
      if (!S.byCat[cat].length) return;
      const og = document.createElement('optgroup');
      og.label = cat;
      S.byCat[cat].forEach((d) => {
        const o = document.createElement('option');
        o.value = d.symbolName; o.textContent = d.symbolName;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  function renderWatchlist() {
    const body = $('watchBody');
    if (!body) return;
    body.innerHTML = '';
    const q = S.search.toUpperCase();
    let list = [];
    if (S.activeCat === 'All') {
      S.catOrder.forEach((cat) => { list = list.concat(S.byCat[cat]); });
    } else {
      list = S.byCat[S.activeCat] || [];
    }
    const filtered = list.filter((d) => !q || d.symbolName.toUpperCase().indexOf(q) !== -1);
    if (!filtered.length) {
      body.innerHTML = '<div class="empty-state">' + (q ? 'No instruments match search criteria.' : 'Load credentials to populate watchlists.') + '</div>';
      $('wlCount').textContent = '0';
      return;
    }
    $('wlCount').textContent = filtered.length;
    filtered.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'instrument-row' + (S.currentSymbol === d.symbolName ? ' active' : '');
      row.dataset.name = d.symbolName;
      const spot = S.spots.get(d.symbolName);
      const bid = spot ? spot.bid : null;
      const chg = spot && spot.open ? (bid - spot.open) / spot.open * 100 : null;

      row.innerHTML =
        '<div class="instrument-name-col">' +
          '<span class="name">' + escapeHtml(d.symbolName) + '</span>' +
          '<span class="category">' + d.category + '</span>' +
        '</div>' +
        '<div class="instrument-bid" id="bid_' + d.symbolName + '">' + (bid != null ? bid.toFixed(d.digits) : '—') + '</div>' +
        '<div class="instrument-change ' + (chg > 0 ? 'positive' : chg < 0 ? 'negative' : '') + '" id="chg_' + d.symbolName + '">' + (chg != null ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '') + '</div>';

      row.addEventListener('click', () => selectSymbol(d.symbolName));
      body.appendChild(row);
    });
  }

  function renderWatchlistRow(name) {
    const spot = S.spots.get(name);
    if (!spot) return;
    const det = S.byName.get(name);
    if (!det) return;
    const bidEl = $('bid_' + name), chgEl = $('chg_' + name);
    if (!bidEl) return;
    if (spot.bid != null) bidEl.textContent = spot.bid.toFixed(det.digits);
    const chg = spot.open ? (spot.bid - spot.open) / spot.open * 100 : null;
    if (chgEl && chg != null) {
      chgEl.textContent = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';
      chgEl.className = 'instrument-change ' + (chg > 0 ? 'positive' : chg < 0 ? 'negative' : '');
    }
  }

  function setCategory(cat) {
    S.activeCat = cat;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === cat));
    renderWatchlist();
  }

  function updateHeader() {
    const bal = $('hBalance'), eq = $('hEquity'), mrg = $('hMargin');
    if (bal) bal.textContent = fmt(S.trader.balance);
    if (eq) eq.textContent = fmt(S.trader.equity);
    if (mrg) mrg.textContent = fmt(S.trader.margin);
    const accSel = $('accSelect');
    if (accSel && accSel.value !== String(S.accountId) && S.accountId) accSel.value = S.accountId;
  }

  function renderStats() {
    $('stBalance').textContent = fmt(S.trader.balance);
    $('stEquity').textContent = fmt(S.trader.equity);
    const ml = $('stML');
    if (ml) ml.textContent = S.trader.margin > 0 ? fmt(S.trader.marginLevel, 0) + '%' : '—';
    let floating = 0;
    S.positions.forEach((p) => { floating += profitOf(p); });
    const fEl = $('stFloat');
    if (fEl) {
      fEl.textContent = (floating >= 0 ? '+' : '') + floating.toFixed(2);
      fEl.className = 'val ' + (floating >= 0 ? 'positive' : 'negative');
    }
  }

  function profitOf(pos) {
    if (pos.profit != null) return pos.profit;
    const det = S.byName.get(pos.symbol);
    const spot = S.spots.get(pos.symbol);
    if (!det || !spot) return 0;
    const cur = pos.side === 'buy' ? spot.bid : spot.ask;
    const q = (det.quoteAsset || '').toUpperCase();
    if (q && q.indexOf(S.trader.currency.toUpperCase()) === -1 && q !== 'USD') return 0;
    return (cur - pos.entry) * pos.units * (pos.side === 'buy' ? 1 : -1);
  }

  function renderPositions() {
    const tb = $('positionsBody');
    if (!tb) return;
    if (!S.positions.length) { tb.innerHTML = '<div class="table-empty-row">No open positions</div>'; renderStats(); return; }
    tb.innerHTML = S.positions.map((p) => {
      const det = S.byName.get(p.symbol);
      const dig = det ? det.digits : 5;
      const spot = S.spots.get(p.symbol);
      const cur = spot ? (p.side === 'buy' ? spot.bid : spot.ask) : p.entry;
      const profit = profitOf(p);
      const pips = evalProfitInPips(p);
      return '<div class="trade-row-box">' +
        '<div class="trade-row-header">' +
          '<span class="sym-name">' + escapeHtml(p.symbol) + '</span>' +
          '<span class="side-badge ' + p.side + '">' + p.side.toUpperCase() + '</span>' +
          '<span class="volume-txt">' + fmt(p.volume, 2) + ' lots</span>' +
          '<span class="pnl-txt ' + (profit >= 0 ? 'positive' : 'negative') + '">' + (profit >= 0 ? '+' : '') + profit.toFixed(2) + '</span>' +
        '</div>' +
        '<div class="trade-row-metadata">' +
          (pips >= 0 ? '+' : '') + pips.toFixed(1) + ' pips · Entry: ' + fmt(p.entry, dig) + ' · Current: ' + fmt(cur, dig) +
        '</div>' +
        '<div class="trade-row-actions">' +
          '<button class="row-action-btn" onclick="App.closePosition(' + p.id + ')">Close</button>' +
          '<button class="row-action-btn safe-hover" onclick="App.setSL(' + p.id + ',15)">SL +15</button>' +
          '<button class="row-action-btn safe-hover" onclick="App.setTP(' + p.id + ',30)">TP +30</button>' +
        '</div>' +
      '</div>';
    }).join('');
    renderStats();
  }

  function renderPending() {
    const tb = $('pendingBody');
    if (!tb) return;
    if (!S.pending.length) { tb.innerHTML = '<div class="table-empty-row">No pending orders</div>'; return; }
    tb.innerHTML = S.pending.map((o) => {
      return '<div class="trade-row-box">' +
        '<div class="trade-row-header">' +
          '<span class="sym-name">' + escapeHtml(o.symbol) + '</span>' +
          '<span class="side-badge ' + o.side + '">' + o.side.toUpperCase() + '</span>' +
          '<span class="volume-txt">' + (o.type || 'LIMIT') + ' · ' + fmt(o.volume, 2) + ' lots</span>' +
        '</div>' +
        '<div class="trade-row-metadata">Price target: ' + fmt(o.price, 5) + '</div>' +
        '<div class="trade-row-actions">' +
          '<button class="row-action-btn" onclick="App.cancelOrder(' + o.id + ')">Cancel</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderHistory() {
    const tb = $('historyBody');
    if (!tb) return;
    if (!S.history.length) { tb.innerHTML = '<div class="table-empty-row">No closed history</div>'; return; }
    tb.innerHTML = S.history.slice(0, 60).map((h) => {
      return '<div class="trade-row-box">' +
        '<div class="trade-row-header">' +
          '<span class="sym-name">' + escapeHtml(h.symbol) + '</span>' +
          '<span class="side-badge ' + h.side + '">' + h.side.toUpperCase() + '</span>' +
          '<span class="volume-txt">' + fmt(h.volume, 2) + ' lots</span>' +
          '<span class="pnl-txt ' + (h.profit >= 0 ? 'positive' : 'negative') + '">' + (h.profit >= 0 ? '+' : '') + fmt(h.profit) + '</span>' +
        '</div>' +
        '<div class="trade-row-metadata">' + h.time + '</div>' +
      '</div>';
    }).join('');
  }

  function switchPanel(tab) {
    ['positions', 'pending', 'history'].forEach((k) => {
      const p = $('panel_' + k);
      if (p) p.style.display = k === tab ? 'block' : 'none';
    });
    document.querySelectorAll('.trade-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.panel === tab);
    });
  }

  function switchLogs(tab) {
    const j = $('logJournalWrap'), e = $('logEAWrap');
    if (tab === 'journal') {
      j.style.display = 'block'; e.style.display = 'none';
    } else {
      j.style.display = 'none'; e.style.display = 'block';
    }
    document.querySelectorAll('.console-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.log === tab);
    });
  }

  function updateTicket() {
    const sym = $('ticketSymbol').value || S.currentSymbol;
    const det = S.byName.get(sym);
    if (!det) return;
    const spot = S.spots.get(sym);
    const bid = spot ? spot.bid : null, ask = spot ? spot.ask : null;
    const ref = $('ticketType').value === 'LIMIT' || $('ticketType').value === 'STOP' ? parseFloat($('ticketPrice').value) : ((bid + ask) / 2);
    const sl = parseFloat($('ticketSL').value) || 0;
    const tp = parseFloat($('ticketTP').value) || 0;
    const pip = window.pipFromSym(det);
    const buy = $('tktBuy'), sell = $('tktSell');
    const mid = ref || bid;
    if (buy) {
      buy.innerHTML = '<span class="btn-primary-text">Buy</span> ' + (sl || tp ? (sl ? 'SL ' : '') + (sl ? fmt(mid - sl * pip, det.digits) : '') + (tp ? ' / TP ' + fmt(mid + tp * pip, det.digits) : '') : (mid != null ? fmt(mid, det.digits) : '—'));
    }
    if (sell) {
      sell.innerHTML = '<span class="btn-primary-text">Sell</span> ' + (sl || tp ? (sl ? 'SL ' : '') + (sl ? fmt(mid + sl * pip, det.digits) : '') + (tp ? ' / TP ' + fmt(mid - tp * pip, det.digits) : '') : (mid != null ? fmt(mid, det.digits) : '—'));
    }
  }

  // ============================================================
  // DIALOG MODAL CONTROLS
  // ============================================================
  function openModal(id) { const el = $(id); if (el) el.classList.add('open'); }
  function closeModal(id) { const el = $(id); if (el) el.classList.remove('open'); }

  // ============================================================
  // OAUTH AUTHMATE SIGNON
  // ============================================================
  function savePrefs() {
    localStorage.setItem('ctrader_env', S.env);
    localStorage.setItem('ctrader_account', S.accountId);
    localStorage.setItem('ctrader_access', S.accessToken);
    localStorage.setItem('ctrader_refresh', S.refreshToken);
    const cid = $('clientIdInput') ? $('clientIdInput').value.trim() : '';
    const csec = $('clientSecretInput') ? $('clientSecretInput').value.trim() : '';
    if (cid) {
      S.clientId = cid;
      localStorage.setItem('ctrader_client_id', cid);
    }
    if (csec) {
      S.clientSecret = csec;
      localStorage.setItem('ctrader_client_secret', csec);
    }
  }

  function startOAuth() {
    const ri = S.redirectUri || window.location.origin;
    if (/localhost|127\.0\.0\.1|file:/.test(window.location.origin)) {
      log('Localhost OAuth disabled — deployment redirect registered required.', 'warn');
      toast('Deploy to Vercel first', 'warn');
      return;
    }
    const cid = ($('clientIdInput') ? $('clientIdInput').value.trim() : '') || S.clientId;
    if (!cid) {
      toast('Enter Client ID first', 'err');
      return;
    }
    const url = 'https://openapi.ctrader.com/apps/auth?client_id=' + encodeURIComponent(cid) +
      '&redirect_uri=' + encodeURIComponent(ri) + '&scope=trading';
    log('Launching cTrader Open API login...', 'info');
    const popup = window.open(url, 'ctrader_oauth', 'width=560,height=700,popup=yes');
    if (!popup) log('Browser blocked signon popup. Enable popups and retry.', 'warn');
  }

  function receiveOAuthCode(code) {
    log('Authorization code received — executing exchange…', 'info');
    const params = {
      grant_type: 'authorization_code',
      code: String(code),
      redirect_uri: S.redirectUri || window.location.origin
    };
    const cid = ($('clientIdInput') ? $('clientIdInput').value.trim() : '') || S.clientId;
    const csec = ($('clientSecretInput') ? $('clientSecretInput').value.trim() : '') || S.clientSecret;
    if (cid) params.client_id = cid;
    if (csec) params.client_secret = csec;
    const body = new URLSearchParams(params);
    exchange(body);
  }

  function exchangeAuthCodeManual() {
    const raw = $('cbInput').value.trim();
    if (!raw) { toast('Callback input empty', 'err'); return; }
    let code = raw;
    try { const c = new URL(raw).searchParams.get('code'); if (c) code = c; } catch (e) { /* raw code value */ }
    receiveOAuthCode(code);
  }

  function postToken(body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    return fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      signal: ctrl.signal,
    }).then((r) => r.text()).then((txt) => {
      clearTimeout(timer);
      try { return JSON.parse(txt); } catch (e) { return { raw: txt }; }
    }).catch((e) => {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'timeout (25s)' : e.message);
    });
  }

  function oauthError(d) {
    return d && (d.error_description || d.error || d.description || d.errorCode || d.raw);
  }

  function exchange(body) {
    log('Querying authentication token endpoint…', 'info');
    postToken(body).then((d) => {
      if (d.accessToken) {
        S.accessToken = d.accessToken;
        if (d.refreshToken) S.refreshToken = d.refreshToken;
        savePrefs();
        $('tokInput').value = d.accessToken;
        log('Token exchanged successfully. Authorizing socket link…', 'ok');
        toast('OAuth Authorized', 'ok');
        Conn.connectFresh();
      } else {
        log('Authentication failed: ' + oauthError(d), 'err');
        toast('Exchange failed', 'err');
      }
    }).catch((e) => {
      log('Token exchange endpoint error: ' + e.message, 'err');
      toast('Exchange network failure', 'err');
    });
  }

  function refreshAccessToken() {
    if (!S.refreshToken) { toast('No refresh token — authorization expired', 'err'); return Promise.reject(new Error('no refresh token')); }
    const params = {
      grant_type: 'refresh_token',
      refresh_token: S.refreshToken,
      redirect_uri: S.redirectUri || window.location.origin
    };
    const cid = ($('clientIdInput') ? $('clientIdInput').value.trim() : '') || S.clientId;
    const csec = ($('clientSecretInput') ? $('clientSecretInput').value.trim() : '') || S.clientSecret;
    if (cid) params.client_id = cid;
    if (csec) params.client_secret = csec;
    return postToken(new URLSearchParams(params))
      .then((d) => {
        if (!d.accessToken) throw new Error(oauthError(d) || 'refresh failed');
        S.accessToken = d.accessToken;
        if (d.refreshToken) S.refreshToken = d.refreshToken;
        savePrefs();
        $('tokInput').value = d.accessToken;
        log('OAuth session renewed.', 'ok');
        return d.accessToken;
      });
  }

  function manualConnect() {
    const tok = $('tokInput').value.trim();
    if (!tok) { toast('Please input access token', 'err'); return; }
    S.accessToken = tok;
    savePrefs();
    log('Starting socket session manually…', 'info');
    Conn.connectFresh();
  }

  function changeAccount() {
    const sel = $('accSelect');
    if (!sel) return;
    S.accountId = sel.value;
    localStorage.setItem('ctrader_account', S.accountId);
    if (Conn.connected) {
      Conn.reconnectNow();
    } else {
      Conn.connect();
    }
  }

  // ============================================================
  // SYSTEM BOOTSTRAPPING
  // ============================================================
  function init() {
    initChart();
    bind();
    // Populate stored forms
    $('connEnv').value = S.env;
    if (S.clientId) $('clientIdInput').value = S.clientId;
    if (S.clientSecret) $('clientSecretInput').value = S.clientSecret;
    if (S.redirectUri) $('connRedirect').value = S.redirectUri;
    if (S.accessToken) $('tokInput').value = S.accessToken;
    populateEASettings();
    setTF(S.currentTF);
    $('gridBtn').classList.add('active');
    renderWatchlist();
    log('cTrader Bot Studio Pro — Engine Live.', 'ok');

    // Auto-reconnect if loaded previously
    if (S.accessToken && S.accountId) {
      setTimeout(() => {
        if (!Conn.connected && !Conn.isConnecting) {
          log('Saved credentials found — initiating link…', 'info');
          Conn.connect();
        }
      }, 400);
    } else {
      log('Inputs missing. Complete authentication settings to establish link.', 'warn');
    }
  }

  function bind() {
    $('connPill').addEventListener('click', () => {
      if (Conn.connected || Conn.isConnecting) {
        Conn.disconnect();
      } else {
        openModal('connModal');
      }
    });
    $('settingsBtn').addEventListener('click', () => openModal('connModal'));
    $('connEnv').addEventListener('change', (e) => { S.env = e.target.value; localStorage.setItem('ctrader_env', S.env); });
    $('clientIdInput').addEventListener('input', (e) => { S.clientId = e.target.value.trim(); localStorage.setItem('ctrader_client_id', S.clientId); });
    $('clientSecretInput').addEventListener('input', (e) => { S.clientSecret = e.target.value.trim(); localStorage.setItem('ctrader_client_secret', S.clientSecret); });
    $('connRedirect').addEventListener('input', (e) => { S.redirectUri = e.target.value; localStorage.setItem('ctrader_redirect', e.target.value); });
    $('accSelect').addEventListener('change', changeAccount);
    $('tokInput').addEventListener('input', (e) => { S.accessToken = e.target.value.trim(); localStorage.setItem('ctrader_access', S.accessToken); });
    $('wlSearch').addEventListener('input', (e) => { S.search = e.target.value; renderWatchlist(); });

    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.addEventListener('click', () => setCategory(b.dataset.cat));
    });

    // toolbar bindings
    document.querySelectorAll('.tf-btn').forEach((b) => {
      b.addEventListener('click', () => setTF(b.dataset.tf));
    });
    $('ct_candles').addEventListener('click', () => setChartType('candles'));
    $('ct_bars').addEventListener('click', () => setChartType('bars'));
    $('ct_line').addEventListener('click', () => setChartType('line'));
    $('ind_ema9').addEventListener('click', () => toggleIndicator('ema9'));
    $('ind_ema21').addEventListener('click', () => toggleIndicator('ema21'));
    $('ind_bb').addEventListener('click', () => toggleIndicator('bb'));
    $('ind_rsi').addEventListener('click', () => toggleIndicator('rsi'));
    $('gridBtn').addEventListener('click', toggleGrid);
    $('eaBtn').addEventListener('click', toggleBot);

    // orders triggers
    $('ticketSymbol').addEventListener('change', updateTicket);
    $('ticketType').addEventListener('change', updateTicket);
    ['ticketVol', 'ticketSL', 'ticketTP', 'ticketPrice'].forEach((id) => {
      $(id).addEventListener('input', updateTicket);
    });
    $('tktBuy').addEventListener('click', () => placeTicketOrder('buy'));
    $('tktSell').addEventListener('click', () => placeTicketOrder('sell'));
    $('quickBuy').addEventListener('click', () => placeQuick('buy'));
    $('quickSell').addEventListener('click', () => placeQuick('sell'));
    $('closeAllBtn').addEventListener('click', closeAll);

    // layout panel swaps
    document.querySelectorAll('.trade-tab').forEach((b) => {
      b.addEventListener('click', () => switchPanel(b.dataset.panel));
    });
    document.querySelectorAll('.console-tab').forEach((b) => {
      b.addEventListener('click', () => switchLogs(b.dataset.log));
    });

    // credentials actions
    $('oauthBtn').addEventListener('click', startOAuth);
    $('connectBtn').addEventListener('click', () => { closeModal('connModal'); Conn.connectFresh(); });
    $('disconnectBtn').addEventListener('click', () => { Conn.disconnect(); });
    $('cbGoBtn').addEventListener('click', exchangeAuthCodeManual);
    $('eaSaveBtn').addEventListener('click', saveEA);

    // toggle components switches
    ['eaTrail', 'eaBE'].forEach((id) => {
      $(id).addEventListener('click', () => $(id).classList.toggle('on'));
    });

    // close controls
    document.querySelectorAll('.modal-close-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const m = b.closest('.modal-overlay');
        if (m) m.classList.remove('open');
      });
    });
    document.querySelectorAll('.modal-overlay').forEach((o) => {
      o.addEventListener('click', (e) => {
        if (e.target === o) o.classList.remove('open');
      });
    });
  }

  function populateEASettings() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    $('eaMode').value = S.ea.mode;
    set('eaRisk', S.ea.riskPct); set('eaFixedLot', S.ea.fixedLot); set('eaMaxPos', S.ea.maxPos);
    set('eaMaxSpread', S.ea.maxSpread); set('eaAtrMult', S.ea.atrMult); set('eaRR', S.ea.rr);
    if (S.ea.trail) $('eaTrail').classList.add('on');
    if (S.ea.be) $('eaBE').classList.add('on');
    set('eaTrailTrigger', S.ea.trailTrigger); set('eaTrailDist', S.ea.trailDist);
    set('eaBeTrigger', S.ea.beTrigger); set('eaBeLock', S.ea.beLock);
    set('eaMaxLoss', S.ea.maxDailyLoss); set('eaCooldown', S.ea.minCooldown);
    $('eaOnlyCurrent').checked = S.ea.onlyCurrent;
  }

  function boot() {
    window.addEventListener('error', (e) => {
      const fn = (e && e.filename) ? e.filename.replace(/^.*\//, '') + (e && e.lineno ? ':' + e.lineno : '') : '';
      log('App Uncaught error' + (fn ? ' @' + fn : '') + ': ' + (e && e.message ? e.message : 'Unknown'), 'err');
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      log('Promise failure rejection: ' + (r && r.message ? r.message : 'Unknown'), 'err');
    });
    const isLocal = /localhost|127\.0\.0\.1|file:/.test(window.location.origin);
    if (isLocal) {
      log('Running inside offline environment. Dynamic proxy callbacks disabled.', 'warn');
    }
    fetch('/api/config').then((r) => r.json()).then((d) => {
      if (!S.clientId) S.clientId = d.clientId || '';
      if (!S.clientSecret) S.clientSecret = d.clientSecret || '';
      init();
      log(S.clientId ? 'API specs loaded.' : 'Empty configurations returned.', S.clientId ? 'ok' : 'err');
    }).catch(() => {
      init();
      log('Proxy configurations config error. Auth required manual parameters.', 'err');
    });
  }

  window.App = {
    receiveOAuthCode,
    closePosition,
    setSL: (id, pips) => setSLonPos(id, pips),
    setTP: (id, pips) => setTPonPos(id, pips),
    cancelOrder,
    openEA: () => openModal('eaModal'),
    selectSymbol,
  };

  (function () {
    const p = new URLSearchParams(window.location.search);
    const code = p.get('code');
    if (code) {
      if (window.opener && window.opener.App) {
        window.opener.App.receiveOAuthCode(code);
        window.close();
      } else {
        window.App.receiveOAuthCode(code);
        if (history.replaceState) history.replaceState({}, document.title, window.location.pathname);
      }
    }
  })();

  boot();
})();
