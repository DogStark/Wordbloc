// MiniPay Payment Component for SpellBloc
class MiniPayPaymentModal {
    constructor() {
        this.isOpen = false;
        this.selectedPlan = null;
        this.payments = null;
    }

    // Initialize MiniPay integration
    async init() {
        // Import the MiniPay hook (in a real React app, this would be a hook)
        const { useSpellBlocPayments } = await import('./minipay-integration.js');
        this.payments = useSpellBlocPayments();
    }

    // Show payment modal
    show(planType = 'monthly') {
        this.selectedPlan = planType;
        this.isOpen = true;
        this.render();
    }

    // Hide payment modal
    hide() {
        this.isOpen = false;
        const modal = document.getElementById('miniPayModal');
        if (modal) {
            modal.remove();
        }
    }

    // Render the payment modal
    render() {
        // Remove existing modal
        this.hide();

        if (!this.isOpen) return;

        const modal = document.createElement('div');
        modal.id = 'miniPayModal';
        modal.className = 'minipay-modal';
        
        const plan = this.payments?.subscriptionPlans[this.selectedPlan];
        if (!plan) return;

        modal.innerHTML = `
            <div class="modal-overlay" onclick="miniPayModal.hide()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>🚀 Upgrade to Premium</h2>
                    <button class="close-btn" onclick="miniPayModal.hide()">×</button>
                </div>
                
                <div class="plan-details">
                    <div class="plan-card selected">
                        <div class="plan-name">${plan.name}</div>
                        <div class="plan-price">${plan.price} cUSD</div>
                        <div class="plan-duration">${plan.duration} days</div>
                        <div class="plan-features">
                            ${plan.features.map(feature => `<div class="feature">✓ ${feature}</div>`).join('')}
                        </div>
                    </div>
                </div>

                <div class="payment-section">
                    <div class="wallet-status">
                        ${this.payments?.isConnected ? `
                            <div class="connected">
                                <div class="wallet-info">
                                    <span class="wallet-icon">💰</span>
                                    <span class="balance">${this.payments.balance} cUSD</span>
                                </div>
                                <div class="address">${this.shortenAddress(this.payments.account)}</div>
                            </div>
                        ` : `
                            <div class="not-connected">
                                <div class="connect-message">Connect MiniPay to continue</div>
                                <button class="connect-btn" onclick="miniPayModal.connectWallet()">
                                    Connect MiniPay Wallet
                                </button>
                            </div>
                        `}
                    </div>

                    ${this.payments?.isConnected ? `
                        <div class="payment-actions">
                            <button class="purchase-btn" onclick="miniPayModal.purchaseSubscription()" 
                                    ${this.payments.loading ? 'disabled' : ''}>
                                ${this.payments.loading ? 'Processing...' : `Pay ${plan.price} cUSD`}
                            </button>
                            
                            ${parseFloat(this.payments.balance) < parseFloat(plan.price) ? `
                                <div class="insufficient-funds">
                                    ⚠️ Insufficient cUSD balance. You need ${plan.price} cUSD.
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>

                <div class="payment-info">
                    <div class="info-item">
                        <span class="icon">🔒</span>
                        <span>Secure payment via MiniPay</span>
                    </div>
                    <div class="info-item">
                        <span class="icon">⚡</span>
                        <span>Instant activation</span>
                    </div>
                    <div class="info-item">
                        <span class="icon">🌱</span>
                        <span>Eco-friendly Celo blockchain</span>
                    </div>
                </div>

                ${this.payments?.error ? `
                    <div class="error-message">
                        ❌ ${this.payments.error}
                    </div>
                ` : ''}
            </div>
        `;

        document.body.appendChild(modal);
    }

    // Connect MiniPay wallet
    async connectWallet() {
        try {
            await this.payments.connectMiniPay();
            this.render(); // Re-render with connected state
        } catch (error) {
            console.error('Failed to connect MiniPay:', error);
            this.showError('Failed to connect MiniPay. Please try again.');
        }
    }

    // Purchase subscription
    async purchaseSubscription() {
        if (!this.payments?.isConnected) {
            this.showError('Please connect your MiniPay wallet first.');
            return;
        }

        try {
            const result = await this.payments.purchaseSubscription(this.selectedPlan);
            
            if (result.success) {
                this.showSuccess();
                
                // Update subscription status in the game
                subscriptionType = 'premium';
                updateSubscriptionDisplay();
                
                // Close modal after success
                setTimeout(() => {
                    this.hide();
                }, 3000);
            }
        } catch (error) {
            console.error('Purchase failed:', error);
            this.showError(error.message || 'Purchase failed. Please try again.');
        }
    }

    // Show success message
    showSuccess() {
        const modal = document.getElementById('miniPayModal');
        if (!modal) return;

        const content = modal.querySelector('.modal-content');
        content.innerHTML = `
            <div class="success-content">
                <div class="success-icon">🎉</div>
                <h2>Welcome to Premium!</h2>
                <p>Your subscription has been activated successfully!</p>
                <div class="success-features">
                    <div>✅ Unlimited hints unlocked</div>
                    <div>✅ All game modes available</div>
                    <div>✅ Detailed progress analytics</div>
                    <div>✅ Priority support</div>
                </div>
                <button class="continue-btn" onclick="miniPayModal.hide()">
                    Continue Learning! 🚀
                </button>
            </div>
        `;
    }

    // Show error message
    showError(message) {
        const errorDiv = document.querySelector('.error-message');
        if (errorDiv) {
            errorDiv.textContent = `❌ ${message}`;
            errorDiv.style.display = 'block';
        }
    }

    // Utility function to shorten address
    shortenAddress(address) {
        if (!address) return '';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
}

// Global instance
const miniPayModal = new MiniPayPaymentModal();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    miniPayModal.init();
});

// Add to existing upgrade button functionality
function showUpgradeModal() {
    miniPayModal.show('monthly');
}

// Add premium subscription check
function isPremiumUser() {
    const subscription = miniPayModal.payments?.getSubscriptionStatus();
    return subscription?.isActive || false;
}

// Enhanced hint function with premium check
function showHint() {
    if (!isPremiumUser()) {
        showUpgradeModal();
        return;
    }
    
    const hintText = `The word starts with "${currentWord[0].toUpperCase()}"`;
    feedback.textContent = `💡 Hint: ${hintText}`;
    feedback.className = 'feedback hint';
    
    setTimeout(() => {
        feedback.textContent = '';
        feedback.className = 'feedback';
    }, 3000);
}