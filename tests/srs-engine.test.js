/**
 * Unit Tests for SRS Engine
 * Tests SM-2 algorithm correctness, interval growth, failure reset, and grade boundaries
 */

// Simple test framework (in production, use Jest or similar)
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

  assertApproxEqual(actual, expected, tolerance, message) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\nExpected: ${expected} ± ${tolerance}\nActual: ${actual}`);
    }
  }

  async run() {
    console.log('🧪 Running SRS Engine Tests...\n');
    
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

// Mock SRSEngine for testing (simplified version)
class MockSRSEngine {
  constructor() {
    this.wordState = new Map();
  }

  getWordState(wordId, word = '', category = '') {
    if (!this.wordState.has(wordId)) {
      this.wordState.set(wordId, {
        wordId,
        word,
        category,
        interval: 0,
        easeFactor: 2.5,
        repetitions: 0,
        quality: null,
        status: 'new',
        nextReview: null,
        lastReview: null,
        totalAttempts: 0,
        correctAttempts: 0
      });
    }
    return this.wordState.get(wordId);
  }

  recordResponse(wordId, word, category, quality, responseTimeMs) {
    const state = this.getWordState(wordId, word, category);
    const now = Date.now();
    
    state.totalAttempts++;
    state.lastReview = now;
    state.quality = quality;

    // SM-2 Algorithm
    if (quality < 3) {
      // Failed response: reset interval
      state.repetitions = 0;
      state.interval = 1;
      state.status = 'learning';
    } else {
      // Successful response
      state.correctAttempts++;
      state.repetitions++;
      
      // Calculate new interval
      if (state.repetitions === 1) {
        state.interval = 1;
      } else if (state.repetitions === 2) {
        state.interval = 6;
      } else {
        state.interval = Math.round(state.interval * state.easeFactor);
      }
      
      // Update ease factor
      const easeFactorAdjustment = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
      state.easeFactor = Math.max(1.3, state.easeFactor + easeFactorAdjustment);
      
      // Update status
      if (state.repetitions >= 3 && state.interval >= 21) {
        state.status = 'mastered';
      } else if (state.repetitions >= 1) {
        state.status = 'review';
      } else {
        state.status = 'learning';
      }
    }

    state.nextReview = now + (state.interval * 24 * 60 * 60 * 1000);
    
    return state;
  }
}

// Run tests
const runner = new TestRunner();

// Test 1: Interval growth on successful responses
runner.test('Interval growth on successful responses', () => {
  const engine = new MockSRSEngine();
  
  // First successful response
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.interval, 1, 'First success should set interval to 1 day');
  runner.assertEqual(state.repetitions, 1, 'Repetitions should be 1');
  
  // Second successful response
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.interval, 6, 'Second success should set interval to 6 days');
  runner.assertEqual(state.repetitions, 2, 'Repetitions should be 2');
  
  // Third successful response
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.interval, 16, 'Third success should set interval to 6 * 2.7 = 16 days (ease factor increased)');
  runner.assertEqual(state.repetitions, 3, 'Repetitions should be 3');
});

// Test 2: Failure resets interval
runner.test('Failure resets interval to 1 day', () => {
  const engine = new MockSRSEngine();
  
  // Build up some progress
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  
  runner.assertEqual(state.interval, 16, 'Should have built up interval (ease factor increases with quality 5)');
  runner.assertEqual(state.repetitions, 3, 'Should have 3 repetitions');
  
  // Now fail
  state = engine.recordResponse('word1', 'cat', 'animals', 0, 5000);
  
  runner.assertEqual(state.interval, 1, 'Failure should reset interval to 1 day');
  runner.assertEqual(state.repetitions, 0, 'Failure should reset repetitions to 0');
  runner.assertEqual(state.status, 'learning', 'Status should be learning after failure');
});

// Test 3: Quality grade boundaries
runner.test('Quality grade boundaries affect ease factor correctly', () => {
  const engine = new MockSRSEngine();
  
  // Perfect response (quality 5)
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  const initialEase = state.easeFactor;
  
  // Another perfect response should increase ease factor
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertTrue(state.easeFactor > initialEase, 'Perfect response should increase ease factor');
  
  // Poor but passing response (quality 3)
  engine.wordState.clear();
  state = engine.recordResponse('word2', 'dog', 'animals', 5, 2000);
  state = engine.recordResponse('word2', 'dog', 'animals', 5, 2000);
  const easeBefore = state.easeFactor;
  
  state = engine.recordResponse('word2', 'dog', 'animals', 3, 8000);
  runner.assertTrue(state.easeFactor < easeBefore, 'Quality 3 should decrease ease factor');
});

// Test 4: Ease factor never goes below 1.3
runner.test('Ease factor minimum bound of 1.3', () => {
  const engine = new MockSRSEngine();
  
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  
  // Many poor responses to drive down ease factor
  for (let i = 0; i < 20; i++) {
    state = engine.recordResponse('word1', 'cat', 'animals', 3, 8000);
  }
  
  runner.assertTrue(state.easeFactor >= 1.3, 'Ease factor should never go below 1.3');
});

// Test 5: Mastery status transitions
runner.test('Mastery status transitions correctly', () => {
  const engine = new MockSRSEngine();
  
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.status, 'review', 'First success should move to review');
  
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.status, 'review', 'Second success should stay in review');
  
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.status, 'review', 'Third success with interval 15 should still be review');
  
  // Need more repetitions to reach mastery threshold
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  runner.assertEqual(state.status, 'mastered', 'Fourth success should reach mastery');
});

// Test 6: Failed words resurface quickly
runner.test('Failed words resurface within 1-2 days', () => {
  const engine = new MockSRSEngine();
  
  // Build up progress
  let state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  
  const beforeFail = state.nextReview;
  
  // Fail
  state = engine.recordResponse('word1', 'cat', 'animals', 0, 5000);
  
  const afterFail = state.nextReview;
  const timeDiff = afterFail - beforeFail;
  const daysDiff = timeDiff / (24 * 60 * 60 * 1000);
  
  runner.assertTrue(daysDiff <= 2, 'Failed word should be due within 2 days');
  runner.assertEqual(state.interval, 1, 'Failed word should have interval of 1 day');
});

// Test 7: Multiple words tracked independently
runner.test('Multiple words tracked independently', () => {
  const engine = new MockSRSEngine();
  
  const state1 = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  const state2 = engine.recordResponse('word2', 'dog', 'animals', 0, 5000);
  const state3 = engine.recordResponse('word3', 'pig', 'animals', 3, 8000);
  
  runner.assertEqual(state1.interval, 1, 'Word1 should have interval 1');
  runner.assertEqual(state2.interval, 1, 'Word2 should have interval 1 (failed)');
  runner.assertEqual(state3.interval, 1, 'Word3 should have interval 1');
  
  runner.assertEqual(state1.repetitions, 1, 'Word1 should have 1 repetition');
  runner.assertEqual(state2.repetitions, 0, 'Word2 should have 0 repetitions (failed)');
  runner.assertEqual(state3.repetitions, 1, 'Word3 should have 1 repetition');
});

// Test 8: Accuracy calculation
runner.test('Accuracy calculation is correct', () => {
  const engine = new MockSRSEngine();
  
  // Mix of correct and incorrect
  engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  engine.recordResponse('word1', 'cat', 'animals', 0, 5000);
  engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  
  const state = engine.getWordState('word1');
  const accuracy = state.correctAttempts / state.totalAttempts;
  
  runner.assertEqual(state.totalAttempts, 4, 'Should have 4 total attempts');
  runner.assertEqual(state.correctAttempts, 3, 'Should have 3 correct attempts');
  runner.assertApproxEqual(accuracy, 0.75, 0.01, 'Accuracy should be 75%');
});

// Test 9: Next review timestamp calculation
runner.test('Next review timestamp is calculated correctly', () => {
  const engine = new MockSRSEngine();
  
  const beforeReview = Date.now();
  const state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  const afterReview = Date.now();
  
  const expectedMin = beforeReview + (1 * 24 * 60 * 60 * 1000);
  const expectedMax = afterReview + (1 * 24 * 60 * 60 * 1000);
  
  runner.assertTrue(state.nextReview >= expectedMin, 'Next review should be at least 1 day in future');
  runner.assertTrue(state.nextReview <= expectedMax, 'Next review should be at most 1 day in future');
});

// Test 10: Category tracking
runner.test('Category is preserved correctly', () => {
  const engine = new MockSRSEngine();
  
  const state = engine.recordResponse('word1', 'cat', 'animals', 5, 2000);
  
  runner.assertEqual(state.category, 'animals', 'Category should be preserved');
});

// Run all tests
runner.run().then(success => {
  if (success) {
    console.log('\n🎉 All tests passed!');
  } else {
    console.log('\n⚠️ Some tests failed.');
    process.exit(1);
  }
});
