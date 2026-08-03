// ============================================================
// cTrader ConnectionManager
// Robust WebSocket lifecycle:
//   • proper auth handshake (app -> accounts -> account)
//   • liveness ping via GET_TRADER_REQ (never sends invalid payloads)
//   • zombie-connection watchdog (silent sockets get killed)
//   • jittered exponential backoff reconnect (capped, single-timer)
//   • full session re-initialisation on every reconnect
// ============================================================
window.Conn = (function () {
  const TOKEN_ERRORS = ['TOKEN_EXPIRED', 'INVALID_ACCESS_TOKEN', 'UNAUTHORIZED', 'ACCESS_TOKEN_INVALID'];
  const P = window.PAYLOAD;

  const c = {
    ws: null,
    state: 'idle', // idle | connecting | connected
    intentional: false,
    phase: '',
    reconnectTimer: null,
    reconnectScheduled: false,
    reconnectAttempts: 0,
    watchdogTimer: null,
    pingTimer: null,
    lastMsgAt: 0,
    connectStartedAt: 0,
    tokenErrorShown: false,

    // wired up by app.js
    config: null,
    onStatus: null,       // (text, cls: 'on'|'mid'|'off')
    onLog: null,          // (msg, cls)
    onConnected: null,    // () session re-init
    onDisconnected: null, // (reason)
    onAccounts: null,     // (accounts)
    onMessage: null,      // (type, payload, raw)
    onTokenError: null,   // ()

    get creds() { return this.config ? this.config.getCredentials() : { env: 'demo', clientId: '', clientSecret: '', accessToken: '', accountId: '' }; },

    init(cfg) {
      this.config = cfg;
      return this;
    },

    get connected() { return this.state === 'connected'; },
    get isConnecting() { return this.state === 'connecting'; },

    connect() {
      if (this.state === 'connecting' || this.state === 'connected') {
        this.log('Connect called but already ' + this.state + ' — use connectFresh() to restart.', 'warn');
        return;
      }
      const creds = this.creds;
      if (!creds.clientId || !creds.clientSecret) {
        this.log('Missing client credentials. Add them to api/config.js.', 'err');
        return;
      }
      this.intentional = false;
      this.giveUp = false;
      this._everOpened = false;
      this.reconnectScheduled = false;
      this.state = 'connecting';
      this.connectStartedAt = Date.now();
      this.tokenErrorShown = false;
      this.status('Connecting…', 'mid');
      this.log('Opening connection to ' + this.host() + '…', 'info');

      try { if (this.ws) this.ws.close(); } catch (e) { /* noop */ }
      const ws = new WebSocket('wss://' + this.host() + ':5036');
      this.ws = ws;

      ws.onopen = () => {
        this._everOpened = true;
        this.log('Socket open — authenticating app…', 'info');
        this.send({ clientMsgId: this.nextId(), payloadType: P.APPLICATION_AUTH_REQ, payload: { clientId: creds.clientId, clientSecret: creds.clientSecret } });
        this.phase = 'app_auth';
      };

      ws.onmessage = (e) => {
        this.lastMsgAt = Date.now();
        if (typeof e.data === 'string') this.handleRaw(e.data);
        else if (e.data instanceof Blob) e.data.text().then((t) => this.handleRaw(t)).catch(() => {});
      };

      ws.onerror = () => { this.log('WebSocket transport error (cannot reach ' + this.host() + ':5036).', 'err'); };

      ws.onclose = (ev) => {
        const wasConnected = this.state === 'connected';
        this.teardownTimers();
        this.state = 'idle';
        this.ws = null;
        this.phase = '';
        if (this.intentional) {
          this.status('Disconnected', 'off');
          this.log('Disconnected (manual).', 'warn');
          if (this.onDisconnected) this.onDisconnected('manual');
          return;
        }
        if (!this._everOpened) {
          this.log('Could not open the connection — check your network / firewall, then press Connect.', 'err');
          this.status('Connection failed', 'off');
          return;
        }
        this.log('Connection closed (' + ev.code + '). Reconnecting…', 'warn');
        this.status('Reconnecting…', 'mid');
        if (wasConnected && this.onDisconnected) this.onDisconnected('dropped');
        this.scheduleReconnect();
      };

      this.startWatchdog();
    },

    host() {
      return this.creds.env === 'live' ? 'live.ctraderapi.com' : 'demo.ctraderapi.com';
    },

    disconnect() {
      this.intentional = true;
      this.reconnectScheduled = false;
      this.teardownTimers();
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* noop */ } this.ws = null; }
      this.state = 'idle';
      this.phase = '';
      this.status('Disconnected', 'off');
      this.log('Disconnected.', 'warn');
    },

    send(msg) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try { this.ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
    },

    // Public: force a reconnect (used after token refresh)
    reconnectNow() {
      if (this.intentional) return;
      this.reconnectScheduled = false;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* noop */ } this.ws = null; }
      this.state = 'idle';
      this.connect();
    },

    // Public: always tear down and start fresh — used after OAuth/manual connect
    // so a stale "connecting" socket can never block a new token.
    connectFresh() {
      this.intentional = false;
      this.giveUp = false;
      this.reconnectScheduled = false;
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* noop */ } this.ws = null; }
      this.state = 'idle';
      this.log('Restarting connection with current credentials…', 'info');
      this.connect();
    },

    // ---------------- message pump ----------------
    handleRaw(data) {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      const type = msg.payloadType;
      const payload = msg.payload || {};

      switch (type) {
        case P.APPLICATION_AUTH_RES: {
          if (payload.errorCode) { this.authFailed(payload); return; }
          this.log('App authenticated.', 'ok');
          this.phase = 'app_authed';
          const creds = this.creds;
          if (creds.accessToken && creds.accountId) {
            this.accountAuth(creds.accountId, creds.accessToken);
          } else if (creds.accessToken) {
            this.requestAccounts();
          } else {
            this.state = 'idle';
            this.teardownTimers();
            this.status('Token required', 'off');
            this.log('No access token — click "Authorize with cTrader" first.', 'warn');
          }
          break;
        }
        case P.GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: {
          const accounts = payload.ctidTraderAccount || [];
          this.log(accounts.length + ' account(s) found for token.', 'ok');
          if (this.onAccounts) this.onAccounts(accounts);
          break;
        }
        case P.ACCOUNT_AUTH_RES: {
          if (payload.errorCode) { this.authFailed(payload); return; }
          this.state = 'connected';
          this.phase = 'authed';
          this.reconnectAttempts = 0;
          this.status('Connected', 'on');
          this.log('Account authenticated — session live.', 'ok');
          this.startPing();
          if (this.onConnected) this.onConnected();
          break;
        }
        case P.CLIENT_DISCONNECT_EVENT:
          this.log('Server closed the session (' + (payload.reason || '') + ').', 'warn');
          this.status('Reconnecting…', 'mid');
          this.scheduleReconnect();
          if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* noop */ } this.ws = null; }
          this.state = 'idle';
          break;
        case P.ERROR_RES: {
          const code = payload.errorCode || '';
          if (TOKEN_ERRORS.some((t) => code.toUpperCase().indexOf(t) !== -1)) {
            this.log('Access token invalid/expired (' + code + ').', 'err');
            if (!this.tokenErrorShown) { this.tokenErrorShown = true; if (this.onTokenError) this.onTokenError(); }
          } else if (code.toUpperCase() === 'AUTHENTICATION_FAILED' && this.phase !== 'authed') {
            this.authFailed(payload);
          } else {
            this.log('API error [' + code + ']: ' + (payload.description || ''), 'err');
          }
          break;
        }
        case P.ORDER_ERROR_EVENT:
          this.log('Order rejected [' + (payload.errorCode || '') + ']: ' + (payload.description || ''), 'err');
          break;
        default:
          if (this.onMessage) this.onMessage(type, payload, msg);
      }
    },

    authFailed(payload) {
      this.log('Authentication failed [' + payload.errorCode + ']: ' + (payload.description || ''), 'err');
      this.status('Auth failed', 'off');
      this.teardownTimers();
      if (payload.errorCode === 'AUTHENTICATION_FAILED') {
        this.log('Check your client ID / secret, then reconnect.', 'warn');
        this.intentional = true; // don't hot-loop on bad credentials
      }
      this.state = 'idle';
    },

    accountAuth(accountId, token) {
      const id = parseInt(accountId, 10);
      if (!id || isNaN(id)) { this.log('Invalid account ID.', 'err'); return; }
      this.log('Authenticating account #' + id + '…', 'info');
      this.phase = 'account_auth';
      this.send({ clientMsgId: this.nextId(), payloadType: P.ACCOUNT_AUTH_REQ, payload: { ctidTraderAccountId: id, accessToken: token } });
    },

    requestAccounts() {
      const token = this.creds.accessToken;
      if (!token) return;
      this.log('Listing accounts for token…', 'info');
      this.send({ clientMsgId: this.nextId(), payloadType: P.GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ, payload: { accessToken: token } });
    },

    // ---------------- keep-alive & watchdog ----------------
    startPing() {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.state !== 'connected' || !this.send) return;
        const id = this.creds.accountId;
        if (id) this.send({ clientMsgId: this.nextId(), payloadType: P.TRADER_REQ, payload: { ctidTraderAccountId: parseInt(id, 10) } });
      }, 30000);
    },

    startWatchdog() {
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.watchdogTimer = setInterval(() => {
        const ws = this.ws;
        if (!ws || this.state === 'idle') return;
        const idle = Date.now() - (this.lastMsgAt || Date.now());
        if (this.state === 'connected' && idle > 75000) {
          this.log('No data for ' + Math.round(idle / 1000) + 's — force-reconnecting.', 'warn');
          this.forceReconnect();
        } else if (this.state === 'connecting' && Date.now() - this.connectStartedAt > 20000) {
          this.log('Handshake stalled — force-reconnecting.', 'warn');
          this.forceReconnect();
        }
      }, 5000);
    },

    forceReconnect() {
      this.state = 'idle';
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) { /* noop */ } this.ws = null; }
      this.scheduleReconnect();
    },

    teardownTimers() {
      if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    },

    // ---------------- reconnect ----------------
    scheduleReconnect() {
      if (this.intentional || this.reconnectScheduled || this.giveUp) return;
      this.reconnectScheduled = true;
      this.reconnectAttempts++;
      if (this.reconnectAttempts > 8) {
        this.giveUp = true;
        this.state = 'idle';
        this.status('Connection failed', 'off');
        this.log('Gave up after 8 reconnect attempts. Check your network, then press Connect.', 'err');
        return;
      }
      const base = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      const jitter = Math.floor(Math.random() * 2000);
      const delay = base + jitter;
      this.log('Retrying in ' + Math.round(delay / 1000) + 's (attempt ' + this.reconnectAttempts + ').', 'warn');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectScheduled = false;
        if (this.intentional || this.giveUp) return;
        this.connect();
      }, delay);
    },

    // ---------------- utils ----------------
    nextId() { return 'cm_' + Date.now() + '_' + Math.floor(Math.random() * 1e6); },
    status(text, cls) { if (this.onStatus) this.onStatus(text, cls); },
    log(msg, cls) { if (this.onLog) this.onLog(msg, cls); },
  };

  return c;
})();
