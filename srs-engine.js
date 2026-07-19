/**
 * SM-2 Spaced Repetition System Engine
 * Implements the SuperMemo-2 algorithm for per-word mastery tracking
 * Optimized for ages 2-7 with age-appropriate session constraints
 */

class SRSEngine {
  constructor() {
    this.wordState = new Map(); // wordId -> SRS state
    this.childId = null;
    this.populationDifficulty = new Map(); // word -> population difficulty
    this.loadState();
  }

  /**
   * Initialize SRS engine for a specific child
   */
  initialize(childId) {
    this.childId = childId;
    this.loadState();
  }

  /**
   * Get or create word state
   */
  getWordState(wordId, word = '', category = '') {
    if (!this.wordState.has(wordId)) {
      this.wordState.set(wordId, {
        wordId,
        word,
        category,
        interval: 0,           // Current interval in days
        easeFactor: 2.5,       // SM-2 ease factor (default 2.5)
        repetitions: 0,        // Successful repetitions
        quality: null,         // Last quality grade (0-5)
        status: 'new',         // new, learning, review, mastered
        nextReview: null,      // Timestamp for next review
        lastReview: null,      // Timestamp of last review
        averageResponseTime: null,
        responseTimeSamples: 0,
        totalAttempts: 0,
        correctAttempts: 0
      });
    }
    return this.wordState.get(wordId);
  }

  /**
   * Record a response with quality grade and response time
   * Quality: 0-5 scale
   *   0: Complete failure (wrong answer)
   *   1: Incorrect but recognized
   *   2: Incorrect but easy to recall
   *   3: Correct but difficult
   *   4: Correct with hesitation
   *   5: Perfect response (correct + fast)
   */
  recordResponse(wordId, word, category, quality, responseTimeMs) {
    const state = this.getWordState(wordId, word, category);
    const now = Date.now();
    
    state.totalAttempts++;
    state.lastReview = now;
    state.quality = quality;
    
    // Track response time for difficulty estimation
    if (responseTimeMs !== null) {
      const responseTimeSec = responseTimeMs / 1000;
      if (state.averageResponseTime === null) {
        state.averageResponseTime = responseTimeSec;
      } else {
        // Exponential moving average
        state.averageResponseTime = 
          (state.averageResponseTime * state.responseTimeSamples + responseTimeSec) / 
          (state.responseTimeSamples + 1);
      }
      state.responseTimeSamples++;
    }

    // SM-2 Algorithm
    if (quality < 3) {
      // Failed response: reset interval
      state.repetitions = 0;
      state.interval = 1; // Review again tomorrow
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
      // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
      const easeFactorAdjustment = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
      state.easeFactor = Math.max(1.3, state.easeFactor + easeFactorAdjustment);
      
      // Update status based on mastery
      if (state.repetitions >= 3 && state.interval >= 21) {
        state.status = 'mastered';
      } else if (state.repetitions >= 1) {
        state.status = 'review';
      } else {
        state.status = 'learning';
      }
    }

    // Calculate next review date
    state.nextReview = now + (state.interval * 24 * 60 * 60 * 1000);
    
    // Save state
    this.saveState();
    
    return state;
  }

  /**
   * Get words due for review
   */
  getDueReviews() {
    const now = Date.now();
    const dueWords = [];
    
    for (const [wordId, state] of this.wordState) {
      if (state.nextReview !== null && state.nextReview <= now) {
        dueWords.push(state);
      }
    }
    
    // Sort by urgency (oldest nextReview first)
    dueWords.sort((a, b) => a.nextReview - b.nextReview);
    
    return dueWords;
  }

  /**
   * Get new words (not yet seen)
   */
  getNewWords(allWords, maxNewWords = 5) {
    const currentLearningLoad = this.getCurrentLearningLoad();
    const strugglingWords = this.getStrugglingWords();
    
    // Gate new words: don't introduce too many while struggling
    const availableSlots = Math.max(0, 10 - currentLearningLoad - strugglingWords.length);
    const actualNewWords = Math.min(maxNewWords, availableSlots);
    
    if (actualNewWords <= 0) {
      return [];
    }
    
    // Filter words that haven't been seen
    const newWords = allWords.filter(w => !this.wordState.has(w.wordId || w.word));
    
    // Sort by population difficulty (easier first for young children)
    newWords.sort((a, b) => {
      const diffA = this.getPopulationDifficulty(a.word);
      const diffB = this.getPopulationDifficulty(b.word);
      return diffA - diffB;
    });
    
    return newWords.slice(0, actualNewWords);
  }

  /**
   * Get current learning load (words in learning/review status)
   */
  getCurrentLearningLoad() {
    let load = 0;
    for (const state of this.wordState.values()) {
      if (state.status === 'learning' || state.status === 'review') {
        load++;
      }
    }
    return load;
  }

