// SpellBloc Authentication Manager - Handle user sessions and logout
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.isLoggedIn = false;
        this.authCheckPromise = this.init();
    }

    async init() {
        // Setup logout button
        this.setupLogoutButton();

        // Check if user is logged in on page load
        await this.checkAuthStatus();
        
        // Setup login redirect
        this.setupLoginRedirect();
        
        console.log('🔐 Auth Manager initialized');
    }

    async checkAuthStatus() {
        // Trust only the server-verified token. The cached user blob is a display cache.
        const token = localStorage.getItem('spellbloc_token');
        
        if (!token) {
            this.clearSession();
            console.log('👤 No user session found');
            this.redirectIfRequired();
            return false;
        }

        try {
            const response = await fetch('/api/auth/verify', {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                cache: 'no-store'
            });

            if (!response.ok) {
                throw new Error(`Session verification failed with ${response.status}`);
            }

            const result = await response.json();
            if (!result || !result.user) {
                throw new Error('Session verification response did not include a user');
            }

            this.currentUser = result.user;
            this.isLoggedIn = true;
            localStorage.setItem('spellbloc_user', JSON.stringify(result.user));
            this.showUserInfo();
            console.log(`✅ User logged in: ${this.currentUser.parentName}`);
            return true;
        } catch (error) {
            console.log('❌ Invalid or expired session, clearing storage');
            this.clearSession();
            this.redirectIfRequired();
            return false;
        }
    }

    clearSession() {
        localStorage.removeItem('spellbloc_user');
        localStorage.removeItem('spellbloc_token');
        this.currentUser = null;
        this.isLoggedIn = false;
        this.hideUserInfo();
    }

    isLoginPage() {
        return window.location.pathname.includes('login');
    }

    redirectIfRequired() {
        if (window.SPELLBLOC_REQUIRE_AUTH && !this.isLoginPage()) {
            window.location.href = '/login.html';
        }
    }

    showUserInfo() {
        const userInfo = document.getElementById('userInfo');
        const welcomeMessage = document.getElementById('welcomeMessage');
        
        if (userInfo && welcomeMessage && this.currentUser) {
            const childName = this.currentUser.childName || 'Player';
            const parentName = this.currentUser.parentName || 'Parent';
            
            welcomeMessage.textContent = `Welcome back, ${childName}! 👋`;
            userInfo.classList.remove('hidden');
            
            // Update email preferences if available
            if (window.emailIntegration && this.currentUser.email) {
                window.emailIntegration.setupEmailPreferences(
                    this.currentUser.email,
                    childName,
                    this.currentUser.emailPreferences || {}
                );
            }
        }
    }

    hideUserInfo() {
        const userInfo = document.getElementById('userInfo');
        if (userInfo) {
            userInfo.classList.add('hidden');
        }
    }

    setupLogoutButton() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.showLogoutConfirmation();
            });
        }
    }

    showLogoutConfirmation() {
        const modal = document.createElement('div');
        modal.className = 'logout-modal';
        modal.innerHTML = `
            <div class="logout-modal-content">
                <div class="logout-modal-header">
                    <h3>👋 Ready to go?</h3>
                </div>
                <div class="logout-modal-body">
                    <p>Are you sure you want to logout?</p>
                    <p><small>Your progress is automatically saved!</small></p>
                </div>
                <div class="logout-modal-actions">
                    <button class="logout-confirm-btn">Yes, Logout</button>
                    <button class="logout-cancel-btn">Stay Playing</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add event listeners
        modal.querySelector('.logout-confirm-btn').addEventListener('click', () => {
            modal.remove();
            this.logout();
        });
        
        modal.querySelector('.logout-cancel-btn').addEventListener('click', () => {
            modal.remove();
        });
        
        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        // Add styles
        this.addLogoutModalStyles();
    }

    logout() {
        this.clearSession();
        
        // Show logout success message
        this.showLogoutMessage();
        
        // Redirect to login after delay
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 2000);
        
        console.log('👋 User logged out successfully');
    }

    showLogoutMessage() {
        const message = document.createElement('div');
        message.className = 'logout-success-message';
        message.innerHTML = `
            <div class="logout-success-content">
                <h3>👋 See you later!</h3>
                <p>You've been logged out successfully.</p>
                <p>Your progress has been saved!</p>
                <div class="logout-loading">
                    <div class="spinner"></div>
                    <span>Redirecting to login...</span>
                </div>
            </div>
        `;
        
        document.body.appendChild(message);
        
        // Remove after redirect
        setTimeout(() => {
            if (message.parentNode) {
                message.remove();
            }
        }, 3000);
    }

    setupLoginRedirect() {
        // If not logged in and not on login page, show login prompt
        if (!this.isLoggedIn && !this.isLoginPage()) {
            if (window.SPELLBLOC_REQUIRE_AUTH) {
                window.location.href = '/login.html';
                return;
            }

            setTimeout(() => {
                this.showLoginPrompt();
            }, 5000); // Show after 5 seconds
        }
    }

    showLoginPrompt() {
        if (this.isLoggedIn) return; // Don't show if user logged in meanwhile
        
        const prompt = document.createElement('div');
        prompt.className = 'login-prompt';
        prompt.innerHTML = `
            <div class="login-prompt-content">
                <div class="login-prompt-header">
                    <h3>🎮 Ready to save your progress?</h3>
                </div>
                <div class="login-prompt-body">
                    <p>Create an account to:</p>
                    <ul>
                        <li>💾 Save your progress</li>
                        <li>🏆 Keep your achievements</li>
                        <li>📊 Get progress reports</li>
                        <li>🎯 Unlock personalized learning</li>
                    </ul>
                </div>
                <div class="login-prompt-actions">
                    <button class="login-prompt-signup">Create Account</button>
                    <button class="login-prompt-login">I Have Account</button>
                    <button class="login-prompt-later">Maybe Later</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(prompt);
        
        // Add event listeners
        prompt.querySelector('.login-prompt-signup').addEventListener('click', () => {
            window.location.href = '/login.html';
        });
        
        prompt.querySelector('.login-prompt-login').addEventListener('click', () => {
            window.location.href = '/login.html';
        });
        
        prompt.querySelector('.login-prompt-later').addEventListener('click', () => {
            prompt.remove();
            // Don't show again for this session
            sessionStorage.setItem('spellbloc_login_prompt_dismissed', 'true');
        });
        
        // Add styles
        this.addLoginPromptStyles();
    }

    addLogoutModalStyles() {
        if (document.getElementById('logout-modal-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'logout-modal-styles';
        styles.textContent = `
            .logout-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000;
            }
            
            .logout-modal-content {
                background: white;
                border-radius: 15px;
                max-width: 400px;
                width: 90%;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                overflow: hidden;
            }
            
            .logout-modal-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                text-align: center;
            }
            
            .logout-modal-header h3 {
                margin: 0;
                font-size: 1.3em;
            }
            
            .logout-modal-body {
                padding: 25px;
                text-align: center;
            }
            
            .logout-modal-body p {
                margin: 10px 0;
                color: #333;
            }
            
            .logout-modal-body small {
                color: #666;
            }
            
            .logout-modal-actions {
                padding: 0 25px 25px;
                display: grid;
                gap: 10px;
            }
            
            .logout-confirm-btn {
                background: #dc3545;
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.3s;
            }
            
            .logout-confirm-btn:hover {
                background: #c82333;
            }
            
            .logout-cancel-btn {
                background: #28a745;
                color: white;
                border: none;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.3s;
            }
            
            .logout-cancel-btn:hover {
                background: #218838;
            }
            
            .logout-success-message {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.9);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10001;
            }
            
            .logout-success-content {
                background: white;
                border-radius: 15px;
                padding: 40px;
                text-align: center;
                max-width: 400px;
                width: 90%;
            }
            
            .logout-success-content h3 {
                color: #28a745;
                margin-bottom: 15px;
            }
            
            .logout-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                margin-top: 20px;
                color: #666;
            }
            
            .spinner {
                width: 20px;
                height: 20px;
                border: 2px solid #e9ecef;
                border-top: 2px solid #667eea;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        
        document.head.appendChild(styles);
    }

    addLoginPromptStyles() {
        if (document.getElementById('login-prompt-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'login-prompt-styles';
        styles.textContent = `
            .login-prompt {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: white;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
                max-width: 350px;
                width: 90%;
                z-index: 9999;
                animation: slideIn 0.3s ease-out;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            .login-prompt-header {
                background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 15px 15px 0 0;
            }
            
            .login-prompt-header h3 {
                margin: 0;
                font-size: 1.1em;
            }
            
            .login-prompt-body {
                padding: 20px;
            }
            
            .login-prompt-body p {
                margin: 0 0 10px 0;
                color: #333;
                font-weight: 600;
            }
            
            .login-prompt-body ul {
                margin: 10px 0;
                padding-left: 20px;
                color: #666;
            }
            
            .login-prompt-body li {
                margin: 5px 0;
                font-size: 14px;
            }
            
            .login-prompt-actions {
                padding: 0 20px 20px;
                display: grid;
                gap: 8px;
            }
            
            .login-prompt-signup {
                background: #28a745;
                color: white;
                border: none;
                padding: 12px 15px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
            }
            
            .login-prompt-login {
                background: #667eea;
                color: white;
                border: none;
                padding: 12px 15px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
            }
            
            .login-prompt-later {
                background: #6c757d;
                color: white;
                border: none;
                padding: 10px 15px;
                border-radius: 8px;
                font-size: 12px;
                cursor: pointer;
            }
            
            @media (max-width: 600px) {
                .login-prompt {
                    bottom: 10px;
                    right: 10px;
                    left: 10px;
                    max-width: none;
                }
            }
        `;
        
        document.head.appendChild(styles);
    }

    // Public methods
    getCurrentUser() {
        return this.currentUser;
    }

    isUserLoggedIn() {
        return this.isLoggedIn;
    }

    refreshUserData() {
        return this.checkAuthStatus();
    }
}

// Add user info styles to main CSS
function addUserInfoStyles() {
    if (document.getElementById('user-info-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'user-info-styles';
    styles.textContent = `
        .user-info {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 15px 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        
        .user-welcome {
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 10px;
        }
        
        .user-welcome span {
            font-size: 1.1em;
            font-weight: 600;
        }
        
        .logout-btn {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            padding: 8px 15px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .logout-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-1px);
        }
        
        .hidden {
            display: none !important;
        }
        
        @media (max-width: 600px) {
            .user-welcome {
                flex-direction: column;
                text-align: center;
            }
            
            .logout-btn {
                margin-top: 5px;
            }
        }
    `;
    
    document.head.appendChild(styles);
}

// Initialize Auth Manager
let authManager = null;

document.addEventListener('DOMContentLoaded', () => {
    // Add styles first
    addUserInfoStyles();
    
    // Initialize auth manager
    setTimeout(() => {
        authManager = new AuthManager();
        window.authManager = authManager; // Make globally available
        
        console.log('🔐 Authentication system ready');
    }, 1000);
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthManager;
}

console.log('🔐 Auth Manager loaded');
