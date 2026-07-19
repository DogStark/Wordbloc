// SpellBloc AI Agent - Personalized Learning System
class SpellBlocAI {
    constructor() {
        this.isInitialized = false;
        this.childProfile = null;
        this.performanceHistory = [];
        this.learningPatterns = new Map();
        this.srsEngine = null; // Will reference the unified SRS engine
        this.speechRecognition = new SpeechAI();
        this.personalityEngine = new PersonalityAI();
        this.init();
    }

    async init() {
        console.log('🤖 SpellBloc AI Agent initializing...');
        
        // Load child's learning profile
        await this.loadChildProfile();
        
        // Reference the unified SRS engine from game.js
        if (typeof adaptiveLearning !== 'undefined' && adaptiveLearning.srsEngine) {
            this.srsEngine = adaptiveLearning.srsEngine;
        }
        
        // Initialize AI models
        await this.speechRecognition.init();
        await this.personalityEngine.init();
        
        this.isInitialized = true;
        console.log('✅ AI Agent ready!');
        
        // Hook into existing game events
        this.attachToGameEvents();
    }

    isReady() {
        return this.isInitialized;
    }

    // SMART WORD SELECTION
    suggestNextWord(category, currentWordIndex, childPerformance) {
        if (!this.isReady()) return null;

        const words = wordData[category];
        const childData = this.getChildLearningData();
        
        // AI analyzes child's performance patterns
        const analysis = this.analyzePerformancePatterns(childData);
        
        // Select optimal word based on:
        // 1. Current difficulty level
        // 2. Child's weak areas
        // 3. Optimal challenge zone
        const optimalWord = this.selectOptimalWord(words, analysis, currentWordIndex);
        
        console.log(`🎯 AI suggests: "${optimalWord.word}" (difficulty: ${analysis.recommendedDifficulty})`);
        
        return optimalWord;
    }

    // PERFORMANCE ANALYSIS
    analyzePerformancePatterns(childData) {
        const recentAttempts = childData.attempts.slice(-20); // Last 20 attempts
        
        const analysis = {
            accuracy: this.calculateAccuracy(recentAttempts),
            averageTime: this.calculateAverageTime(recentAttempts),
            strugglingAreas: this.identifyStrugglingAreas(recentAttempts),
            strongAreas: this.identifyStrongAreas(recentAttempts),
            recommendedDifficulty: this.calculateOptimalDifficulty(recentAttempts),
            emotionalState: this.assessEmotionalState(recentAttempts),
            learningVelocity: this.calculateLearningVelocity(recentAttempts)
        };

        return analysis;
    }

    // EMOTIONAL STATE ASSESSMENT
    assessEmotionalState(attempts) {
        if (attempts.length === 0) return 'neutral';
        
        const recentAttempts = attempts.slice(-5); // Last 5 attempts
        const accuracy = this.calculateAccuracy(recentAttempts);
        const avgTime = this.calculateAverageTime(recentAttempts);
        const consecutiveFailures = this.getConsecutiveFailures(recentAttempts);
        
        // Determine emotional state based on performance patterns
        if (consecutiveFailures >= 3) return 'frustrated';
        if (accuracy >= 80 && avgTime < 10) return 'confident';
        if (accuracy >= 90) return 'excited';
        if (accuracy < 50) return 'struggling';
        if (avgTime > 20) return 'thoughtful';
        
        return 'engaged';
    }

    // LEARNING VELOCITY CALCULATION
    calculateLearningVelocity(attempts) {
        if (attempts.length < 10) return 'establishing';
        
        const firstHalf = attempts.slice(0, Math.floor(attempts.length / 2));
        const secondHalf = attempts.slice(Math.floor(attempts.length / 2));
        
        const firstAccuracy = this.calculateAccuracy(firstHalf);
        const secondAccuracy = this.calculateAccuracy(secondHalf);
        
        const improvement = secondAccuracy - firstAccuracy;
        
        if (improvement > 20) return 'accelerating';
        if (improvement > 10) return 'improving';
        if (improvement > -5) return 'steady';
        
        return 'declining';
    }

    // GET CONSECUTIVE FAILURES
    getConsecutiveFailures(attempts) {
        let consecutive = 0;
        for (let i = attempts.length - 1; i >= 0; i--) {
            if (!attempts[i].correct) {
                consecutive++;
            } else {
                break;
            }
        }
        return consecutive;
    }

