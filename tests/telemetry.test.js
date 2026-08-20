/**
 * Fixture-driven tests for unified gameplay telemetry (issue #27).
 * Covers report aggregation, session boundaries, achievements fields,
 * legacy/corrupt migration, and multi-child isolation.
 * Pure Node — no browser, no IndexedDB.
 */

const {
  TelemetryService,
  LearningAnalytics,
  wordIdOf,
  SCHEMA_VERSION,
  STORAGE_KEY,
} = require('../telemetry.js');

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  }

  assertDeepEqual(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error(`${message}\nExpected: ${b}\nActual: ${a}`);
    }
  }

  assertTrue(condition, message) {
    if (!condition) {
      throw new Error(`${message}\nExpected true, got false`);
    }
  }

  assertFalse(condition, message) {
    if (condition) {
      throw new Error(`${message}\nExpected false, got true`);
    }
  }

  async run() {
    console.log('Running telemetry tests...\n');
    for (const test of this.tests) {
      try {
        await test.fn();
        this.passed++;
        console.log(`PASS ${test.name}`);
      } catch (error) {
        this.failed++;
        console.log(`FAIL ${test.name}`);
        console.log(`   ${error.message}`);
      }
    }
    console.log(`\nResults: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

class MemoryStorage {
  constructor(initial) {
    this.values = { ...(initial || {}) };
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
  }
  setItem(key, value) {
    this.values[key] = String(value);
  }
  removeItem(key) {
    delete this.values[key];
  }
}

function service(clock, storage) {
  let t = clock || 1_700_000_000_000;
  return new TelemetryService({
    storage: storage || new MemoryStorage(),
    now: () => t,
    _tick(ms) { t += ms; },
    get time() { return t; },
  });
}

function tickingService(start, storage) {
  let t = start || 1_700_000_000_000;
  const svc = new TelemetryService({
    storage: storage || new MemoryStorage(),
    now: () => t,
  });
  svc.advance = (ms) => { t += ms; };
  svc.time = () => t;
  return svc;
}

const runner = new TestRunner();

runner.test('recordAttempt writes the versioned schema fields', () => {
  const telemetry = tickingService();
  telemetry.startSession({ mode: 'classic', difficulty: 1 });
  const event = telemetry.recordAttempt({
    word: 'cat',
    category: 'animals',
    locale: 'en',
    correct: true,
    durationMs: 2500,
    hintCount: 1,
    mode: 'classic',
    difficulty: 1,
  });
  runner.assertEqual(event.schemaVersion, SCHEMA_VERSION, 'schemaVersion');
  runner.assertEqual(event.childId, 'default', 'childId');
  runner.assertEqual(event.word, 'cat', 'word');
  runner.assertEqual(event.category, 'animals', 'category');
  runner.assertEqual(event.locale, 'en', 'locale');
  runner.assertEqual(event.wordId, wordIdOf('en', 'animals', 'cat'), 'stable wordId');
  runner.assertEqual(event.correct, true, 'correct');
  runner.assertEqual(event.durationMs, 2500, 'durationMs');
  runner.assertEqual(event.hintCount, 1, 'hintCount');
  runner.assertEqual(event.mode, 'classic', 'mode');
  runner.assertTrue(typeof event.sessionId === 'string' && event.sessionId.length > 0, 'sessionId');
});

runner.test('report aggregation: accuracy, averageTime, wordsLearned, unique words', () => {
  const telemetry = tickingService();
  telemetry.startSession();
  telemetry.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 2000 });
  telemetry.recordAttempt({ word: 'dog', category: 'animals', correct: true, durationMs: 4000 });
  telemetry.recordAttempt({ word: 'cat', category: 'animals', correct: false, durationMs: 6000 });
  const report = telemetry.getProgressReport();
  runner.assertEqual(report.totalAttempts, 3, 'attempts');
  runner.assertEqual(report.accuracy, 67, '2/3 rounded');
  runner.assertEqual(report.averageTime, 4, 'mean duration seconds');
  runner.assertEqual(report.uniqueWordsLearned, 2, 'unique correct wordIds');
  runner.assertTrue(report.wordsLearned.length === 2, 'wordsLearned populated');
  runner.assertEqual(report.activePracticeTime, 12, 'sum of attempt durations in seconds');
  runner.assertTrue(typeof report.averageTime === 'number', 'averageTime present for RewardSystem');
});

runner.test('valid curriculum attempts never surface as unknown', () => {
  const telemetry = tickingService();
  telemetry.startSession();
  telemetry.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 1000 });
  telemetry.recordAttempt({ word: 'bat', category: 'animals', correct: false, durationMs: 1000 });
  telemetry.recordAttempt({ word: 'x', correct: false, durationMs: 1000 }); // missing category — skip, not "unknown"
  const weak = telemetry.identifyWeakAreas();
  const strong = telemetry.identifyStrongAreas();
  const names = weak.concat(strong).map((a) => a.category);
  runner.assertFalse(names.includes('unknown'), 'unknown must not appear');
  runner.assertEqual(names.join(','), 'animals', 'only stable curriculum id');
});

runner.test('second round creates a new session; leaving closes without double count', () => {
  const telemetry = tickingService();
  const first = telemetry.startSession({ mode: 'classic' });
  telemetry.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 1000 });
  telemetry.endSession();
  const second = telemetry.startSession({ mode: 'timed' });
  telemetry.recordAttempt({ word: 'dog', category: 'animals', correct: true, durationMs: 1000 });
  telemetry.endSession();
  runner.assertTrue(first.id !== second.id, 'distinct session ids');
  const child = telemetry.dumpChild();
  runner.assertEqual(child.sessions.length, 2, 'two closed sessions');
  runner.assertEqual(child.attempts.length, 2, 'two attempts, no double count');
  runner.assertEqual(telemetry.getProgressReport().totalSessions, 2, 'report session count');
  runner.assertEqual(telemetry.getProgressReport().totalAttempts, 2, 'report attempt count');
});

runner.test('reload recovers an open session without duplicating attempts', () => {
  const storage = new MemoryStorage();
  const t1 = tickingService(1_700_000_000_000, storage);
  t1.startSession();
  t1.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 1500 });
  runner.assertTrue(t1.getOpenSession() != null, 'session open before crash');

  const t2 = tickingService(1_700_000_010_000, storage);
  runner.assertEqual(t2.getOpenSession(), null, 'recovered session is closed');
  const report = t2.getProgressReport();
  runner.assertEqual(report.totalAttempts, 1, 'attempt survived reload');
  runner.assertEqual(report.totalSessions, 1, 'single recovered session');
  runner.assertTrue(t2.dumpChild().sessions[0].recovered, 'recovered flag set');
});

runner.test('switching children isolates histories', () => {
  const telemetry = tickingService();
  telemetry.startSession();
  telemetry.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 1000 });
  const childB = telemetry.createChild('Sam');
  telemetry.setActiveChild(childB, { name: 'Sam' });
  telemetry.startSession();
  telemetry.recordAttempt({ word: 'up', category: 'vowels', correct: false, durationMs: 3000 });
  const reportA = telemetry.getProgressReport('default');
  const reportB = telemetry.getProgressReport(childB);
  runner.assertEqual(reportA.totalAttempts, 1, 'child A attempts');
  runner.assertEqual(reportB.totalAttempts, 1, 'child B attempts');
  runner.assertEqual(reportA.uniqueWordsLearned, 1, 'A learned cat');
  runner.assertEqual(reportB.uniqueWordsLearned, 0, 'B has no correct words');
  runner.assertEqual(reportA.accuracy, 100, 'A accuracy isolated');
  runner.assertEqual(reportB.accuracy, 0, 'B accuracy isolated');
  const aCats = telemetry.dumpChild('default').attempts.map((a) => a.word).join(',');
  const bWords = telemetry.dumpChild(childB).attempts.map((a) => a.word).join(',');
  runner.assertEqual(aCats, 'cat', 'A events');
  runner.assertEqual(bWords, 'up', 'B events');
});

runner.test('legacy spellbloc_analytics migrates into v1 events', () => {
  const storage = new MemoryStorage({
    spellbloc_analytics: JSON.stringify([
      {
        startTime: 1000,
        endTime: 5000,
        totalTime: 4000,
        attempts: [
          { correct: true, time: 2, timestamp: 2000, category: 'animals', word: 'cat' },
          { correct: false, time: 3, timestamp: 3000, category: 'animals', word: 'dog' },
        ],
      },
    ]),
  });
  const telemetry = new TelemetryService({ storage, now: () => 9000 });
  const report = telemetry.getProgressReport();
  runner.assertEqual(report.totalAttempts, 2, 'migrated attempts');
  runner.assertEqual(report.accuracy, 50, 'migrated accuracy');
  runner.assertEqual(report.uniqueWordsLearned, 1, 'migrated wordsLearned');
  runner.assertFalse(telemetry.identifyWeakAreas().some((a) => a.category === 'unknown'), 'migrated categories stay stable');
});

runner.test('malformed local data is quarantined and does not crash startup', () => {
  const storage = new MemoryStorage({
    [STORAGE_KEY]: '{not json',
    spellbloc_analytics: '!!!',
  });
  let telemetry;
  try {
    telemetry = new TelemetryService({ storage, now: () => 1 });
  } catch (e) {
    throw new Error('constructor threw: ' + e.message);
  }
  const report = telemetry.getProgressReport();
  runner.assertEqual(report.totalAttempts, 0, 'empty after quarantine');
  runner.assertEqual(report.accuracy, 0, 'safe zeros');
  const quarantined = Object.keys(storage.values).some((k) => k.indexOf('spellbloc_telemetry_corrupt_') === 0);
  runner.assertTrue(quarantined, 'corrupt payload copied aside');
});

runner.test('LearningAnalytics wrapper matches RewardSystem stats shape', () => {
  const telemetry = tickingService();
  const analytics = new LearningAnalytics(telemetry, 'default');
  analytics.startSession();
  analytics.recordAttempt({ word: 'a', category: 'vowels', correct: true, time: 2 });
  analytics.recordAttempt({ word: 'e', category: 'vowels', correct: true, time: 4 });
  analytics.endSession();
  const stats = analytics.getProgressReport();
  runner.assertTrue(typeof stats.averageTime === 'number', 'averageTime for speed_demon');
  runner.assertTrue(stats.averageTime < 5, 'speed_demon condition can fire');
  runner.assertTrue(stats.totalAttempts >= 1, 'first_word condition');
  runner.assertTrue(Array.isArray(stats.wordsLearned) && stats.wordsLearned.length > 0, 'wordsLearned populated');
  runner.assertEqual(stats.totalSessions, 1, 'sessions counted');
});

runner.test('two-round e2e with reload and two child profiles', () => {
  const storage = new MemoryStorage();
  const t1 = tickingService(1_700_000_000_000, storage);
  t1.startSession({ mode: 'classic' });
  t1.recordAttempt({ word: 'cat', category: 'animals', correct: true, durationMs: 2000 });
  t1.endSession();
  t1.startSession({ mode: 'classic' });
  t1.recordAttempt({ word: 'dog', category: 'animals', correct: false, durationMs: 8000 });
  // crash mid-round (no endSession)
  const sibling = t1.createChild('Alex');
  t1.setActiveChild(sibling);
  t1.startSession();
  t1.recordAttempt({ word: 'up', category: 'vowels', correct: true, durationMs: 1000 });
  t1.endSession();

  const t2 = tickingService(1_700_000_100_000, storage);
  const defaultReport = t2.getProgressReport('default');
  const alexReport = t2.getProgressReport(sibling);
  runner.assertEqual(defaultReport.totalSessions, 2, 'default two rounds after recovery');
  runner.assertEqual(defaultReport.totalAttempts, 2, 'default attempts intact');
  runner.assertEqual(alexReport.totalAttempts, 1, 'Alex isolated after reload');
  runner.assertEqual(defaultReport.uniqueWordsLearned, 1, 'default learned cat only');
  runner.assertEqual(alexReport.uniqueWordsLearned, 1, 'Alex learned up');
});

runner.run().then((ok) => {
  if (!ok) process.exit(1);
});