  /**
   * Get struggling words (failed recently, high interval but low success)
   */
  getStrugglingWords() {
    const struggling = [];
    const now = Date.now();
    const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
    
    for (const state of this.wordState.values()) {
      const successRate = state.totalAttempts > 0 
        ? state.correctAttempts / state.totalAttempts 
        : 0;
      
      // Struggling if: low success rate AND recently failed OR high interval but still learning
      if ((successRate < 0.5 && state.lastReview && state.lastReview > threeDaysAgo) ||
          (state.interval > 7 && state.status === 'learning')) {
        struggling.push(state);
      }
    }
    
    return struggling;
  }

  /**
   * Build session word queue
   * Prioritizes: 1) Due reviews, 2) Struggling words, 3) New words
   * Respects age-appropriate session length (5-10 minutes)
   */
  buildSessionQueue(allWords, category = null, ageBand = null, maxWords = 10) {
    const queue = [];
    
    // Filter by category and age band if specified
    let filteredWords = allWords;
    if (category) {
      filteredWords = filteredWords.filter(w => w.category === category);
    }
    if (ageBand) {
      filteredWords = filteredWords.filter(w => w.ageBand === ageBand);
    }
    
    // 1. Add due reviews first
    const dueReviews = this.getDueReviews();
    for (const review of dueReviews) {
      if (category && review.category !== category) continue;
      if (queue.length >= maxWords) break;
      queue.push({ ...review, source: 'review' });
    }
    
    // 2. Add struggling words
    const struggling = this.getStrugglingWords();
    for (const word of struggling) {
      if (category && word.category !== category) continue;
      if (queue.length >= maxWords) break;
      // Avoid duplicates
      if (!queue.find(q => q.wordId === word.wordId)) {
        queue.push({ ...word, source: 'struggling' });
      }
    }
    
    // 3. Add new words
    const remainingSlots = maxWords - queue.length;
    if (remainingSlots > 0) {
      const newWords = this.getNewWords(filteredWords, remainingSlots);
      for (const word of newWords) {
        queue.push({ 
          wordId: word.wordId || word.word,
          word: word.word,
          category: word.category,
          status: 'new',
          source: 'new'
        });
      }
    }
    
    return queue;
  }

  /**
   * Calculate word difficulty from population data and child history
   */
  calculateWordDifficulty(wordId) {
    const state = this.wordState.get(wordId);
    const populationDiff = this.getPopulationDifficulty(wordId);
    
    if (!state || state.totalAttempts === 0) {
      return populationDiff; // Default to population difficulty
    }
    
    // Combine population difficulty with child's performance
    const successRate = state.correctAttempts / state.totalAttempts;
    const avgTime = state.averageResponseTime || 5; // Default 5 seconds
    
    // Higher success rate + faster time = easier for this child
    const childDifficulty = (1 - successRate) * 2 + (avgTime / 10);
    
    // Weighted average (70% population, 30% individual)
    return (populationDiff * 0.7 + childDifficulty * 0.3);
  }

  /**
   * Get/set population difficulty (server aggregate)
   */
  getPopulationDifficulty(word) {
    return this.populationDifficulty.get(word) || 1.0; // Default medium difficulty
  }

  setPopulationDifficulty(word, difficulty) {
    this.populationDifficulty.set(word, difficulty);
  }

  /**
   * Get mastery status for reporting
   */
  getMasteryReport() {
    const report = {
      total: this.wordState.size,
      new: 0,
      learning: 0,
      review: 0,
      mastered: 0,
      dueToday: 0,
      upcomingReviews: [],
      averageAccuracy: 0,
      totalAttempts: 0,
      totalCorrect: 0
    };
    
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    
    for (const state of this.wordState.values()) {
      report[state.status]++;
      report.totalAttempts += state.totalAttempts;
      report.totalCorrect += state.correctAttempts;
      
      if (state.nextReview && state.nextReview <= now) {
        report.dueToday++;
      }
      
      if (state.nextReview && state.nextReview > now && state.nextReview <= now + oneWeek) {
        report.upcomingReviews.push({
          word: state.word,
          nextReview: new Date(state.nextReview),
          interval: state.interval,
          category: state.category
        });
      }
    }
    
    // Calculate average accuracy
    report.averageAccuracy = report.totalAttempts > 0 
      ? Math.round((report.totalCorrect / report.totalAttempts) * 100) 
      : 0;
    
    // Sort upcoming reviews by date
    report.upcomingReviews.sort((a, b) => a.nextReview - b.nextReview);
    
    return report;
  }