    // LEARNING STYLE DETECTION
    identifyLearningStyle(childData) {
        const patterns = this.identifyLearningPattern(childData);
        
        if (patterns.visualLearner > 0.7) return 'Visual Learner';
        if (patterns.auditoryLearner > 0.7) return 'Auditory Learner';
        if (patterns.kinestheticLearner > 0.7) return 'Kinesthetic Learner';
        
        return 'Multimodal Learner';
    }

    // DETECT LEARNING PATTERNS
    detectVisualLearning(childData) {
        // Higher accuracy with emoji-based categories suggests visual learning
        const visualCategories = ['animals', 'colors', 'fruits', 'objects'];
        const visualAttempts = childData.attempts.filter(a => visualCategories.includes(a.category));
        return this.calculateAccuracy(visualAttempts) / 100;
    }

    detectAuditoryLearning(childData) {
        // Better performance with sound-based categories
        const auditoryCategories = ['vowels', 'consonants', 'vowel_words', 'consonant_words'];
        const auditoryAttempts = childData.attempts.filter(a => auditoryCategories.includes(a.category));
        return this.calculateAccuracy(auditoryAttempts) / 100;
    }

    detectKinestheticLearning(childData) {
        // Faster completion times suggest kinesthetic preference
        const avgTime = this.calculateAverageTime(childData.attempts);
        return avgTime < 10 ? 0.8 : 0.3; // Quick responses suggest kinesthetic
    }

    detectLearningSpeed(childData) {
        const velocity = this.calculateLearningVelocity(childData.attempts);
        return velocity === 'accelerating' || velocity === 'improving';
    }

    detectRepetitionNeeds(childData) {
        const strugglingAreas = this.identifyStrugglingAreas(childData.attempts);
        return strugglingAreas.length > 2; // Needs repetition if struggling in multiple areas
    }

    // PRONUNCIATION SIMILARITY
    calculatePronunciationSimilarity(spoken, expected) {
        // Simple similarity calculation (can be enhanced with phonetic algorithms)
        const spokenClean = spoken.toLowerCase().replace(/[^a-z]/g, '');
        const expectedClean = expected.toLowerCase().replace(/[^a-z]/g, '');
        
        if (spokenClean === expectedClean) return 1.0;
        
        // Calculate Levenshtein distance
        const distance = this.levenshteinDistance(spokenClean, expectedClean);
        const maxLength = Math.max(spokenClean.length, expectedClean.length);
        
        return Math.max(0, 1 - (distance / maxLength));
    }

    // LEVENSHTEIN DISTANCE
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    // PRONUNCIATION FEEDBACK
    generatePronunciationFeedback(similarity) {
        if (similarity >= 0.9) return '🎉 Perfect pronunciation!';
        if (similarity >= 0.7) return '👍 Great job! Almost perfect!';
        if (similarity >= 0.5) return '😊 Good try! Let\'s practice more.';
        return '🤗 Keep practicing! You\'re learning!';
    }

    // RECOMMENDED FOCUS
    getRecommendedFocus(analysis) {
        if (analysis.strugglingAreas.length > 0) {
            return `Focus on ${analysis.strugglingAreas[0]} to improve overall performance`;
        }
        if (analysis.accuracy > 90) {
            return 'Ready for more challenging words!';
        }
        return 'Continue building spelling confidence';
    }

    // GENERATE RECOMMENDATIONS
    generateRecommendations(analysis) {
        const recommendations = [];
        
        if (analysis.accuracy < 70) {
            recommendations.push('Practice with easier words to build confidence');
        }
        
        if (analysis.averageTime > 20) {
            recommendations.push('Take time to sound out words - no rush!');
        }
        
        if (analysis.strugglingAreas.length > 0) {
            recommendations.push(`Extra practice needed in: ${analysis.strugglingAreas.join(', ')}`);
        }
        
        if (analysis.emotionalState === 'frustrated') {
            recommendations.push('Take breaks and celebrate small wins');
        }
        
        if (recommendations.length === 0) {
            recommendations.push('Great progress! Keep up the excellent work!');
        }
        
        return recommendations;
    }

    // PREDICT NEXT MILESTONE
    predictNextMilestone(childData) {
        const accuracy = this.calculateAccuracy(childData.attempts);
        const totalWords = childData.attempts.length;
        
        if (accuracy >= 90 && totalWords >= 50) {
            return 'Ready for next age level!';
        }
        if (accuracy >= 80) {
            return `${100 - totalWords} more words to master this level`;
        }
        if (accuracy >= 70) {
            return 'Building strong spelling foundation';
        }
        
        return 'Focus on current level mastery';
    }

