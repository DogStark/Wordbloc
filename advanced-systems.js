// Reward System
class RewardSystem {
    constructor() {
        this.childId = 'default';
        this.badges = [];
        this.avatarParts = [];
        this.collectibles = [];
        this.achievements = new Map();
        this.loadRewards();
    }

    _key() {
        return `spellbloc_rewards_${this.childId || 'default'}`;
    }

    setChild(childId) {
        this.saveRewards();
        this.childId = childId || 'default';
        this.badges = [];
        this.avatarParts = [];
        this.collectibles = [];
        this.achievements = new Map();
        this.loadRewards();
    }

    unlockBadge(badgeId) {
        if (!this.badges.includes(badgeId)) {
            this.badges.push(badgeId);
            this.showBadgeUnlock(badgeId);
            this.saveRewards();
        }
    }

    unlockAvatarPart(partId) {
        if (!this.avatarParts.includes(partId)) {
            this.avatarParts.push(partId);
            this.showAvatarUnlock(partId);
            this.saveRewards();
        }
    }

    checkAchievements(stats) {
        const achievements = [
            { id: 'first_word', condition: () => stats.totalAttempts >= 1, reward: 'badge_beginner' },
            { id: 'perfect_ten', condition: () => stats.accuracy === 100 && stats.totalAttempts >= 10, reward: 'badge_perfect' },
            { id: 'speed_demon', condition: () => stats.totalAttempts >= 1 && stats.averageTime < 5, reward: 'avatar_lightning' },
            { id: 'persistent', condition: () => stats.totalSessions >= 7, reward: 'badge_persistent' }
        ];

        achievements.forEach(achievement => {
            if (!this.achievements.has(achievement.id) && achievement.condition()) {
                this.achievements.set(achievement.id, Date.now());
                this.unlockReward(achievement.reward);
            }
        });
    }

    unlockReward(rewardId) {
        if (rewardId.startsWith('badge_')) {
            this.unlockBadge(rewardId);
        } else if (rewardId.startsWith('avatar_')) {
            this.unlockAvatarPart(rewardId);
        }
    }

    showBadgeUnlock(badgeId) {
        // Create celebration animation
        const celebration = document.createElement('div');
        celebration.className = 'badge-unlock-celebration';
        celebration.innerHTML = `
            <div class="celebration-content">
                <h2>🏆 New Badge Unlocked!</h2>
                <div class="badge-display">${this.getBadgeEmoji(badgeId)}</div>
                <p>${this.getBadgeName(badgeId)}</p>
            </div>
        `;
        document.body.appendChild(celebration);
        
        setTimeout(() => {
            celebration.remove();
        }, 3000);
    }

    getBadgeEmoji(badgeId) {
        const badges = {
            'badge_beginner': '🌟',
            'badge_perfect': '💎',
            'badge_persistent': '🔥',
            'badge_speed': '⚡'
        };
        return badges[badgeId] || '🏅';
    }

    getBadgeName(badgeId) {
        const names = {
            'badge_beginner': 'First Steps',
            'badge_perfect': 'Perfect Score',
            'badge_persistent': 'Never Give Up',
            'badge_speed': 'Speed Master'
        };
        return names[badgeId] || 'Achievement';
    }

    saveRewards() {
        const payload = JSON.stringify({
            badges: this.badges,
            avatarParts: this.avatarParts,
            collectibles: this.collectibles,
            achievements: Array.from(this.achievements.entries())
        });
        try {
            localStorage.setItem(this._key(), payload);
            if (this.childId === 'default') {
                localStorage.setItem('spellbloc_rewards', payload);
            }
        } catch (e) { /* quota */ }
    }

    loadRewards() {
        let saved = null;
        try {
            saved = localStorage.getItem(this._key()) || (this.childId === 'default' ? localStorage.getItem('spellbloc_rewards') : null);
        } catch (e) {
            saved = null;
        }
        if (!saved) return;
        try {
            const data = JSON.parse(saved);
            this.badges = data.badges || [];
            this.avatarParts = data.avatarParts || [];
            this.collectibles = data.collectibles || [];
            this.achievements = new Map(data.achievements || []);
        } catch (e) {
            this.badges = [];
            this.avatarParts = [];
            this.collectibles = [];
            this.achievements = new Map();
        }
    }
}