  /**
   * Get per-word mastery status for dashboard
   */
  getWordMasteryStatus(wordId) {
    const state = this.wordState.get(wordId);
    if (!state) {
      return { status: 'not_seen', masteryLevel: 0 };
    }
    
    // Calculate mastery level (0-100)
    let masteryLevel = 0;
    if (state.status === 'mastered') {
      masteryLevel = 100;
    } else if (state.status === 'review') {
      // Based on repetitions and interval
      masteryLevel = Math.min(90, 50 + (state.repetitions * 10) + (state.interval * 2));
    } else if (state.status === 'learning') {
      masteryLevel = Math.min(40, state.repetitions * 15);
    }
    
    return {
      status: state.status,
      masteryLevel: Math.round(masteryLevel),
      interval: state.interval,
      easeFactor: state.easeFactor,
      repetitions: state.repetitions,
      nextReview: state.nextReview ? new Date(state.nextReview) : null,
      accuracy: state.totalAttempts > 0 
        ? Math.round((state.correctAttempts / state.totalAttempts) * 100) 
        : 0,
      averageResponseTime: state.averageResponseTime
    };
  }

  /**
   * Get achievement-eligible milestones
   */
  getAchievementMilestones() {
    const milestones = {
      firstWord: false,
      tenWords: false,
      fiftyWords: false,
      hundredWords: false,
      firstMastered: false,
      fiveMastered: false,
      twentyMastered: false,
      streak7Days: false,
      streak30Days: false,
      perfectSession: false
    };
    
    let masteredCount = 0;
    let totalSeen = 0;
    let hasPerfectSession = false;
    
    for (const state of this.wordState.values()) {
      totalSeen++;
      if (state.status === 'mastered') {
        masteredCount++;
      }
      
      // Check for perfect session (100% accuracy with 5+ attempts)
      if (state.totalAttempts >= 5 && state.correctAttempts === state.totalAttempts) {
        hasPerfectSession = true;
      }
    }
    
    milestones.firstWord = totalSeen >= 1;
    milestones.tenWords = totalSeen >= 10;
    milestones.fiftyWords = totalSeen >= 50;
    milestones.hundredWords = totalSeen >= 100;
    milestones.firstMastered = masteredCount >= 1;
    milestones.fiveMastered = masteredCount >= 5;
    milestones.twentyMastered = masteredCount >= 20;
    milestones.perfectSession = hasPerfectSession;
    
    // Streak calculations would need daily activity tracking
    // For now, placeholder
    milestones.streak7Days = false;
    milestones.streak30Days = false;
    
    return milestones;
  }

  /**
   * Get parent dashboard data
   */
  getParentDashboardData() {
    const masteryReport = this.getMasteryReport();
    const milestones = this.getAchievementMilestones();
    
    // Calculate category performance
    const categoryPerformance = {};
    for (const state of this.wordState.values()) {
      if (!categoryPerformance[state.category]) {
        categoryPerformance[state.category] = {
          total: 0,
          correct: 0,
          mastered: 0
        };
      }
      categoryPerformance[state.category].total += state.totalAttempts;
      categoryPerformance[state.category].correct += state.correctAttempts;
      if (state.status === 'mastered') {
        categoryPerformance[state.category].mastered++;
      }
    }
    
    // Convert to array with accuracy
    const categoryStats = Object.entries(categoryPerformance).map(([category, data]) => ({
      category,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
      mastered: data.mastered,
      totalAttempts: data.total
    }));
    
    return {
      summary: {
        totalWords: masteryReport.total,
        masteredWords: masteryReport.mastered,
        learningWords: masteryReport.learning,
        averageAccuracy: masteryReport.averageAccuracy,
        dueForReview: masteryReport.dueToday
      },
      byCategory: categoryStats,
      upcomingReviews: masteryReport.upcomingReviews.slice(0, 10), // Next 10 reviews
      achievements: milestones,
      strugglingWords: this.getStrugglingWords().slice(0, 5).map(w => ({
        word: w.word,
        category: w.category,
        accuracy: w.totalAttempts > 0 ? Math.round((w.correctAttempts / w.totalAttempts) * 100) : 0,
        interval: w.interval
      }))
    };
  }

  /**
   * Export state for persistence
   */
  exportState() {
    return {
      childId: this.childId,
      wordState: Array.from(this.wordState.entries()),
      populationDifficulty: Array.from(this.populationDifficulty.entries())
    };
  }

  /**
   * Import state from persistence
   */
  importState(data) {
    if (!data) return;
    
    this.childId = data.childId;
    this.wordState = new Map(data.wordState || []);
    this.populationDifficulty = new Map(data.populationDifficulty || []);
  }

  /**
   * Save to localStorage
   */
  saveState() {
    try {
      const state = this.exportState();
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`srs_state_${this.childId || 'default'}`, JSON.stringify(state));
      }
    } catch (e) {
      // Silently fail in Node.js environment or if localStorage is unavailable
    }
  }

  /**
   * Load from localStorage
   */
  loadState() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(`srs_state_${this.childId || 'default'}`);
        if (saved) {
          this.importState(JSON.parse(saved));
        }
      }
    } catch (e) {
      // Silently fail in Node.js environment or if localStorage is unavailable
    }
  }

  /**
   * Clear all state (for testing or reset)
   */
  clearState() {
    this.wordState.clear();
    this.populationDifficulty.clear();
    this.saveState();
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SRSEngine };
} else if (typeof window !== 'undefined') {
  window.SRSEngine = SRSEngine;
}
