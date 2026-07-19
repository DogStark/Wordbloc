/**
 * SRS Simulation Harness
 * Simulates different child profiles over 30 days to validate:
 * - Review load stays bounded (not overwhelming for ages 2-7)
 * - Failed words resurface within ≤2 days
 * - Session queues are age-appropriate (5-10 minutes)
 */

// Import SRSEngine from the main module
const SRSEngine = require('../srs-engine.js').SRSEngine;

class SimulationHarness {
  constructor() {
    this.results = [];
  }

  /**
   * Simulate a child profile over N days
   */
  simulateProfile(profileName, days = 30) {
    console.log(`\n🎭 Simulating profile: ${profileName} (${days} days)`);
    
    const engine = new SRSEngine();
    engine.initialize(profileName);
    
    const profile = this.getProfile(profileName);
    const dailyStats = [];
    
    for (let day = 0; day < days; day++) {
      const dayStats = {
        day: day + 1,
        wordsSeen: 0,
        wordsCorrect: 0,
        wordsFailed: 0,
        reviewLoad: 0,
        newWordsIntroduced: 0,
        sessionLength: 0,
        failedWordsResurfaced: 0
      };
      
      // Simulate 1-2 sessions per day
      const sessionsPerDay = profile.sessionsPerDay || 1;
      
      for (let session = 0; session < sessionsPerDay; session++) {
        // Get session queue
        const allWords = this.generateWordBank(100);
        const queue = engine.buildSessionQueue(
          allWords, 
          profile.category || 'animals', 
          profile.ageBand || 'age4',
          10 // max words per session
        );
        
        // Only count if session has words
        if (queue.length > 0) {
          dayStats.sessionLength = queue.length;
          dayStats.reviewLoad = engine.getDueReviews().length;
        
          // Process each word in queue
          for (const word of queue) {
            dayStats.wordsSeen++;
            
            // Simulate response based on profile
            const response = this.generateResponse(profile, word);
            
            if (response.correct) {
              dayStats.wordsCorrect++;
            } else {
              dayStats.wordsFailed++;
            }
            
            // Record in SRS engine
            engine.recordResponse(
              word.wordId || word.word,
              word.word,
              word.category,
              response.quality,
              response.responseTimeMs
            );
            
            // Track if failed word resurfaces quickly
            if (!response.correct) {
              const wordState = engine.getWordState(word.wordId || word.word);
              if (wordState.interval <= 2) {
                dayStats.failedWordsResurfaced++;
              }
            }
          }
          
          // Track new words introduced
          dayStats.newWordsIntroduced = queue.filter(w => w.source === 'new').length;
        }
      }
      
      dailyStats.push(dayStats);
      
      // Advance time by 1 day
      this.advanceTime(engine, 1);
    }
    
    const summary = this.analyzeResults(profileName, dailyStats);
    this.results.push({ profileName, dailyStats, summary });
    
    console.log(`📊 ${profileName} Summary:`, summary);
    
    return summary;
  }

  /**
   * Get profile configuration
   */
  getProfile(profileName) {
    const profiles = {
      fastLearner: {
        sessionsPerDay: 2,
        category: 'animals',
        ageBand: 'age4',
        accuracy: 0.95,
        avgResponseTime: 2500,
        consistency: 0.9
      },
      struggling: {
        sessionsPerDay: 1,
        category: 'animals',
        ageBand: 'age4',
        accuracy: 0.55,
        avgResponseTime: 8000,
        consistency: 0.7
      },
      sporadic: {
        sessionsPerDay: 0.5, // Every other day
        category: 'animals',
        ageBand: 'age4',
        accuracy: 0.75,
        avgResponseTime: 5000,
        consistency: 0.5
      }
    };
    
    return profiles[profileName] || profiles.fastLearner;
  }

  /**
   * Generate simulated response
   */
  generateResponse(profile, word) {
    const isCorrect = Math.random() < profile.accuracy;
    
    let quality;
    let responseTimeMs;
    
    if (isCorrect) {
      // Quality based on response time
      responseTimeMs = this.normalRandom(profile.avgResponseTime, 1000);
      
      if (responseTimeMs < 3000) {
        quality = 5; // Perfect
      } else if (responseTimeMs < 5000) {
        quality = 4; // Good
      } else if (responseTimeMs < 10000) {
        quality = 3; // OK
      } else {
        quality = 2; // Slow but correct
      }
    } else {
      quality = 0; // Failed
      responseTimeMs = this.normalRandom(profile.avgResponseTime * 1.5, 2000);
    }
    
    return { correct: isCorrect, quality, responseTimeMs };
  }

  /**
   * Generate word bank for simulation
   */
  generateWordBank(count) {
    const words = [];
    const categories = ['animals', 'colors', 'food', 'objects'];
    const sampleWords = [
      'cat', 'dog', 'pig', 'cow', 'bird', 'fish', 'frog', 'bear',
      'red', 'blue', 'pink', 'green', 'gray', 'gold', 'white',
      'pie', 'ham', 'egg', 'jam', 'tea', 'nut', 'bun', 'oat',
      'ball', 'book', 'toy', 'box', 'cup', 'hat', 'car', 'key'
    ];
    
    for (let i = 0; i < count; i++) {
      words.push({
        wordId: `word${i}`,
        word: sampleWords[i % sampleWords.length],
        category: categories[i % categories.length],
        ageBand: 'age4'
      });
    }
    
    return words;
  }