    // PERSONALIZED ENCOURAGEMENT
    generateEncouragement(attempt, childPersonality) {
        const encouragements = {
            success: {
                confident: ["🌟 Excellent work!", "🎉 You're on fire!", "💪 Keep crushing it!"],
                cautious: ["✨ Well done!", "😊 Great job!", "👏 You did it!"],
                playful: ["🎈 Awesome sauce!", "🦄 Magical spelling!", "🎪 You're amazing!"],
                focused: ["🎯 Perfect execution!", "📚 Excellent work!", "🏆 Outstanding!"]
            },
            struggle: {
                confident: ["💪 You've got this!", "🔥 Don't give up!", "⚡ Try again!"],
                cautious: ["🤗 It's okay, try again", "💝 You're learning!", "🌱 Keep growing!"],
                playful: ["🎮 Oops! Try again!", "🎨 Almost there!", "🎭 Give it another go!"],
                focused: ["🎯 Focus and try again", "📖 Think it through", "🧠 You can do it!"]
            }
        };

        const type = attempt.correct ? 'success' : 'struggle';
        const messages = encouragements[type][childPersonality] || encouragements[type]['playful'];
        
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // ADAPTIVE HINTS
    generateSmartHint(word, attemptNumber, childLevel) {
        const hints = {
            1: `This word starts with "${word[0].toUpperCase()}"`,
            2: `It has ${word.length} letters: ${word[0].toUpperCase()}_${'_'.repeat(word.length-2)}${word[word.length-1].toUpperCase()}`,
            3: `Let's sound it out: ${word.split('').join('-').toUpperCase()}`,
            4: `The word is "${word.toUpperCase()}" - you've got this!`
        };

        return hints[Math.min(attemptNumber, 4)];
    }

    // LEARNING PATTERN RECOGNITION
    identifyLearningPattern(childData) {
        const patterns = {
            visualLearner: this.detectVisualLearning(childData),
            auditoryLearner: this.detectAuditoryLearning(childData),
            kinestheticLearner: this.detectKinestheticLearning(childData),
            fastLearner: this.detectLearningSpeed(childData),
            needsRepetition: this.detectRepetitionNeeds(childData)
        };

        return patterns;
    }

    // DIFFICULTY ADJUSTMENT - Now uses unified SRS engine
    calculateOptimalDifficulty(attempts) {
        if (this.srsEngine) {
            // Use SRS engine's difficulty calculation
            const recentAttempts = attempts.slice(-10);
            if (recentAttempts.length === 0) return 'maintain';
            
            const accuracy = this.calculateAccuracy(recentAttempts);
            const avgTime = this.calculateAverageTime(recentAttempts);
            
            // Optimal challenge zone: 70-85% accuracy
            if (accuracy > 85) return 'increase'; // Too easy
            if (accuracy < 70) return 'decrease'; // Too hard
            if (avgTime > 30) return 'decrease'; // Taking too long
            
            return 'maintain';
        }
        
        // Fallback to simple calculation if SRS engine not available
        const accuracy = this.calculateAccuracy(attempts);
        const avgTime = this.calculateAverageTime(attempts);
        
        if (accuracy > 85) return 'increase';
        if (accuracy < 70) return 'decrease';
        if (avgTime > 30) return 'decrease';
        
        return 'maintain';
    }

    // SPEECH RECOGNITION & PRONUNCIATION
    async listenToPronunciation(expectedWord) {
        if (!this.speechRecognition.isAvailable()) return null;

        try {
            const spokenWord = await this.speechRecognition.listen();
            const similarity = this.calculatePronunciationSimilarity(spokenWord, expectedWord);
            
            return {
                spokenWord,
                expectedWord,
                similarity,
                feedback: this.generatePronunciationFeedback(similarity)
            };
        } catch (error) {
            console.log('Speech recognition not available:', error);
            return null;
        }
    }

    // PARENT INSIGHTS
    generateParentInsights(childId, timeframe = 'week') {
        const childData = this.getChildLearningData(childId);
        const analysis = this.analyzePerformancePatterns(childData);
        
        return {
            summary: {
                totalWords: childData.attempts.length,
                accuracy: analysis.accuracy,
                improvementAreas: analysis.strugglingAreas,
                strengths: analysis.strongAreas,
                recommendedFocus: this.getRecommendedFocus(analysis)
            },
            insights: [
                `${childData.name} is ${analysis.accuracy > 80 ? 'excelling' : 'progressing well'} with spelling`,
                `Strongest area: ${analysis.strongAreas[0] || 'Building foundation'}`,
                `Focus area: ${analysis.strugglingAreas[0] || 'Continue current progress'}`,
                `Learning style: ${this.identifyLearningStyle(childData)}`
            ],
            recommendations: this.generateRecommendations(analysis),
            nextMilestone: this.predictNextMilestone(childData)
        };
    }

    // GAME EVENT INTEGRATION (Non-disruptive)
    attachToGameEvents() {
        // Hook into existing game functions without modifying them
        const originalHandleCorrectAnswer = window.handleCorrectAnswer;
        const originalHandleIncorrectAnswer = window.handleIncorrectAnswer;
        const originalLoadWord = window.loadWord;

        // Enhance correct answer handling
        window.handleCorrectAnswer = () => {
            // Run original function first
            if (originalHandleCorrectAnswer) originalHandleCorrectAnswer();
            
            // Add AI learning
            this.recordAttempt({
                word: currentWord,
                correct: true,
                timeSpent: Date.now() - startTime,
                category: currentCategory,
                timestamp: Date.now()
            });
        };

        // Enhance incorrect answer handling
        window.handleIncorrectAnswer = () => {
            // Run original function first
            if (originalHandleIncorrectAnswer) originalHandleIncorrectAnswer();
            
            // Add AI learning
            this.recordAttempt({
                word: currentWord,
                correct: false,
                timeSpent: Date.now() - startTime,
                category: currentCategory,
                timestamp: Date.now()
            });
        };

        // Enhance word loading with AI suggestions
        window.loadWord = () => {
            // Get AI suggestion for next word
            const aiSuggestion = this.suggestNextWord(currentCategory, currentWordIndex, this.getChildLearningData());
            
            if (aiSuggestion && Math.random() > 0.3) { // 70% chance to use AI suggestion
                // Override word selection with AI choice
                const words = wordData[currentCategory];
                const aiWordIndex = words.findIndex(w => w.word === aiSuggestion.word);
                if (aiWordIndex !== -1) {
                    currentWordIndex = aiWordIndex;
                }
            }
            
            // Run original function
            if (originalLoadWord) originalLoadWord();
            
            // Add AI enhancements
            this.enhanceWordPresentation();
        };
    }

    // HELPER METHODS
    recordAttempt(attempt) {
        this.performanceHistory.push(attempt);
        
        // Keep only last 100 attempts
        if (this.performanceHistory.length > 100) {
            this.performanceHistory.shift();
        }
        
        // Save to localStorage
        this.savePerformanceData();
        
        // Update learning patterns
        this.updateLearningPatterns(attempt);
    }

    calculateAccuracy(attempts) {
        if (attempts.length === 0) return 0;
        const correct = attempts.filter(a => a.correct).length;
        return Math.round((correct / attempts.length) * 100);
    }

    calculateAverageTime(attempts) {
        if (attempts.length === 0) return 0;
        const totalTime = attempts.reduce((sum, a) => sum + a.timeSpent, 0);
        return Math.round(totalTime / attempts.length / 1000); // Convert to seconds
    }

    identifyStrugglingAreas(attempts) {
        const categoryPerformance = {};
        
        attempts.forEach(attempt => {
            if (!categoryPerformance[attempt.category]) {
                categoryPerformance[attempt.category] = { correct: 0, total: 0 };
            }
            categoryPerformance[attempt.category].total++;
            if (attempt.correct) categoryPerformance[attempt.category].correct++;
        });
        
        return Object.entries(categoryPerformance)
            .map(([category, perf]) => ({
                category,
                accuracy: (perf.correct / perf.total) * 100
            }))
            .filter(item => item.accuracy < 70)
            .sort((a, b) => a.accuracy - b.accuracy)
            .map(item => item.category);
    }

    identifyStrongAreas(attempts) {
        const categoryPerformance = {};
        
        attempts.forEach(attempt => {
            if (!categoryPerformance[attempt.category]) {
                categoryPerformance[attempt.category] = { correct: 0, total: 0 };
            }
            categoryPerformance[attempt.category].total++;
            if (attempt.correct) categoryPerformance[attempt.category].correct++;
        });
        
        return Object.entries(categoryPerformance)
            .map(([category, perf]) => ({
                category,
                accuracy: (perf.correct / perf.total) * 100
            }))
            .filter(item => item.accuracy >= 80)
            .sort((a, b) => b.accuracy - a.accuracy)
            .map(item => item.category);
    }

    selectOptimalWord(words, analysis, currentIndex) {
        // If no analysis data, use current word
        if (analysis.strugglingAreas.length === 0) {
            return words[currentIndex] || words[0];
        }
        
        // Find words in struggling areas
        const strugglingCategory = analysis.strugglingAreas[0];
        const strugglingWords = words.filter(w => w.category === strugglingCategory);
        
        if (strugglingWords.length > 0) {
            return strugglingWords[Math.floor(Math.random() * strugglingWords.length)];
        }
        
        return words[currentIndex] || words[0];
    }

    enhanceWordPresentation() {
        // Add AI-powered hints and encouragement to the UI
        const aiHintElement = document.getElementById('aiHint');
        const aiEncouragementElement = document.getElementById('aiEncouragement');
        
        if (aiHintElement) {
            const childData = this.getChildLearningData();
            const recentStruggle = childData.attempts.slice(-3).some(a => !a.correct);
            
            if (recentStruggle) {
                aiHintElement.textContent = `💡 ${this.generateSmartHint(currentWord, 1, childData.level)}`;
                aiHintElement.classList.remove('hidden');
            }
        }
        
        if (aiEncouragementElement) {
            const personality = this.personalityEngine.getChildPersonality();
            const encouragement = this.generateEncouragement({ correct: true }, personality);
            aiEncouragementElement.textContent = encouragement;
        }
    }

    getChildLearningData(childId = 'default') {
        return {
            name: 'Player',
            level: playerLevel,
            attempts: this.performanceHistory,
            personality: this.personalityEngine.getChildPersonality()
        };
    }

    savePerformanceData() {
        localStorage.setItem('spellbloc_ai_performance', JSON.stringify(this.performanceHistory));
    }

    async loadChildProfile() {
        const saved = localStorage.getItem('spellbloc_ai_performance');
        if (saved) {
            this.performanceHistory = JSON.parse(saved);
        }
    }

    updateLearningPatterns(attempt) {
        const pattern = this.learningPatterns.get(attempt.category) || { attempts: 0, successes: 0 };
        pattern.attempts++;
        if (attempt.correct) pattern.successes++;
        this.learningPatterns.set(attempt.category, pattern);
    }
}

// DIFFICULTY AI MODEL - Removed, now using unified SRS engine from srs-engine.js
// The difficulty calculation is now handled by SRSEngine.calculateWordDifficulty()

// SPEECH AI
class SpeechAI {
    constructor() {
        this.recognition = null;
        this.isListening = false;
    }

