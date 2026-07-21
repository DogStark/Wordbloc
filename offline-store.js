/**
 * SpellBloc Offline-First Persistence Layer (issue #12)
 *
 * IndexedDB-backed, event-sourced store meant to become the single
 * on-device source of truth for progress data. Every progress mutation
 * (word attempt, session end, star award, achievement trigger) or settings
 * change is modeled as an immutable, UUID-tagged event; the current
 * snapshot is a pure reduction over the event log, and the same log is used
 * as an append-only outbox that gets flushed to the server once online.
 *
 * Scope note: this module is additive infrastructure. It does not read from
 * or write to the existing `spellbloc_*` localStorage keys that game.js
 * still uses directly — it only *copies* them once (migrateFromLocalStorage)
 * so existing players' progress isn't lost when this store becomes the
 * source of truth. Rewiring game.js's game loop onto this store is tracked
 * separately in issue #6; the server ingestion endpoint is tracked in #9.
 * See docs/OFFLINE_ARCHITECTURE.md for the full design and conflict-
 * resolution rules.
 */

(function (global) {
  'use strict';

  const DB_NAME = 'spellbloc';
  const DB_VERSION = 1;
  const STORE_EVENTS = 'events';
  const STORE_OUTBOX = 'outbox';
  const STORE_KV = 'kv';

  const MIGRATION_FLAG_KEY = 'migrated_local_storage_v1';
  const DEVICE_ID_KEY = 'spellbloc_device_id';

  const LEGACY_KEYS = {
    age: 'spellbloc_age',
    totalStars: 'spellbloc_totalStars',
    playerLevel: 'spellbloc_playerLevel',
    language: 'spellbloc_language',
    gameMode: 'spellbloc_gameMode',
    analytics: 'spellbloc_analytics',
    accessibility: 'spellbloc_accessibility',
  };

  const EVENT_TYPES = new Set([
    'word_attempt',
    'session_end',
    'star_award',
    'achievement_trigger',
    'level_up',
    'settings_change',
  ]);

  const DEFAULT_SYNC_ENDPOINT = '/api/sync/events';
  const BACKGROUND_SYNC_TAG = 'spellbloc-outbox-sync';
  const MIN_RETRY_DELAY_MS = 5000;
  const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

  // ---------------------------------------------------------------------
  // Event log: creation, dedupe, and conflict resolution.
  // Pure functions — no IndexedDB/browser API involved — so they're
  // testable directly under Node (see tests/offline-store.test.js).
  // ---------------------------------------------------------------------

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback RFC4122-ish v4 for environments without crypto.randomUUID.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getClientId() {
    if (typeof localStorage === 'undefined') return 'unknown-device';
    try {
      let id = localStorage.getItem(DEVICE_ID_KEY);
      if (!id) {
        id = generateUUID();
        localStorage.setItem(DEVICE_ID_KEY, id);
      }
      return id;
    } catch (error) {
      return 'unknown-device';
    }
  }

  /**
   * Create an immutable progress/settings event. `type` must be one of
   * EVENT_TYPES. The event's `id` is the idempotency key used both for
   * local dedupe (reduceEvents) and, once #9 lands, server-side dedupe on
   * replay — a double flush of the same event must never double-count.
   */
  function createEvent(type, payload, options = {}) {
    if (!EVENT_TYPES.has(type)) {
      throw new Error(`Unknown offline event type: ${type}`);
    }
    return {
      id: options.id || generateUUID(),
      type,
      payload,
      clientId: options.clientId || getClientId(),
      childId: options.childId || null,
      createdAt: options.createdAt || Date.now(),
    };
  }

  /** Union of two (or more) event logs, deduped by id. This *is* the
   * multi-device merge: events are immutable and content-addressed by id,
   * so combining two devices' logs is just a set union — feeding the
   * result through reduceEvents gives the reconciled snapshot. */
  function mergeEventLogs(...eventLists) {
    return dedupeById(eventLists.flat());
  }

  function dedupeById(events) {
    const byId = new Map();
    for (const event of events) {
      byId.set(event.id, event);
    }
    return Array.from(byId.values());
  }

  /**
   * Reduce an event log to a progress snapshot. Conflict-resolution rules
   * (see docs/OFFLINE_ARCHITECTURE.md):
   *  - star_award, word_attempt, session_end: additive/append-only —
   *    disjoint events are summed/collected. Dedup by id first so a
   *    replayed event is never double-counted.
   *  - level_up: monotonic high-water-mark — take the max across all
   *    events, order-independent.
   *  - achievement_trigger: idempotent set membership, keyed by
   *    achievementId — triggering the same achievement twice (same device
   *    or two devices) is a no-op.
   *  - settings_change: last-write-wins by event timestamp.
   */
  function reduceEvents(events) {
    const sorted = dedupeById(events).sort((a, b) => a.createdAt - b.createdAt);

    const snapshot = {
      totalStars: 0,
      playerLevel: 1,
      currentAge: null,
      language: null,
      gameMode: null,
      accessibility: null,
      achievements: [],
      sessions: [],
      wordAttempts: [],
    };
    const achievementIds = new Set();

    for (const event of sorted) {
      switch (event.type) {
        case 'star_award':
          snapshot.totalStars += event.payload.stars || 0;
          break;
        case 'level_up':
          snapshot.playerLevel = Math.max(snapshot.playerLevel, event.payload.level || 1);
          break;
        case 'settings_change':
          snapshot[event.payload.key] = event.payload.value;
          break;
        case 'achievement_trigger':
          achievementIds.add(event.payload.achievementId);
          break;
        case 'session_end':
          snapshot.sessions.push(event.payload);
          break;
        case 'word_attempt':
          snapshot.wordAttempts.push(event.payload);
          break;
        default:
          break;
      }
    }

    snapshot.achievements = Array.from(achievementIds);
    return snapshot;
  }

  // ---------------------------------------------------------------------
  // One-time migration from the legacy scattered localStorage keys.
  // Read-only with respect to localStorage: existing keys are never
  // modified or cleared, since game.js still reads/writes them directly
  // until issue #6 rewires the game loop onto this store.
  // ---------------------------------------------------------------------

  function readLegacyLocalStorage() {
    if (typeof localStorage === 'undefined') return null;

    const readJSON = (key) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    };

    return {
      age: parseInt(localStorage.getItem(LEGACY_KEYS.age), 10) || null,
      totalStars: parseInt(localStorage.getItem(LEGACY_KEYS.totalStars), 10) || null,
      playerLevel: parseInt(localStorage.getItem(LEGACY_KEYS.playerLevel), 10) || null,
      language: localStorage.getItem(LEGACY_KEYS.language) || null,
      gameMode: localStorage.getItem(LEGACY_KEYS.gameMode) || null,
      accessibility: readJSON(LEGACY_KEYS.accessibility),
      analyticsSessions: readJSON(LEGACY_KEYS.analytics),
    };
  }

  /** Synthesize the one-time migration event log from a legacy snapshot
   * (as returned by readLegacyLocalStorage). Each field becomes a single
   * lump-sum/LWW event rather than a per-unit event, so replaying the
   * migration never inflates totals. */
  function buildMigrationEvents(legacy, options = {}) {
    if (!legacy) return [];
    const baseOptions = { clientId: options.clientId, createdAt: options.createdAt || Date.now() };
    const events = [];

    if (Number.isFinite(legacy.totalStars) && legacy.totalStars > 0) {
      events.push(createEvent('star_award', { stars: legacy.totalStars, source: 'legacy-migration' }, baseOptions));
    }
    if (Number.isFinite(legacy.playerLevel) && legacy.playerLevel > 0) {
      events.push(createEvent('level_up', { level: legacy.playerLevel }, baseOptions));
    }
    if (Number.isFinite(legacy.age)) {
      events.push(createEvent('settings_change', { key: 'currentAge', value: legacy.age }, baseOptions));
    }
    if (legacy.language) {
      events.push(createEvent('settings_change', { key: 'language', value: legacy.language }, baseOptions));
    }
    if (legacy.gameMode) {
      events.push(createEvent('settings_change', { key: 'gameMode', value: legacy.gameMode }, baseOptions));
    }
    if (legacy.accessibility) {
      events.push(createEvent('settings_change', { key: 'accessibility', value: legacy.accessibility }, baseOptions));
    }
    if (Array.isArray(legacy.analyticsSessions)) {
      legacy.analyticsSessions.forEach((session) => {
        events.push(createEvent('session_end', session, baseOptions));
      });
    }

    return events;
  }

  // ---------------------------------------------------------------------
  // IndexedDB-backed store. Only instantiated/used in a browser context.
  // ---------------------------------------------------------------------

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  class OfflineStore {
    constructor({ dbName = DB_NAME, dbVersion = DB_VERSION } = {}) {
      this.dbName = dbName;
      this.dbVersion = dbVersion;
      this._dbPromise = null;
    }

    open() {
      if (this._dbPromise) return this._dbPromise;
      this._dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_EVENTS)) {
            db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
            db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains(STORE_KV)) {
            db.createObjectStore(STORE_KV, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this._dbPromise;
    }

    /** Append an event to both the durable event log and the sync outbox
     * in a single transaction. */
    async appendEvent(event) {
      const db = await this.open();
      const tx = db.transaction([STORE_EVENTS, STORE_OUTBOX], 'readwrite');
      tx.objectStore(STORE_EVENTS).put(event);
      tx.objectStore(STORE_OUTBOX).put(event);
      return txDone(tx);
    }

    async getAllEvents() {
      const db = await this.open();
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      return requestToPromise(tx.objectStore(STORE_EVENTS).getAll());
    }

    async getOutboxEvents() {
      const db = await this.open();
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      return requestToPromise(tx.objectStore(STORE_OUTBOX).getAll());
    }

    async removeFromOutbox(ids) {
      const db = await this.open();
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);
      ids.forEach((id) => store.delete(id));
      return txDone(tx);
    }

    async getSnapshot() {
      return reduceEvents(await this.getAllEvents());
    }

    async getKV(key) {
      const db = await this.open();
      const tx = db.transaction(STORE_KV, 'readonly');
      const record = await requestToPromise(tx.objectStore(STORE_KV).get(key));
      return record ? record.value : undefined;
    }

    async setKV(key, value) {
      const db = await this.open();
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put({ key, value });
      return txDone(tx);
    }

    /** One-time copy of the legacy localStorage state into the event log.
     * Safe to call on every load: no-ops once MIGRATION_FLAG_KEY is set. */
    async migrateFromLocalStorage() {
      const already = await this.getKV(MIGRATION_FLAG_KEY);
      if (already) return { migrated: false, reason: 'already-migrated' };

      const legacy = readLegacyLocalStorage();
      if (!legacy) return { migrated: false, reason: 'no-localStorage' };

      const events = buildMigrationEvents(legacy, { clientId: getClientId() });
      for (const event of events) {
        await this.appendEvent(event);
      }
      await this.setKV(MIGRATION_FLAG_KEY, true);
      return { migrated: true, eventCount: events.length };
    }
  }

  // ---------------------------------------------------------------------
  // Sync outbox: flushes pending events to the server ingestion endpoint
  // (tracked in issue #9 — until it exists, flush() will simply fail and
  // retry with backoff, which is expected/harmless).
  // ---------------------------------------------------------------------

  class SyncOutbox {
    constructor(store, options = {}) {
      this.store = store;
      this.endpoint = options.endpoint || DEFAULT_SYNC_ENDPOINT;
      this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(global) : null);
      this._retryDelay = MIN_RETRY_DELAY_MS;
      this._retryTimer = null;
      this._flushing = false;
    }

    /** Wire up the online-event fallback and attempt a Background Sync
     * registration, then try an immediate flush. */
    start() {
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this.flush());
      }
      this._registerBackgroundSync();
      this.flush();
    }

    async _registerBackgroundSync() {
      try {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        const registration = await navigator.serviceWorker.ready;
        if (registration.sync) {
          await registration.sync.register(BACKGROUND_SYNC_TAG);
        }
      } catch (error) {
        // Background Sync unsupported/unavailable — the online-event
        // fallback in start() still covers this device.
        console.warn('SpellBloc: background sync registration skipped', error);
      }
    }

    async flush() {
      if (this._flushing || !this.fetchImpl) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      this._flushing = true;
      try {
        const pending = await this.store.getOutboxEvents();
        if (pending.length === 0) {
          this._retryDelay = MIN_RETRY_DELAY_MS;
          return;
        }

        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: pending }),
        });

        if (!response.ok) {
          throw new Error(`Sync endpoint responded with ${response.status}`);
        }

        await this.store.removeFromOutbox(pending.map((event) => event.id));
        this._retryDelay = MIN_RETRY_DELAY_MS;
      } catch (error) {
        console.warn('SpellBloc: outbox flush failed, will retry', error);
        this._scheduleRetry();
      } finally {
        this._flushing = false;
      }
    }

    _scheduleRetry() {
      if (this._retryTimer) return;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this._retryDelay = Math.min(this._retryDelay * 2, MAX_RETRY_DELAY_MS);
        this.flush();
      }, this._retryDelay);
    }
  }

  // ---------------------------------------------------------------------
  // Auto-init: opens the store, runs the one-time migration, and starts
  // the sync outbox. Runs independently of game.js — it does not read
  // from or write to any of the variables/DOM game.js manages, so it
  // cannot change current gameplay behavior.
  // ---------------------------------------------------------------------

  async function initSpellBlocOffline(options = {}) {
    const store = new OfflineStore(options.storeOptions);
    await store.migrateFromLocalStorage();
    const outbox = new SyncOutbox(store, options.outboxOptions);
    outbox.start();
    return { store, outbox };
  }

  if (typeof document !== 'undefined' && typeof indexedDB !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      initSpellBlocOffline()
        .then((instance) => {
          // Exposed for issue #6's game-loop integration and for debugging.
          global.spellBlocOffline = instance;
        })
        .catch((error) => {
          console.warn('SpellBloc: offline store init failed', error);
        });
    });
  }

  const api = {
    createEvent,
    dedupeById,
    mergeEventLogs,
    reduceEvents,
    readLegacyLocalStorage,
    buildMigrationEvents,
    OfflineStore,
    SyncOutbox,
    initSpellBlocOffline,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.SpellBlocOfflineStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
