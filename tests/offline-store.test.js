/**
 * Unit Tests for the Offline-First Persistence Layer (issue #12)
 * Tests event creation, dedupe, conflict-resolution reduction, and the
 * two-device merge scenario. Pure logic only — no IndexedDB/browser APIs
 * involved, so this runs directly under Node.
 */

const {
  createEvent,
  dedupeById,
  mergeEventLogs,
  reduceEvents,
  buildMigrationEvents,
} = require('../offline-store.js');

// Simple test framework (same convention as tests/srs-engine.test.js)
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

  async run() {
    console.log('🧪 Running Offline Store Tests...\n');

    for (const test of this.tests) {
      try {
        await test.fn();
        this.passed++;
        console.log(`✅ ${test.name}`);
      } catch (error) {
        this.failed++;
        console.log(`❌ ${test.name}`);
        console.log(`   Error: ${error.message}`);
      }
    }

    console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

const runner = new TestRunner();

// ---- createEvent ----

runner.test('createEvent produces a UUID id, timestamp, and clientId', () => {
  const event = createEvent('star_award', { stars: 3 }, { clientId: 'device-a' });
  runner.assertEqual(event.type, 'star_award', 'type should be preserved');
  runner.assertDeepEqual(event.payload, { stars: 3 }, 'payload should be preserved');
  runner.assertEqual(event.clientId, 'device-a', 'clientId should be preserved');
  runner.assertTrue(typeof event.id === 'string' && event.id.length > 0, 'id should be a non-empty string');
  runner.assertTrue(typeof event.createdAt === 'number', 'createdAt should be a number');
});

runner.test('createEvent rejects unknown event types', () => {
  let threw = false;
  try {
    createEvent('not_a_real_type', {});
  } catch (error) {
    threw = true;
  }
  runner.assertTrue(threw, 'should throw for an unknown event type');
});

// ---- dedupeById ----

runner.test('dedupeById collapses events with the same id', () => {
  const event = createEvent('star_award', { stars: 5 }, { id: 'evt-1' });
  const result = dedupeById([event, event, { ...event }]);
  runner.assertEqual(result.length, 1, 'duplicate ids should collapse to one event');
});

runner.test('dedupeById keeps distinct ids', () => {
  const a = createEvent('star_award', { stars: 5 }, { id: 'evt-1' });
  const b = createEvent('star_award', { stars: 3 }, { id: 'evt-2' });
  const result = dedupeById([a, b]);
  runner.assertEqual(result.length, 2, 'distinct ids should both be kept');
});

// ---- reduceEvents: conflict resolution rules ----

runner.test('star_award events sum across disjoint events', () => {
  const events = [
    createEvent('star_award', { stars: 5 }, { id: 'e1', createdAt: 100 }),
    createEvent('star_award', { stars: 3 }, { id: 'e2', createdAt: 200 }),
  ];
  const snapshot = reduceEvents(events);
  runner.assertEqual(snapshot.totalStars, 8, 'totalStars should be the sum of disjoint star_award events');
});

runner.test('a replayed (duplicate id) star_award event is not double-counted', () => {
  const event = createEvent('star_award', { stars: 5 }, { id: 'e1', createdAt: 100 });
  // Simulates a double-flush / resync delivering the same event twice.
  const snapshot = reduceEvents([event, event]);
  runner.assertEqual(snapshot.totalStars, 5, 'duplicate event id must not double-award stars');
});

runner.test('level_up takes the max across events regardless of array order', () => {
  const events = [
    createEvent('level_up', { level: 2 }, { id: 'e1', createdAt: 300 }),
    createEvent('level_up', { level: 5 }, { id: 'e2', createdAt: 100 }),
    createEvent('level_up', { level: 1 }, { id: 'e3', createdAt: 200 }),
  ];
  const snapshot = reduceEvents(events);
  runner.assertEqual(snapshot.playerLevel, 5, 'playerLevel should be the max level_up payload');
});

runner.test('settings_change is last-write-wins by createdAt, not array order', () => {
  const older = createEvent('settings_change', { key: 'currentAge', value: 3 }, { id: 'e1', createdAt: 100 });
  const newer = createEvent('settings_change', { key: 'currentAge', value: 5 }, { id: 'e2', createdAt: 200 });
  // Fed in reverse chronological order to prove sorting drives the result.
  const snapshot = reduceEvents([newer, older]);
  runner.assertEqual(snapshot.currentAge, 5, 'the most recent settings_change by timestamp should win');
});

runner.test('achievement_trigger is deduped by achievementId (idempotent award)', () => {
  const events = [
    createEvent('achievement_trigger', { achievementId: 'first-word' }, { id: 'e1', createdAt: 100 }),
    createEvent('achievement_trigger', { achievementId: 'first-word' }, { id: 'e2', createdAt: 200 }),
    createEvent('achievement_trigger', { achievementId: 'ten-words' }, { id: 'e3', createdAt: 300 }),
  ];
  const snapshot = reduceEvents(events);
  runner.assertEqual(snapshot.achievements.length, 2, 'achievement set should not duplicate the same achievementId');
  runner.assertTrue(snapshot.achievements.includes('first-word'), 'first-word achievement should be present');
  runner.assertTrue(snapshot.achievements.includes('ten-words'), 'ten-words achievement should be present');
});

runner.test('word_attempt and session_end events are collected into the snapshot', () => {
  const events = [
    createEvent('word_attempt', { word: 'cat', correct: true }, { id: 'e1', createdAt: 100 }),
    createEvent('session_end', { durationMs: 60000 }, { id: 'e2', createdAt: 200 }),
  ];
  const snapshot = reduceEvents(events);
  runner.assertEqual(snapshot.wordAttempts.length, 1, 'word_attempt should be collected');
  runner.assertEqual(snapshot.sessions.length, 1, 'session_end should be collected');
});

// ---- mergeEventLogs: two-device conflict resolution scenario ----

runner.test('two devices merge to the correct combined snapshot (no double count)', () => {
  const shared = createEvent('star_award', { stars: 5 }, { id: 'shared-1', createdAt: 100, clientId: 'device-a' });

  // Device A: earns the shared event, then changes a setting.
  const deviceA = [
    shared,
    createEvent('settings_change', { key: 'currentAge', value: 4 }, { id: 'a-2', createdAt: 150, clientId: 'device-a' }),
  ];

  // Device B: has synced the shared event (e.g. pulled from the server)
  // and additionally earned its own, distinct star award.
  const deviceB = [
    shared,
    createEvent('star_award', { stars: 3 }, { id: 'b-1', createdAt: 120, clientId: 'device-b' }),
  ];

  const merged = mergeEventLogs(deviceA, deviceB);
  const snapshot = reduceEvents(merged);

  runner.assertEqual(snapshot.totalStars, 8, 'shared event must count once; combined with device B\'s own event, total is 5 + 3');
  runner.assertEqual(snapshot.currentAge, 4, 'device A\'s setting change should carry through the merge');
});

// ---- buildMigrationEvents ----

runner.test('buildMigrationEvents synthesizes a single lump-sum star_award, not per-unit events', () => {
  const events = buildMigrationEvents({ totalStars: 12, playerLevel: 3, age: 5, language: null, gameMode: null, accessibility: null, analyticsSessions: null });
  const starEvents = events.filter((e) => e.type === 'star_award');
  runner.assertEqual(starEvents.length, 1, 'exactly one star_award event should be synthesized');
  runner.assertEqual(starEvents[0].payload.stars, 12, 'the lump-sum should equal the legacy total');

  const snapshot = reduceEvents(events);
  runner.assertEqual(snapshot.totalStars, 12, 'reducing the migration events should reproduce the legacy total');
  runner.assertEqual(snapshot.playerLevel, 3, 'reducing the migration events should reproduce the legacy level');
  runner.assertEqual(snapshot.currentAge, 5, 'reducing the migration events should reproduce the legacy age');
});

runner.test('buildMigrationEvents skips absent fields without throwing', () => {
  const events = buildMigrationEvents({ totalStars: null, playerLevel: null, age: null, language: null, gameMode: null, accessibility: null, analyticsSessions: null });
  runner.assertEqual(events.length, 0, 'no events should be synthesized when there is no legacy data');
});

runner.test('buildMigrationEvents returns an empty array for a null legacy snapshot', () => {
  const events = buildMigrationEvents(null);
  runner.assertEqual(events.length, 0, 'null legacy input should yield no events');
});

// Run all tests
runner.run().then((success) => {
  if (success) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️ Some tests failed.');
    process.exit(1);
  }
});