// Multi-Language Support
class MultiLanguageSupport {
    constructor() {
        this.currentLanguage = 'en';
        this.translations = new Map();
        this.loadTranslations();
    }

    async loadTranslations() {
        // Comprehensive translations for all supported languages
        const translations = {
            'en': {
                'hear_word': 'Hear Word',
                'delete': 'Delete',
                'clear': 'Clear',
                'perfect': '🎉 Perfect! Great job!',
                'try_again': '🤔 Try again! You can do it!',
                'hint': 'Hint',
                'home': 'Home',
                'settings': 'Settings',
                'volume': 'Volume',
                'close': 'Close',
                'next_level': 'Next Level',
                'play_again': 'Play Again',
                'round_complete': 'Round Complete!',
                'earned_stars': 'You earned',
                'stars': 'stars',
                'age_selector': "Child's Age:",
                'game_mode': 'Game Mode:',
                'language': 'Language:',
                'accessibility': 'Accessibility',
                'high_contrast': 'High Contrast',
                'large_font': 'Large Font',
                'parent_dashboard': 'Parent Dashboard'
            },
            'es': {
                'hear_word': 'Escuchar Palabra',
                'delete': 'Borrar',
                'clear': 'Limpiar',
                'perfect': '🎉 ¡Perfecto! ¡Buen trabajo!',
                'try_again': '🤔 ¡Inténtalo de nuevo! ¡Puedes hacerlo!',
                'hint': 'Pista',
                'home': 'Inicio',
                'settings': 'Configuración',
                'volume': 'Volumen',
                'close': 'Cerrar',
                'next_level': 'Siguiente Nivel',
                'play_again': 'Jugar de Nuevo',
                'round_complete': '¡Ronda Completa!',
                'earned_stars': 'Ganaste',
                'stars': 'estrellas',
                'age_selector': 'Edad del Niño:',
                'game_mode': 'Modo de Juego:',
                'language': 'Idioma:',
                'accessibility': 'Accesibilidad',
                'high_contrast': 'Alto Contraste',
                'large_font': 'Letra Grande',
                'parent_dashboard': 'Panel de Padres'
            },
            'fr': {
                'hear_word': 'Écouter le Mot',
                'delete': 'Supprimer',
                'clear': 'Effacer',
                'perfect': '🎉 Parfait! Bon travail!',
                'try_again': '🤔 Essaie encore! Tu peux le faire!',
                'hint': 'Indice',
                'home': 'Accueil',
                'settings': 'Paramètres',
                'volume': 'Volume',
                'close': 'Fermer',
                'next_level': 'Niveau Suivant',
                'play_again': 'Rejouer',
                'round_complete': 'Manche Terminée!',
                'earned_stars': 'Tu as gagné',
                'stars': 'étoiles',
                'age_selector': 'Âge de l\'Enfant:',
                'game_mode': 'Mode de Jeu:',
                'language': 'Langue:',
                'accessibility': 'Accessibilité',
                'high_contrast': 'Contraste Élevé',
                'large_font': 'Grande Police',
                'parent_dashboard': 'Tableau de Bord Parent'
            },
            'de': {
                'hear_word': 'Wort Hören',
                'delete': 'Löschen',
                'clear': 'Leeren',
                'perfect': '🎉 Perfekt! Gute Arbeit!',
                'try_again': '🤔 Versuche es nochmal! Du schaffst das!',
                'hint': 'Hinweis',
                'home': 'Startseite',
                'settings': 'Einstellungen',
                'volume': 'Lautstärke',
                'close': 'Schließen',
                'next_level': 'Nächstes Level',
                'play_again': 'Nochmal Spielen',
                'round_complete': 'Runde Abgeschlossen!',
                'earned_stars': 'Du hast',
                'stars': 'Sterne verdient',
                'age_selector': 'Alter des Kindes:',
                'game_mode': 'Spielmodus:',
                'language': 'Sprache:',
                'accessibility': 'Barrierefreiheit',
                'high_contrast': 'Hoher Kontrast',
                'large_font': 'Große Schrift',
                'parent_dashboard': 'Eltern-Dashboard'
            },
            'zh': {
                'hear_word': '听单词',
                'delete': '删除',
                'clear': '清除',
                'perfect': '🎉 完美！做得好！',
                'try_again': '🤔 再试一次！你可以做到的！',
                'hint': '提示',
                'home': '首页',
                'settings': '设置',
                'volume': '音量',
                'close': '关闭',
                'next_level': '下一关',
                'play_again': '再玩一次',
                'round_complete': '回合完成！',
                'earned_stars': '你获得了',
                'stars': '颗星',
                'age_selector': '孩子年龄：',
                'game_mode': '游戏模式：',
                'language': '语言：',
                'accessibility': '无障碍功能',
                'high_contrast': '高对比度',
                'large_font': '大字体',
                'parent_dashboard': '家长面板'
            }
        };
        
        // Load built-in translations
        Object.entries(translations).forEach(([lang, trans]) => {
            this.translations.set(lang, trans);
        });
        
        console.log(`Loaded translations for: ${Object.keys(translations).join(', ')}`);
    }

