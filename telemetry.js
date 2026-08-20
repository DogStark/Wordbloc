/**
 * Unified gameplay telemetry (issue #27).
 *
 * Single source of truth for attempts + sessions. Parent reports, rewards,
 * and AI history all derive from this event stream.
 *
 * Schema v1 attempt: childId, wordId, word, locale, category, timestamps,
 * durationMs, correct, hintCount, mode, difficulty, schemaVersion.
 */

(function (global) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'spellbloc_telemetry_v1';
  const ACTIVE_CHILD_KEY = 'spellbloc_active_child';
  const MIGRATION_FLAG = 'spellbloc_telemetry_migrated_v1';
  const QUARANTINE_PREFIX = 'spellbloc_telemetry_corrupt_';
  const LEGACY_ANALYTICS_KEY = 'spellbloc_analytics';
  const LEGACY_AI_KEY = 'spellbloc_ai_performance';
  const DEFAULT_CHILD_ID = 'default';

  const METRICS = Object.freeze({
    uniqueWordsLearned: 'Count of distinct wordIds with at least one correct attempt',
    attempts: 'Count of recorded attempt events',
    accuracy: 'correctAttempts / totalAttempts * 100, rounded',
    averageTime: 'Mean attempt duration in seconds',
    activePracticeTime: 'Sum of attempt durationMs, in seconds',
    streak: 'Consecutive calendar days (UTC) with at least one closed or open session',
    averageSessionTime: 'Mean closed-session duration in seconds',
  });

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getStorage(explicit) {
    if (explicit) return explicit;
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) {
      /* private mode */
    }
    return memoryStorage();
  }

  function memoryStorage() {
    const values = {};
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      setItem(key, value) {
        values[key] = String(value);
      },
      removeItem(key) {
        delete values[key];
      },
    };
  }

  function wordIdOf(locale, category, word) {
    return [locale || 'en', category || '', String(word || '').toLowerCase()].join(':');
  }

  function utcDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  function emptyChild(id) {
    return {
      id,
      name: id === DEFAULT_CHILD_ID ? 'Player' : id,
      attempts: [],
      sessions: [],
    };
  }

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      activeChildId: DEFAULT_CHILD_ID,
      children: { [DEFAULT_CHILD_ID]: emptyChild(DEFAULT_CHILD_ID) },
    };
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function sanitizeAttempt(raw, childId) {
    if (!isObject(raw)) return null;
    const word = typeof raw.word === 'string' ? raw.word : '';
    const category = typeof raw.category === 'string' && raw.category.trim()
      ? raw.category.trim()
      : '';
    const locale = typeof raw.locale === 'string' && raw.locale ? raw.locale : 'en';
    const durationMs = Number(raw.durationMs != null ? raw.durationMs : raw.timeSpent != null ? raw.timeSpent : (typeof raw.time === 'number' ? raw.time * 1000 : 0));
    return {
      schemaVersion: SCHEMA_VERSION,
      type: 'attempt',
      id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
      childId: raw.childId || childId || DEFAULT_CHILD_ID,
      wordId: raw.wordId || wordIdOf(locale, category, word),
      word,
      locale,
      category,
      timestamp: Number(raw.timestamp) || Date.now(),
      durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
      correct: Boolean(raw.correct),
      hintCount: Number(raw.hintCount) || 0,
      mode: typeof raw.mode === 'string' ? raw.mode : 'classic',
      difficulty: raw.difficulty == null || Number.isNaN(Number(raw.difficulty)) ? null : Number(raw.difficulty),
      sessionId: raw.sessionId || null,
    };
  }

  function sanitizeSession(raw, childId) {
    if (!isObject(raw)) return null;
    return {
      schemaVersion: SCHEMA_VERSION,
      type: 'session',
      id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
      childId: raw.childId || childId || DEFAULT_CHILD_ID,
      startedAt: Number(raw.startedAt || raw.startTime) || Date.now(),
      endedAt: raw.endedAt || raw.endTime ? Number(raw.endedAt || raw.endTime) : null,
      recovered: Boolean(raw.recovered),
      mode: typeof raw.mode === 'string' ? raw.mode : 'classic',
      difficulty: raw.difficulty == null ? null : Number(raw.difficulty),
      status: raw.status === 'open' || raw.endedAt == null && raw.endTime == null ? (raw.status || 'open') : 'closed',
    };
  }

  class TelemetryService {
    constructor(options = {}) {
      this.storage = getStorage(options.storage);
      this.now = typeof options.now === 'function' ? options.now : () => Date.now();
      this.state = emptyState();
      this.currentHintCount = 0;
      this.load();
    }

    load() {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = this._parseOrQuarantine(STORAGE_KEY, raw);
        if (parsed && isObject(parsed) && isObject(parsed.children)) {
          this.state = this._rehydrate(parsed);
        } else if (parsed === null) {
          this.state = emptyState();
        }
      }
      this._ensureChild(this.state.activeChildId || DEFAULT_CHILD_ID);
      this.migrateLegacy();
      this.recoverOpenSession();
    }

    _parseOrQuarantine(key, raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        try {
          this.storage.setItem(QUARANTINE_PREFIX + this.now(), raw);
        } catch (ignore) { /* quota */ }
        return null;
      }
    }

    _rehydrate(parsed) {
      const state = emptyState();
      state.activeChildId = parsed.activeChildId || DEFAULT_CHILD_ID;
      const children = parsed.children || {};
      Object.keys(children).forEach((id) => {
        const src = children[id] || {};
        const child = emptyChild(id);
        child.name = src.name || child.name;
        child.attempts = Array.isArray(src.attempts)
          ? src.attempts.map((a) => sanitizeAttempt(a, id)).filter(Boolean)
          : [];
        child.sessions = Array.isArray(src.sessions)
          ? src.sessions.map((s) => sanitizeSession(s, id)).filter(Boolean)
          : [];
        state.children[id] = child;
      });
      this._ensureChild.call({ state }, state.activeChildId);
      return state;
    }

    _ensureChild(childId) {
      const id = childId || DEFAULT_CHILD_ID;
      if (!this.state.children[id]) {
        this.state.children[id] = emptyChild(id);
      }
      return this.state.children[id];
    }

    persist() {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        this.storage.setItem(ACTIVE_CHILD_KEY, this.state.activeChildId);
        // Mirror closed-session shape for offline-store / legacy readers.
        const child = this._ensureChild(this.state.activeChildId);
        const legacy = child.sessions.map((session) => ({
          startTime: session.startedAt,
          endTime: session.endedAt,
          totalTime: session.endedAt ? session.endedAt - session.startedAt : 0,
          wordsLearned: this._wordsLearnedForSession(child, session),
          attempts: child.attempts
            .filter((a) => a.sessionId === session.id)
            .map((a) => ({
              correct: a.correct,
              time: a.durationMs / 1000,
              timestamp: a.timestamp,
              category: a.category,
              word: a.word,
            })),
        }));
        this.storage.setItem(LEGACY_ANALYTICS_KEY, JSON.stringify(legacy));
      } catch (e) {
        /* quota / private mode — keep in-memory */
      }
    }

    _wordsLearnedForSession(child, session) {
      const seen = new Set();
      child.attempts.forEach((a) => {
        if (a.sessionId === session.id && a.correct && a.word) seen.add(a.word);
      });
      return Array.from(seen);
    }

    migrateLegacy() {
      if (this.storage.getItem(MIGRATION_FLAG) === '1') return;

      const child = this._ensureChild(this.state.activeChildId);
      const alreadyHas = child.attempts.length > 0;

      const legacySessions = this._parseOrQuarantine(
        LEGACY_ANALYTICS_KEY,
        this.storage.getItem(LEGACY_ANALYTICS_KEY)
      );
      const legacyAi = this._parseOrQuarantine(
        LEGACY_AI_KEY,
        this.storage.getItem(LEGACY_AI_KEY)
      );

      if (!alreadyHas && Array.isArray(legacySessions)) {
        legacySessions.forEach((session) => {
          const s = sanitizeSession({
            startTime: session.startTime,
            endTime: session.endTime,
            status: session.endTime ? 'closed' : 'closed',
          }, child.id);
          if (s.endedAt == null) s.endedAt = s.startedAt;
          s.status = 'closed';
          child.sessions.push(s);
          const attempts = Array.isArray(session.attempts) ? session.attempts : [];
          attempts.forEach((a) => {
            const event = sanitizeAttempt({
              correct: a.correct,
              time: a.time,
              timestamp: a.timestamp,
              category: a.category,
              word: a.word,
              sessionId: s.id,
            }, child.id);
            if (event) child.attempts.push(event);
          });
        });
      }

      if (!alreadyHas && child.attempts.length === 0 && Array.isArray(legacyAi)) {
        const s = sanitizeSession({
          startedAt: legacyAi[0] && legacyAi[0].timestamp,
          endedAt: this.now(),
          status: 'closed',
          recovered: true,
        }, child.id);
        child.sessions.push(s);
        legacyAi.forEach((a) => {
          const event = sanitizeAttempt({
            word: a.word,
            correct: a.correct,
            timeSpent: a.timeSpent,
            category: a.category,
            timestamp: a.timestamp,
            sessionId: s.id,
          }, child.id);
          if (event) child.attempts.push(event);
        });
      }

      this.storage.setItem(MIGRATION_FLAG, '1');
      this.persist();
    }

    getActiveChildId() {
      return this.state.activeChildId || DEFAULT_CHILD_ID;
    }

    setActiveChild(childId, meta) {
      const id = childId || DEFAULT_CHILD_ID;
      if (id !== this.state.activeChildId) {
        this.endSession({ reason: 'switch-child' });
      }
      const child = this._ensureChild(id);
      if (meta && meta.name) child.name = meta.name;
      this.state.activeChildId = id;
      this.currentHintCount = 0;
      this.persist();
      return id;
    }

    createChild(name, extra) {
      const id = generateId();
      const child = emptyChild(id);
      child.name = name || 'Child';
      if (extra) Object.assign(child, extra);
      this.state.children[id] = child;
      this.persist();
      return id;
    }

    listChildren() {
      return Object.keys(this.state.children).map((id) => ({
        id,
        name: this.state.children[id].name,
      }));
    }

    recoverOpenSession() {
      const child = this._ensureChild(this.getActiveChildId());
      let changed = false;
      child.sessions.forEach((session) => {
        if (session.status === 'open' || session.endedAt == null) {
          const last = child.attempts
            .filter((a) => a.sessionId === session.id)
            .reduce((max, a) => (a.timestamp > max ? a.timestamp : max), session.startedAt);
          session.endedAt = last || this.now();
          session.status = 'closed';
          session.recovered = true;
          changed = true;
        }
      });
      if (changed) this.persist();
    }

    startSession(opts) {
      const options = opts || {};
      this.endSession({ reason: 'new-session' });
      const child = this._ensureChild(this.getActiveChildId());
      const session = {
        schemaVersion: SCHEMA_VERSION,
        type: 'session',
        id: generateId(),
        childId: child.id,
        startedAt: this.now(),
        endedAt: null,
        recovered: false,
        mode: options.mode || 'classic',
        difficulty: options.difficulty == null ? null : Number(options.difficulty),
        status: 'open',
      };
      child.sessions.push(session);
      this.currentHintCount = 0;
      this.persist();
      return session;
    }

    getOpenSession(childId) {
      const child = this._ensureChild(childId || this.getActiveChildId());
      for (let i = child.sessions.length - 1; i >= 0; i--) {
        if (child.sessions[i].status === 'open' && child.sessions[i].endedAt == null) {
          return child.sessions[i];
        }
      }
      return null;
    }

    endSession(opts) {
      const session = this.getOpenSession();
      if (!session) return null;
      session.endedAt = this.now();
      session.status = 'closed';
      if (opts && opts.recovered) session.recovered = true;
      this.persist();
      return session;
    }

    recordHint() {
      this.currentHintCount += 1;
      return this.currentHintCount;
    }

    resetHints() {
      this.currentHintCount = 0;
    }

    recordAttempt(input) {
      const child = this._ensureChild(input && input.childId ? input.childId : this.getActiveChildId());
      let session = this.getOpenSession(child.id);
      if (!session) session = this.startSession({ mode: input && input.mode });
      const event = sanitizeAttempt({
        ...(input || {}),
        childId: child.id,
        sessionId: session.id,
        hintCount: input && input.hintCount != null ? input.hintCount : this.currentHintCount,
        timestamp: (input && input.timestamp) || this.now(),
      }, child.id);
      child.attempts.push(event);
      this.currentHintCount = 0;
      this.persist();
      return event;
    }

    forChild(childId) {
      return new LearningAnalytics(this, childId || this.getActiveChildId());
    }

    get learningAnalytics() {
      return this.forChild(this.getActiveChildId());
    }

    getProgressReport(childId, timeframe) {
      const child = this._ensureChild(childId || this.getActiveChildId());
      const attempts = this._filterAttempts(child, timeframe);
      const sessions = this._filterSessions(child, timeframe);
      const totalAttempts = attempts.length;
      const correctAttempts = attempts.filter((a) => a.correct).length;
      const accuracy = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : 0;
      const durationSum = attempts.reduce((sum, a) => sum + a.durationMs, 0);
      const averageTime = totalAttempts > 0 ? durationSum / totalAttempts / 1000 : 0;
      const closed = sessions.filter((s) => s.endedAt);
      const averageSessionTime = closed.length > 0
        ? Math.round(closed.reduce((sum, s) => sum + (s.endedAt - s.startedAt), 0) / closed.length / 1000)
        : 0;
      const words = new Set();
      attempts.forEach((a) => {
        if (a.correct && a.word) words.add(a.wordId || a.word);
      });
      return {
        totalSessions: sessions.length,
        totalAttempts,
        accuracy,
        averageTime,
        averageSessionTime,
        wordsLearned: Array.from(words),
        uniqueWordsLearned: words.size,
        activePracticeTime: Math.round(durationSum / 1000),
        streak: this._streak(child),
        weakAreas: this.identifyWeakAreas(childId, timeframe),
        strongAreas: this.identifyStrongAreas(childId, timeframe),
      };
    }

    _filterAttempts(child, timeframe) {
      const since = this._since(timeframe);
      return child.attempts.filter((a) => (since == null ? true : a.timestamp >= since));
    }

    _filterSessions(child, timeframe) {
      const since = this._since(timeframe);
      return child.sessions.filter((s) => (since == null ? true : s.startedAt >= since));
    }

    _since(timeframe) {
      if (!timeframe || timeframe === 'all') return null;
      const now = this.now();
      if (timeframe === 'week') return now - 7 * 24 * 60 * 60 * 1000;
      if (timeframe === 'month') return now - 30 * 24 * 60 * 60 * 1000;
      if (typeof timeframe === 'number') return timeframe;
      return null;
    }

    _categoryStats(childId, timeframe) {
      const child = this._ensureChild(childId || this.getActiveChildId());
      const stats = {};
      this._filterAttempts(child, timeframe).forEach((attempt) => {
        if (!attempt.category) return; // skip uncategorized; never emit 'unknown' for valid curriculum
        if (!stats[attempt.category]) stats[attempt.category] = { correct: 0, total: 0 };
        stats[attempt.category].total += 1;
        if (attempt.correct) stats[attempt.category].correct += 1;
      });
      return Object.entries(stats).map(([category, perf]) => ({
        category,
        accuracy: (perf.correct / perf.total) * 100,
      }));
    }

    identifyWeakAreas(childId, timeframe) {
      return this._categoryStats(childId, timeframe)
        .filter((item) => item.accuracy < 70)
        .sort((a, b) => a.accuracy - b.accuracy);
    }

    identifyStrongAreas(childId, timeframe) {
      return this._categoryStats(childId, timeframe)
        .filter((item) => item.accuracy >= 80)
        .sort((a, b) => b.accuracy - a.accuracy);
    }

    _streak(child) {
      const days = new Set();
      child.sessions.forEach((s) => days.add(utcDay(s.startedAt)));
      child.attempts.forEach((a) => days.add(utcDay(a.timestamp)));
      if (days.size === 0) return 0;
      let cursor = utcDay(this.now());
      let streak = 0;
      const sorted = Array.from(days).sort();
      const has = new Set(sorted);
      // allow yesterday as start if today has no activity yet
      if (!has.has(cursor)) {
        const y = utcDay(this.now() - 24 * 60 * 60 * 1000);
        if (!has.has(y)) return 0;
        cursor = y;
      }
      while (has.has(cursor)) {
        streak += 1;
        const d = new Date(cursor + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        cursor = d.toISOString().slice(0, 10);
      }
      return streak;
    }

    dumpChild(childId) {
      return this._ensureChild(childId || this.getActiveChildId());
    }
  }

  class LearningAnalytics {
    constructor(service, childId) {
      const globalService = (typeof globalThis !== 'undefined' && globalThis.telemetry)
        || (typeof window !== 'undefined' && window.telemetry)
        || null;
      this.service = service || globalService || new TelemetryService();
      this.childId = childId || this.service.getActiveChildId();
    }

    get sessions() {
      return this.service.dumpChild(this.childId).sessions;
    }

    get currentSession() {
      return this.service.getOpenSession(this.childId);
    }

    startSession(opts) {
      if (this.childId && this.childId !== this.service.getActiveChildId()) {
        this.service.setActiveChild(this.childId);
      }
      return this.service.startSession(opts);
    }

    endSession() {
      return this.service.endSession();
    }

    recordAttempt(attempt) {
      return this.service.recordAttempt({ ...(attempt || {}), childId: this.childId });
    }

    getProgressReport(timeframe) {
      return this.service.getProgressReport(this.childId, timeframe);
    }

    identifyWeakAreas() {
      return this.service.identifyWeakAreas(this.childId);
    }

    identifyStrongAreas() {
      return this.service.identifyStrongAreas(this.childId);
    }

    saveAnalytics() {
      this.service.persist();
    }

    loadAnalytics() {
      this.service.load();
    }
  }

  const api = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    METRICS,
    wordIdOf,
    sanitizeAttempt,
    TelemetryService,
    LearningAnalytics,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  global.SpellBlocTelemetry = api;
  global.TelemetryService = TelemetryService;
  global.LearningAnalytics = LearningAnalytics;
  if (!global.telemetry) {
    global.telemetry = new TelemetryService();
  }
})(typeof window !== 'undefined' ? window : globalThis);
