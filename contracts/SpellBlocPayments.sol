// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title SpellBlocPayments
 * @dev Handles subscription payments and premium features for SpellBloc
 * Deployed on Celo mainnet for MiniPay integration
 */
contract SpellBlocPayments is ReentrancyGuard, Ownable, Pausable {
    
    // Subscription plan types
    enum PlanType { MONTHLY, YEARLY, FAMILY }
    
    // Subscription structure
    struct Subscription {
        address user;
        PlanType planType;
        uint256 startTime;
        uint256 endTime;
        bool active;
        uint256 amountPaid;
    }
    
    // Achievement NFT purchase structure
    struct AchievementPurchase {
        address user;
        uint256 achievementId;
        uint256 amountPaid;
        uint256 timestamp;
    }
    
    // State variables
    mapping(address => Subscription) public subscriptions;
    mapping(PlanType => uint256) public planPrices;
    mapping(uint256 => uint256) public achievementPrices;
    mapping(address => AchievementPurchase[]) public userAchievements;
    
    uint256 public totalRevenue;
    uint256 public totalSubscribers;
    uint256 public totalAchievementsSold;
    
    // Events
    event SubscriptionPurchased(
        address indexed user, 
        PlanType planType, 
        uint256 duration, 
        uint256 amount
    );
    
    event SubscriptionRenewed(
        address indexed user, 
        uint256 newEndTime, 
        uint256 amount
    );
    
    event AchievementPurchased(
        address indexed user, 
        uint256 achievementId, 
        uint256 amount
    );
    
    event PriceUpdated(
        PlanType planType, 
        uint256 oldPrice, 
        uint256 newPrice
    );
    
    event FundsWithdrawn(
        address indexed owner, 
        uint256 amount
    );
    
    /**
     * @dev Constructor sets initial subscription prices in wei (cUSD has 18 decimals)
     */
    constructor() {
        // Set initial prices (in wei, 18 decimals for cUSD)
        planPrices[PlanType.MONTHLY] = 2.5 * 10**18;  // 2.5 cUSD
        planPrices[PlanType.YEARLY] = 25 * 10**18;    // 25 cUSD (2 months free)
        planPrices[PlanType.FAMILY] = 40 * 10**18;    // 40 cUSD (up to 4 children)
        
        // Set achievement prices
        achievementPrices[1] = 0.5 * 10**18;  // Special badge: 0.5 cUSD
        achievementPrices[2] = 1.0 * 10**18;  // Rare badge: 1.0 cUSD
        achievementPrices[3] = 2.0 * 10**18;  // Epic badge: 2.0 cUSD
    }
    
    /**
     * @dev Purchase a subscription plan
     * @param _planType The type of subscription plan
     */
    function purchaseSubscription(PlanType _planType) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(msg.value >= planPrices[_planType], "Insufficient payment");
        require(_planType <= PlanType.FAMILY, "Invalid plan type");
        
        uint256 duration;
        if (_planType == PlanType.MONTHLY) {
            duration = 30 days;
        } else {
            duration = 365 days; // Both yearly and family are 1 year
        }
        
        // Check if user has existing subscription
        Subscription storage existingSub = subscriptions[msg.sender];
        
        if (existingSub.active && existingSub.endTime > block.timestamp) {
            // Extend existing subscription
            existingSub.endTime += duration;
            existingSub.planType = _planType; // Upgrade/downgrade plan
            existingSub.amountPaid += msg.value;
            
            emit SubscriptionRenewed(msg.sender, existingSub.endTime, msg.value);
        } else {
            // Create new subscription
            subscriptions[msg.sender] = Subscription({
                user: msg.sender,
                planType: _planType,
                startTime: block.timestamp,
                endTime: block.timestamp + duration,
                active: true,
                amountPaid: msg.value
            });
            
            totalSubscribers++;
            emit SubscriptionPurchased(msg.sender, _planType, duration, msg.value);
        }
        
        totalRevenue += msg.value;
        
        // Refund excess payment
        if (msg.value > planPrices[_planType]) {
            payable(msg.sender).transfer(msg.value - planPrices[_planType]);
        }
    }
    
    /**
     * @dev Purchase a special achievement NFT
     * @param _achievementId The ID of the achievement to purchase
     */
    function purchaseAchievement(uint256 _achievementId) 
        external 
        payable 
        nonReentrant 
        whenNotPaused 
    {
        require(achievementPrices[_achievementId] > 0, "Achievement not available");
        require(msg.value >= achievementPrices[_achievementId], "Insufficient payment");
        
        // Record the purchase
        userAchievements[msg.sender].push(AchievementPurchase({
            user: msg.sender,
            achievementId: _achievementId,
            amountPaid: msg.value,
            timestamp: block.timestamp
        }));
        
        totalRevenue += msg.value;
        totalAchievementsSold++;
        
        emit AchievementPurchased(msg.sender, _achievementId, msg.value);
        
        // Refund excess payment
        if (msg.value > achievementPrices[_achievementId]) {
            payable(msg.sender).transfer(msg.value - achievementPrices[_achievementId]);
        }
    }
    
    /**
     * @dev Check if a user has an active subscription
     * @param user The user address to check
     * @return bool Whether the user has an active subscription
     */
    function isSubscriptionActive(address user) external view returns (bool) {
        Subscription memory sub = subscriptions[user];
        return sub.active && sub.endTime > block.timestamp;
    }
    
    /**
     * @dev Get subscription details for a user
     * @param user The user address
     * @return Subscription details
     */
    function getSubscription(address user) external view returns (Subscription memory) {
        return subscriptions[user];
    }
    
    /**
     * @dev Get user's purchased achievements
     * @param user The user address
     * @return Array of achievement purchases
     */
    function getUserAchievements(address user) external view returns (AchievementPurchase[] memory) {
        return userAchievements[user];
    }
    
    /**
     * @dev Get contract statistics
     * @return totalRevenue, totalSubscribers, totalAchievementsSold
     */
    function getStats() external view returns (uint256, uint256, uint256) {
        return (totalRevenue, totalSubscribers, totalAchievementsSold);
    }
    
    // Admin functions
    
    /**
     * @dev Update subscription plan price (only owner)
     * @param _planType The plan type to update
     * @param _newPrice The new price in wei
     */
    function updatePlanPrice(PlanType _planType, uint256 _newPrice) external onlyOwner {
        require(_newPrice > 0, "Price must be greater than 0");
        
        uint256 oldPrice = planPrices[_planType];
        planPrices[_planType] = _newPrice;
        
        emit PriceUpdated(_planType, oldPrice, _newPrice);
    }
    
    /**
     * @dev Update achievement price (only owner)
     * @param _achievementId The achievement ID
     * @param _newPrice The new price in wei
     */
    function updateAchievementPrice(uint256 _achievementId, uint256 _newPrice) external onlyOwner {
        achievementPrices[_achievementId] = _newPrice;
    }
    
    /**
     * @dev Withdraw contract funds (only owner)
     * @param _amount Amount to withdraw in wei
     */
    function withdrawFunds(uint256 _amount) external onlyOwner nonReentrant {
        require(_amount <= address(this).balance, "Insufficient contract balance");
        require(_amount > 0, "Amount must be greater than 0");
        
        payable(owner()).transfer(_amount);
        emit FundsWithdrawn(owner(), _amount);
    }
    
    /**
     * @dev Emergency withdraw all funds (only owner)
     */
    function emergencyWithdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        payable(owner()).transfer(balance);
        emit FundsWithdrawn(owner(), balance);
    }
    
    /**
     * @dev Pause contract (only owner)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause contract (only owner)
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Cancel a user's subscription (only owner, for refunds/disputes)
     * @param user The user whose subscription to cancel
     */
    function cancelSubscription(address user) external onlyOwner {
        require(subscriptions[user].active, "No active subscription");
        
        subscriptions[user].active = false;
        subscriptions[user].endTime = block.timestamp;
    }
    
    /**
     * @dev Get contract balance
     * @return Contract balance in wei
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Fallback function to receive cUSD
     */
    receive() external payable {
        totalRevenue += msg.value;
    }
}