    getFallbackTranslations(lang) {
        const fallbacks = {
            'es': {
                'hear_word': 'Escuchar Palabra',
                'delete': 'Borrar',
                'clear': 'Limpiar',
                'perfect': '¡Perfecto! ¡Buen trabajo!',
                'try_again': '¡Inténtalo de nuevo! ¡Puedes hacerlo!'
            },
            'fr': {
                'hear_word': 'Écouter le Mot',
                'delete': 'Supprimer',
                'clear': 'Effacer',
                'perfect': 'Parfait! Bon travail!',
                'try_again': 'Essaie encore! Tu peux le faire!'
            },
            'de': {
                'hear_word': 'Wort Hören',
                'delete': 'Löschen',
                'clear': 'Leeren',
                'perfect': 'Perfekt! Gute Arbeit!',
                'try_again': 'Versuche es nochmal! Du schaffst das!'
            },
            'zh': {
                'hear_word': '听单词',
                'delete': '删除',
                'clear': '清除',
                'perfect': '完美！做得好！',
                'try_again': '再试一次！你可以做到的！'
            }
        };
        return fallbacks[lang] || {};
    }

    translate(key) {
        const langTranslations = this.translations.get(this.currentLanguage);
        return langTranslations?.[key] || key;
    }

    setLanguage(lang) {
        this.currentLanguage = lang;
        this.updateUI();
        this.updateGameModeLabels();
        localStorage.setItem('spellbloc_language', lang);
        console.log(`Language changed to: ${lang}`);
    }

    updateUI() {
        // Update all translatable elements
        document.querySelectorAll('[data-translate]').forEach(element => {
            const key = element.getAttribute('data-translate');
            const translation = this.translate(key);
            if (translation !== key) {
                element.textContent = translation;
            }
        });
        
        // Update placeholder texts
        const customWordInput = document.getElementById('customWordInput');
        if (customWordInput) {
            const placeholder = this.translate('custom_word_placeholder') || 'Enter words separated by commas';
            customWordInput.placeholder = placeholder;
        }
    }
    
    updateGameModeLabels() {
        // Update game mode options
        const modeSelect = document.getElementById('modeSelect');
        if (modeSelect) {
            const options = modeSelect.querySelectorAll('option');
            const modeTranslations = {
                'classic': this.translate('classic_mode') || 'Classic Mode',
                'story': this.translate('story_mode') || 'Story Adventure',
                'timed': this.translate('timed_mode') || 'Speed Challenge',
                'puzzle': this.translate('puzzle_mode') || 'Word Puzzles'
            };
            
            options.forEach(option => {
                const mode = option.value;
                if (modeTranslations[mode]) {
                    option.textContent = modeTranslations[mode];
                }
            });
        }
        
        // Update age selector options
        const ageSelect = document.getElementById('ageSelect');
        if (ageSelect) {
            const agePrefix = this.translate('age') || 'Age';
            const options = ageSelect.querySelectorAll('option');
            options.forEach(option => {
                const age = option.value;
                const ageData = curriculum[`age${age}`];
                if (ageData) {
                    option.textContent = `${agePrefix} ${age} - ${ageData.name}`;
                }
            });
        }
    }