  /**
   * Advance simulation time
   */
  advanceTime(engine, days) {
    // In a real simulation, we'd manipulate the system time
    // For this simulation, we'll manually adjust nextReview timestamps
    const msPerDay = 24 * 60 * 60 * 1000;
    
    for (const state of engine.wordState.values()) {
      if (state.nextReview) {
        state.nextReview -= (days * msPerDay);
      }
      if (state.lastReview) {
        state.lastReview -= (days * msPerDay);
      }
    }
  }

  /**
   * Analyze simulation results
   */
  analyzeResults(profileName, dailyStats) {
    const totalDays = dailyStats.length;
    const totalWordsSeen = dailyStats.reduce((sum, d) => sum + d.wordsSeen, 0);
    const totalWordsCorrect = dailyStats.reduce((sum, d) => sum + d.wordsCorrect, 0);
    const totalWordsFailed = dailyStats.reduce((sum, d) => sum + d.wordsFailed, 0);
    
    // Only average over days with actual sessions
    const daysWithSessions = dailyStats.filter(d => d.sessionLength > 0);
    const avgSessionLength = daysWithSessions.length > 0 
      ? daysWithSessions.reduce((sum, d) => sum + d.sessionLength, 0) / daysWithSessions.length 
      : 0;
    
    const avgReviewLoad = dailyStats.reduce((sum, d) => sum + d.reviewLoad, 0) / totalDays;
    const maxReviewLoad = Math.max(...dailyStats.map(d => d.reviewLoad));
    const totalFailedResurfaced = dailyStats.reduce((sum, d) => sum + d.failedWordsResurfaced, 0);
    
    const accuracy = totalWordsSeen > 0 ? (totalWordsCorrect / totalWordsSeen) * 100 : 0;
    
    // Validation checks
    const validations = {
      reviewLoadBounded: maxReviewLoad <= 15, // Should not exceed 15 words due
      failedWordsResurfaceQuickly: totalWordsFailed > 0 
        ? (totalFailedResurfaced / totalWordsFailed) >= 0.9 
        : true,
      sessionLengthAppropriate: avgSessionLength >= 3 && avgSessionLength <= 10, // Age 2-7: 3-10 words per session (5-10 min)
      accuracyReasonable: accuracy >= 30 && accuracy <= 100
    };
    
    return {
      totalDays,
      totalWordsSeen,
      totalWordsCorrect,
      totalWordsFailed,
      accuracy: Math.round(accuracy),
      avgSessionLength: Math.round(avgSessionLength),
      avgReviewLoad: Math.round(avgReviewLoad),
      maxReviewLoad,
      failedWordsResurfaced: totalFailedResurfaced,
      failedWordsResurfaceRate: totalWordsFailed > 0 
        ? Math.round((totalFailedResurfaced / totalWordsFailed) * 100) 
        : 0,
      validations,
      allPassed: Object.values(validations).every(v => v)
    };
  }

  /**
   * Run all simulations
   */
  runAllSimulations() {
    console.log('🚀 Starting SRS Simulation Harness...\n');
    console.log('=' .repeat(50));
    
    const profiles = ['fastLearner', 'struggling', 'sporadic'];
    let allPassed = true;
    
    for (const profile of profiles) {
      const result = this.simulateProfile(profile, 30);
      
      if (!result.allPassed) {
        allPassed = false;
        console.log(`⚠️ ${profile} FAILED some validations`);
      } else {
        console.log(`✅ ${profile} PASSED all validations`);
      }
    }
    
    console.log('\n' + '='.repeat(50));
    
    if (allPassed) {
      console.log('🎉 All simulations PASSED!');
    } else {
      console.log('❌ Some simulations FAILED validations');
    }
    
    return allPassed;
  }

  /**
   * Generate detailed report
   */
  generateReport() {
    console.log('\n📋 Detailed Simulation Report\n');
    console.log('=' .repeat(50));
    
    for (const result of this.results) {
      console.log(`\nProfile: ${result.profileName}`);
      console.log('-'.repeat(30));
      console.log(`Total Words Seen: ${result.summary.totalWordsSeen}`);
      console.log(`Accuracy: ${result.summary.accuracy}%`);
      console.log(`Avg Session Length: ${result.summary.avgSessionLength} words`);
      console.log(`Avg Review Load: ${result.summary.avgReviewLoad} words`);
      console.log(`Max Review Load: ${result.summary.maxReviewLoad} words`);
      console.log(`Failed Words Resurfaced: ${result.summary.failedWordsResurfaced}/${result.summary.totalWordsFailed}`);
      console.log(`Resurface Rate: ${result.summary.failedWordsResurfaceRate}%`);
      console.log('\nValidations:');
      console.log(`  Review Load Bounded: ${result.summary.validations.reviewLoadBounded ? '✅' : '❌'}`);
      console.log(`  Failed Words Resurface Quickly: ${result.summary.validations.failedWordsResurfaceQuickly ? '✅' : '❌'}`);
      console.log(`  Session Length Appropriate: ${result.summary.validations.sessionLengthAppropriate ? '✅' : '❌'}`);
      console.log(`  Accuracy Reasonable: ${result.summary.validations.accuracyReasonable ? '✅' : '❌'}`);
    }
    
    console.log('\n' + '='.repeat(50));
  }

  /**
   * Normal distribution random number
   */
  normalRandom(mean, stdDev) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return num * stdDev + mean;
  }
}

// Run simulations if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  const harness = new SimulationHarness();
  const allPassed = harness.runAllSimulations();
  harness.generateReport();
  
  process.exit(allPassed ? 0 : 1);
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulationHarness };
}
