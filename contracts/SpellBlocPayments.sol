// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/// @notice Parent subscriptions paid in cUSD. This contract never accepts native CELO.
contract SpellBlocPayments is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    enum PlanType { MONTHLY, YEARLY, FAMILY }
    struct Subscription { address user; PlanType planType; uint256 startTime; uint256 endTime; bool active; uint256 amountPaid; }

    IERC20 public immutable paymentToken;
    mapping(address => Subscription) public subscriptions;
    mapping(PlanType => uint256) public planPrices;
    uint256 public totalRevenue;
    uint256 public totalSubscribers;

    event SubscriptionPurchased(address indexed user, PlanType planType, uint256 duration, uint256 amount);
    event SubscriptionRenewed(address indexed user, uint256 newEndTime, uint256 amount);
    event FundsWithdrawn(address indexed owner, uint256 amount);

    constructor(address cUSD) {
        require(cUSD != address(0), "cUSD address required");
        paymentToken = IERC20(cUSD);
        planPrices[PlanType.MONTHLY] = 2.5 ether;
        planPrices[PlanType.YEARLY] = 25 ether;
        planPrices[PlanType.FAMILY] = 40 ether;
    }

    function purchaseSubscription(PlanType planType) external nonReentrant whenNotPaused {
        uint256 price = planPrices[planType];
        require(price > 0, "Invalid plan type");
        // SafeERC20 makes false-returning and reverting tokens fail atomically.
        paymentToken.safeTransferFrom(msg.sender, address(this), price);
        uint256 duration = planType == PlanType.MONTHLY ? 30 days : 365 days;
        Subscription storage sub = subscriptions[msg.sender];
        if (sub.active && sub.endTime > block.timestamp) {
            sub.endTime += duration;
            sub.planType = planType;
            sub.amountPaid += price;
            emit SubscriptionRenewed(msg.sender, sub.endTime, price);
        } else {
            subscriptions[msg.sender] = Subscription(msg.sender, planType, block.timestamp, block.timestamp + duration, true, price);
            totalSubscribers++;
            emit SubscriptionPurchased(msg.sender, planType, duration, price);
        }
        totalRevenue += price;
    }

    function isSubscriptionActive(address user) external view returns (bool) {
        Subscription memory sub = subscriptions[user];
        return sub.active && sub.endTime > block.timestamp;
    }

    function updatePlanPrice(PlanType planType, uint256 price) external onlyOwner {
        require(price > 0, "Price must be greater than 0");
        planPrices[planType] = price;
    }

    function withdrawFunds(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= paymentToken.balanceOf(address(this)), "Insufficient token balance");
        paymentToken.safeTransfer(owner(), amount);
        emit FundsWithdrawn(owner(), amount);
    }

    function cancelSubscription(address user) external onlyOwner {
        subscriptions[user].active = false;
        subscriptions[user].endTime = block.timestamp;
    }
}