    speakInLanguage(text, lang = this.currentLanguage) {
        if ('speechSynthesis' in window) {
            // Cancel any ongoing speech
            speechSynthesis.cancel();
            
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = this.getLanguageCode(lang);
            utterance.rate = this.getSpeechRate(lang);
            utterance.pitch = this.getSpeechPitch(lang);
            utterance.volume = volume || 0.7;
            
            // Add error handling
            utterance.onerror = (event) => {
                console.log(`Speech synthesis error for ${lang}:`, event.error);
                // Fallback to default voice if specific language fails
                if (lang !== 'en') {
                    this.speakInLanguage(text, 'en');
                }
            };
            
            utterance.onstart = () => {
                console.log(`Speaking in ${lang}: "${text}"`);
            };
            
            // Wait for voices to load if needed
            if (speechSynthesis.getVoices().length === 0) {
                speechSynthesis.addEventListener('voiceschanged', () => {
                    this.selectBestVoice(utterance, lang);
                    speechSynthesis.speak(utterance);
                }, { once: true });
            } else {
                this.selectBestVoice(utterance, lang);
                speechSynthesis.speak(utterance);
            }
        } else {
            console.log('Speech synthesis not supported');
        }
    }
    
    selectBestVoice(utterance, lang) {
        const voices = speechSynthesis.getVoices();
        const langCode = this.getLanguageCode(lang);
        
        // Try to find the best voice for the language
        let selectedVoice = voices.find(voice => 
            voice.lang === langCode && voice.localService
        ) || voices.find(voice => 
            voice.lang.startsWith(lang)
        ) || voices.find(voice => 
            voice.lang.startsWith('en')
        );
        
        if (selectedVoice) {
            utterance.voice = selectedVoice;
            console.log(`Selected voice: ${selectedVoice.name} (${selectedVoice.lang})`);
        }
    }
    
    getSpeechRate(lang) {
        // Adjust speech rate for different languages
        const rates = {
            'en': 0.8,
            'es': 0.7,
            'fr': 0.7,
            'de': 0.6,
            'zh': 0.6
        };
        return rates[lang] || 0.7;
    }
    
    getSpeechPitch(lang) {
        // Adjust pitch for different languages
        const pitches = {
            'en': 1.2,
            'es': 1.3,
            'fr': 1.1,
            'de': 1.0,
            'zh': 1.4
        };
        return pitches[lang] || 1.2;
    }

    getLanguageCode(lang) {
        const codes = {
            'en': 'en-US',
            'es': 'es-ES',
            'fr': 'fr-FR',
            'de': 'de-DE',
            'zh': 'zh-CN'
        };
        return codes[lang] || 'en-US';
    }
    
    // Test all languages function
    testAllLanguages() {
        const testPhrase = 'Hello, this is a test';
        const languages = ['en', 'es', 'fr', 'de', 'zh'];
        
        console.log('Testing all languages...');
        languages.forEach((lang, index) => {
            setTimeout(() => {
                console.log(`Testing ${lang}...`);
                this.speakInLanguage(testPhrase, lang);
            }, index * 3000);
        });
    }
    
    // Get available voices for debugging
    getAvailableVoices() {
        const voices = speechSynthesis.getVoices();
        const voicesByLang = {};
        
        voices.forEach(voice => {
            const lang = voice.lang.substring(0, 2);
            if (!voicesByLang[lang]) {
                voicesByLang[lang] = [];
            }
            voicesByLang[lang].push({
                name: voice.name,
                lang: voice.lang,
                localService: voice.localService
            });
        });
        
        console.log('Available voices by language:', voicesByLang);
        return voicesByLang;
    }
}

// Parent Dashboard
class ParentDashboard {
    constructor() {
        this.childProfiles = new Map();
        this.reports = [];
        this.customWordLists = [];
        this.loadDashboardData();
    }

    createChildProfile(name, age, grade) {
        const profileId = (typeof telemetry !== 'undefined')
            ? telemetry.createChild(name)
            : Date.now().toString();
        const profile = {
            id: profileId,
            name,
            age,
            grade,
            createdAt: Date.now(),
            customSettings: {
                difficulty: 'auto',
                categories: 'all',
                timeLimit: null
            }
        };

        this.childProfiles.set(profileId, profile);
        this.saveDashboardData();
        return profileId;
    }