    async init() {
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.lang = 'en-US';
        }
    }

    isAvailable() {
        return this.recognition !== null;
    }

    async listen() {
        return new Promise((resolve, reject) => {
            if (!this.recognition) {
                reject(new Error('Speech recognition not available'));
                return;
            }

            this.recognition.onresult = (event) => {
                const result = event.results[0][0].transcript.toLowerCase().trim();
                resolve(result);
            };

            this.recognition.onerror = (event) => {
                reject(new Error(`Speech recognition error: ${event.error}`));
            };

            this.recognition.start();
        });
    }
}

// PERSONALITY AI
class PersonalityAI {
    constructor() {
        this.childPersonality = 'playful'; // default
    }

    async init() {
        // Load saved personality or detect from behavior
        const saved = localStorage.getItem('spellbloc_child_personality');
        if (saved) {
            this.childPersonality = saved;
        }
    }

    getChildPersonality() {
        return this.childPersonality;
    }

    detectPersonalityFromBehavior(attempts) {
        // Simple personality detection based on behavior patterns
        const avgTime = attempts.reduce((sum, a) => sum + a.timeSpent, 0) / attempts.length;
        const accuracy = attempts.filter(a => a.correct).length / attempts.length;
        
        if (avgTime < 5000 && accuracy > 0.8) return 'confident';
        if (avgTime > 15000) return 'cautious';
        if (accuracy > 0.9) return 'focused';
        
        return 'playful';
    }

    updatePersonality(newPersonality) {
        this.childPersonality = newPersonality;
        localStorage.setItem('spellbloc_child_personality', newPersonality);
    }
}

// Initialize AI Agent
let spellblocAI = null;

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize AI after a short delay to ensure game is ready
    setTimeout(async () => {
        spellblocAI = new SpellBlocAI();
        window.spellblocAI = spellblocAI; // Make globally available
        
        // Add AI status indicator to UI
        const aiStatus = document.createElement('div');
        aiStatus.id = 'aiStatus';
        aiStatus.className = 'ai-status';
        aiStatus.innerHTML = '🤖 AI Learning...';
        document.body.appendChild(aiStatus);
        
        // Update status when AI is ready
        setTimeout(() => {
            if (spellblocAI.isReady()) {
                aiStatus.innerHTML = '🧠 AI Ready';
                aiStatus.classList.add('ready');
            }
        }, 2000);
    }, 1000);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SpellBlocAI, SpeechAI, PersonalityAI };
}