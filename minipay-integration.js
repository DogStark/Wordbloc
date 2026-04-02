// MiniPay Integration Hook for SpellBloc
import { useState, useEffect, useCallback } from 'react';

export const useSpellBlocPayments = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [account, setAccount] = useState(null);
    const [balance, setBalance] = useState('0');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Contract addresses (will be updated after deployment)
    const SPELLBLOC_PAYMENT_CONTRACT = process.env.NEXT_PUBLIC_PAYMENT_CONTRACT || '0x...';
    const CUSD_TOKEN_ADDRESS = '0x765DE816845861e75A25fCA122bb6898B8B1282a'; // Celo mainnet cUSD

    // Subscription plans with prices in CUSD
    const SUBSCRIPTION_PLANS = {
        monthly: {
            price: '2.5',
            duration: 30,
            name: 'Monthly Premium',
            features: ['Unlimited hints', 'All game modes', 'Progress analytics']
        },
        yearly: {
            price: '25',
            duration: 365,
            name: 'Yearly Premium',
            features: ['All monthly features', '2 months free', 'Priority support']
        },
        family: {
            price: '40',
            duration: 365,
            name: 'Family Plan',
            features: ['Up to 4 children', 'All premium features', 'Teacher dashboard']
        }
    };

    // Initialize MiniPay connection
    const connectMiniPay = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            // Check if MiniPay is available
            if (typeof window !== 'undefined' && window.ethereum) {
                // Request account access
                const accounts = await window.ethereum.request({
                    method: 'eth_requestAccounts'
                });

                if (accounts.length > 0) {
                    setAccount(accounts[0]);
                    setIsConnected(true);
                    
                    // Get cUSD balance
                    await updateBalance(accounts[0]);
                    
                    console.log('✅ MiniPay connected:', accounts[0]);
                }
            } else {
                throw new Error('MiniPay not detected. Please use MiniPay browser.');
            }
        } catch (err) {
            console.error('❌ MiniPay connection failed:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Update cUSD balance
    const updateBalance = useCallback(async (address) => {
        try {
            if (!window.ethereum) return;

            const balanceHex = await window.ethereum.request({
                method: 'eth_call',
                params: [{
                    to: CUSD_TOKEN_ADDRESS,
                    data: `0x70a08231000000000000000000000000${address.slice(2)}`
                }, 'latest']
            });

            const balanceWei = parseInt(balanceHex, 16);
            const balanceCUSD = (balanceWei / 1e18).toFixed(2);
            setBalance(balanceCUSD);
        } catch (err) {
            console.error('❌ Balance update failed:', err);
        }
    }, []);

    // Purchase subscription
    const purchaseSubscription = useCallback(async (planType) => {
        if (!isConnected || !account) {
            throw new Error('Please connect MiniPay first');
        }

        const plan = SUBSCRIPTION_PLANS[planType];
        if (!plan) {
            throw new Error('Invalid subscription plan');
        }

        setLoading(true);
        setError(null);

        try {
            console.log(`🛒 Purchasing ${plan.name} for ${plan.price} cUSD...`);

            // Convert price to wei (18 decimals)
            const priceWei = (parseFloat(plan.price) * 1e18).toString(16);

            // Send transaction via MiniPay
            const txHash = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{
                    from: account,
                    to: SPELLBLOC_PAYMENT_CONTRACT,
                    value: `0x${priceWei}`,
                    gas: '0x5208', // 21000 gas
                    gasPrice: '0x3B9ACA00' // 1 gwei
                }]
            });

            console.log('✅ Transaction sent:', txHash);

            // Wait for confirmation
            await waitForTransaction(txHash);

            // Update balance
            await updateBalance(account);

            // Store subscription locally
            const subscription = {
                planType,
                txHash,
                startDate: new Date().toISOString(),
                endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000).toISOString(),
                active: true
            };

            localStorage.setItem('spellbloc_subscription', JSON.stringify(subscription));

            return {
                success: true,
                txHash,
                subscription
            };

        } catch (err) {
            console.error('❌ Purchase failed:', err);
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [isConnected, account, updateBalance]);

    // Wait for transaction confirmation
    const waitForTransaction = useCallback(async (txHash) => {
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout

        while (attempts < maxAttempts) {
            try {
                const receipt = await window.ethereum.request({
                    method: 'eth_getTransactionReceipt',
                    params: [txHash]
                });

                if (receipt && receipt.status === '0x1') {
                    console.log('✅ Transaction confirmed:', txHash);
                    return receipt;
                }
            } catch (err) {
                console.log('⏳ Waiting for confirmation...');
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        throw new Error('Transaction confirmation timeout');
    }, []);

    // Get current subscription status
    const getSubscriptionStatus = useCallback(() => {
        try {
            const stored = localStorage.getItem('spellbloc_subscription');
            if (!stored) return null;

            const subscription = JSON.parse(stored);
            const now = new Date();
            const endDate = new Date(subscription.endDate);

            return {
                ...subscription,
                isActive: subscription.active && endDate > now,
                daysRemaining: Math.max(0, Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)))
            };
        } catch (err) {
            console.error('❌ Subscription status error:', err);
            return null;
        }
    }, []);

    return {
        isConnected,
        account,
        balance,
        loading,
        error,
        connectMiniPay,
        purchaseSubscription,
        getSubscriptionStatus,
        subscriptionPlans: SUBSCRIPTION_PLANS
    };
};

// Utility functions
export const formatCUSD = (amount) => {
    return `${parseFloat(amount).toFixed(2)} cUSD`;
};

export const shortenAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
};