    _analyticsFor(profileId) {
        const childId = (typeof telemetry !== 'undefined' && profileId && telemetry.state.children[profileId])
            ? profileId
            : (typeof telemetry !== 'undefined' ? telemetry.getActiveChildId() : 'default');
        if (typeof telemetry !== 'undefined') {
            return telemetry.forChild(childId);
        }
        const profile = this.childProfiles.get(profileId);
        return (profile && profile.analytics) || new LearningAnalytics();
    }

    generateProgressReport(profileId, timeframe = 'week') {
        const analytics = this._analyticsFor(profileId);
        const childId = analytics.childId || profileId || 'default';
        const profile = this.childProfiles.get(profileId) || this.childProfiles.get(childId) || {
            id: childId,
            name: (typeof telemetry !== 'undefined' && telemetry.dumpChild(childId).name) || 'Player'
        };

        const report = {
            childId,
            childName: profile.name,
            timeframe,
            generatedAt: Date.now(),
            summary: analytics.getProgressReport(timeframe),
            recommendations: this.generateRecommendations(analytics),
            achievements: this.getRecentAchievements(profileId || childId),
            nextGoals: this.suggestNextGoals(analytics)
        };

        this.reports.push(report);
        this.saveDashboardData();
        return report;
    }

    generateRecommendations(analytics) {
        const recommendations = [];
        const weakAreas = analytics.identifyWeakAreas();
        
        if (weakAreas.length > 0) {
            recommendations.push({
                type: 'focus_area',
                message: `Focus on ${weakAreas[0].category} - current accuracy: ${Math.round(weakAreas[0].accuracy)}%`,
                priority: 'high'
            });
        }

        if (analytics.sessions && analytics.sessions.length > 0) {
            const lastSession = analytics.sessions[analytics.sessions.length - 1];
            const elapsedMs = (lastSession.endedAt || lastSession.endTime || 0) - (lastSession.startedAt || lastSession.startTime || 0);
            const sessionTime = (lastSession.totalTime || elapsedMs) / 1000 / 60; // minutes
            
            if (sessionTime < 5) {
                recommendations.push({
                    type: 'session_length',
                    message: 'Try longer practice sessions (10-15 minutes) for better retention',
                    priority: 'medium'
                });
            }
        }

        return recommendations;
    }

    getRecentAchievements(profileId) {
        // Get achievements from the last week
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        return Array.from(rewardSystem.achievements.entries())
            .filter(([id, timestamp]) => timestamp > weekAgo)
            .map(([id, timestamp]) => ({
                id,
                name: rewardSystem.getBadgeName(id),
                emoji: rewardSystem.getBadgeEmoji(id),
                unlockedAt: timestamp
            }));
    }

    suggestNextGoals(analytics) {
        const goals = [];
        const report = analytics.getProgressReport();
        
        if (report.accuracy < 80) {
            goals.push('Reach 80% accuracy in current level');
        } else if (report.accuracy >= 90) {
            goals.push('Try the next difficulty level');
        }
        
        if (report.totalSessions < 5) {
            goals.push('Complete 5 practice sessions this week');
        }
        
        return goals;
    }

    addCustomWordList(name, words, category = 'custom') {
        const wordList = {
            id: Date.now().toString(),
            name,
            words: words.map(word => ({
                word: word.toLowerCase(),
                emoji: '📝',
                category
            })),
            createdAt: Date.now(),
            category
        };
        
        this.customWordLists.push(wordList);
        this.saveDashboardData();
        return wordList.id;
    }

    getCustomWordLists() {
        return this.customWordLists;
    }

    saveDashboardData() {
        const data = {
            childProfiles: Array.from(this.childProfiles.entries()),
            reports: this.reports,
            customWordLists: this.customWordLists
        };
        localStorage.setItem('spellbloc_dashboard', JSON.stringify(data));
    }

    loadDashboardData() {
        const saved = localStorage.getItem('spellbloc_dashboard');
        if (!saved) return;
        try {
            const data = JSON.parse(saved);
            const entries = Array.isArray(data.childProfiles) ? data.childProfiles : [];
            this.childProfiles = new Map(entries.map(([id, profile]) => {
                if (!profile || typeof profile !== 'object') return [id, { id, name: id }];
                const { analytics, ...rest } = profile;
                return [id, rest];
            }));
            this.reports = Array.isArray(data.reports) ? data.reports : [];
            this.customWordLists = Array.isArray(data.customWordLists) ? data.customWordLists : [];
        } catch (e) {
            try {
                localStorage.setItem('spellbloc_dashboard_corrupt_' + Date.now(), saved);
            } catch (ignore) { /* quota */ }
            this.childProfiles = new Map();
            this.reports = [];
            this.customWordLists = [];
        }
    }

    exportReport(reportId, format = 'json') {
        const report = this.reports.find(r => r.id === reportId);
        if (!report) return null;

        if (format === 'json') {
            return JSON.stringify(report, null, 2);
        } else if (format === 'csv') {
            return this.convertReportToCSV(report);
        }
    }

    convertReportToCSV(report) {
        const headers = ['Metric', 'Value'];
        const rows = [
            ['Child Name', report.childName],
            ['Report Date', new Date(report.generatedAt).toLocaleDateString()],
            ['Total Sessions', report.summary.totalSessions],
            ['Total Attempts', report.summary.totalAttempts],
            ['Accuracy', `${report.summary.accuracy}%`],
            ['Average Session Time', `${report.summary.averageSessionTime}s`]
        ];
        
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
}

// Offline Support
class OfflineManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.setupEventListeners();
    }

    setupEventListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncPendingData();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    }

    saveOfflineData(key, data) {
        if (!this.isOnline) {
            this.syncQueue.push({ key, data, timestamp: Date.now() });
            localStorage.setItem('spellbloc_sync_queue', JSON.stringify(this.syncQueue));
        }
        localStorage.setItem(key, JSON.stringify(data));
    }

    async syncPendingData() {
        if (this.syncQueue.length === 0) return;

        try {
            // Simulate cloud sync
            for (const item of this.syncQueue) {
                await this.syncToCloud(item.key, item.data);
            }
            this.syncQueue = [];
            localStorage.removeItem('spellbloc_sync_queue');
        } catch (error) {
            console.log('Sync failed, will retry later');
        }
    }

    async syncToCloud(key, data) {
        // Only attempt sync if we're on HTTP/HTTPS protocol
        if (window.location.protocol === 'file:') {
            console.log('Offline mode: Data saved locally only');
            return Promise.resolve();
        }
        
        // Placeholder for actual cloud sync
        return new Promise(resolve => setTimeout(resolve, 100));
    }
}

// Performance Monitor
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            frameRate: 60,
            loadTime: 0,
            memoryUsage: 0
        };
        this.startMonitoring();
    }

    startMonitoring() {
        // Monitor frame rate
        let lastTime = performance.now();
        let frameCount = 0;

        const measureFPS = () => {
            frameCount++;
            const currentTime = performance.now();
            
            if (currentTime - lastTime >= 1000) {
                this.metrics.frameRate = Math.round((frameCount * 1000) / (currentTime - lastTime));
                frameCount = 0;
                lastTime = currentTime;
            }
            
            requestAnimationFrame(measureFPS);
        };
        
        requestAnimationFrame(measureFPS);

        // Monitor memory usage (if available)
        if (performance.memory) {
            setInterval(() => {
                this.metrics.memoryUsage = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            }, 5000);
        }
    }

    getMetrics() {
        return this.metrics;
    }

    optimizePerformance() {
        // Reduce animations if frame rate is low
        if (this.metrics.frameRate < 30) {
            document.body.classList.add('reduced-motion');
        }

        // Clean up memory if usage is high
        if (this.metrics.memoryUsage > 100) {
            this.cleanupMemory();
        }
    }

    cleanupMemory() {
        // Clear old analytics data
        const analytics = adaptiveLearning.analytics;
        if (analytics.sessions.length > 50) {
            analytics.sessions = analytics.sessions.slice(-25);
            analytics.saveAnalytics();
        }
    }
}

// Initialize advanced systems
const offlineManager = new OfflineManager();
const performanceMonitor = new PerformanceMonitor();

// Auto-optimize performance every 30 seconds
setInterval(() => {
    performanceMonitor.optimizePerformance();
}, 30000);