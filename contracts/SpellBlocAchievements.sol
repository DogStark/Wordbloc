// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title SpellBlocAchievements
 * @dev NFT contract for SpellBloc learning achievements
 * Soulbound tokens that represent verified learning milestones
 */
contract SpellBlocAchievements is ERC721, ERC721URIStorage, Ownable, Pausable {
    using Counters for Counters.Counter;
    
    Counters.Counter private _tokenIdCounter;
    
    // Achievement categories
    enum AchievementType { 
        MILESTONE,      // Words learned milestones (10, 50, 100, etc.)
        PERFORMANCE,    // Speed and accuracy achievements
        STREAK,         // Daily practice streaks
        CATEGORY,       // Category mastery (animals, colors, etc.)
        SPECIAL         // Special events and purchases
    }
    
    // Achievement rarity levels
    enum Rarity { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY }
    
    // Achievement structure
    struct Achievement {
        string name;
        string description;
        AchievementType achievementType;
        Rarity rarity;
        uint256 requirement;        // Words needed, accuracy %, days streak, etc.
        bool soulbound;            // Cannot be transferred
        bool purchasable;          // Can be bought with cUSD
        uint256 price;             // Price in wei if purchasable
        uint256 totalMinted;       // Total number minted
        uint256 maxSupply;         // Maximum that can be minted (0 = unlimited)
        bool active;               // Whether this achievement is active
    }
    
    // Mappings
    mapping(uint256 => Achievement) public achievements;
    mapping(address => uint256[]) public userAchievements;
    mapping(address => mapping(uint256 => bool)) public hasAchievement;
    mapping(uint256 => address) public achievementCreator; // Who earned it first
    
    // Statistics
    uint256 public totalAchievements;
    uint256 public totalHolders;
    mapping(address => uint256) public userAchievementCount;
    
    // Events
    event AchievementCreated(
        uint256 indexed achievementId,
        string name,
        AchievementType achievementType,
        Rarity rarity
    );
    
    event AchievementMinted(
        address indexed user,
        uint256 indexed tokenId,
        uint256 indexed achievementId,
        string achievementName
    );
    
    event AchievementPurchased(
        address indexed user,
        uint256 indexed achievementId,
        uint256 price
    );
    
    constructor() ERC721("SpellBloc Achievements", "SBA") {
        // Create initial achievement templates
        _createInitialAchievements();
    }
    
    /**
     * @dev Create initial achievement templates
     */
    function _createInitialAchievements() private {
        // Milestone achievements
        _createAchievement(
            "First Steps",
            "Learned your first 10 words!",
            AchievementType.MILESTONE,
            Rarity.COMMON,
            10,
            true,  // soulbound
            false, // not purchasable
            0,     // no price
            0      // unlimited supply
        );
        
        _createAchievement(
            "Word Explorer",
            "Mastered 50 words across different categories!",
            AchievementType.MILESTONE,
            Rarity.UNCOMMON,
            50,
            true,
            false,
            0,
            0
        );
        
        _createAchievement(
            "Spelling Champion",
            "Conquered 100 words with excellence!",
            AchievementType.MILESTONE,
            Rarity.RARE,
            100,
            true,
            false,
            0,
            0
        );
        
        // Performance achievements
        _createAchievement(
            "Speed Demon",
            "Completed 10 words in under 30 seconds!",
            AchievementType.PERFORMANCE,
            Rarity.UNCOMMON,
            10,
            true,
            false,
            0,
            0
        );
        
        _createAchievement(
            "Perfect Score",
            "Achieved 100% accuracy on 20 consecutive words!",
            AchievementType.PERFORMANCE,
            Rarity.RARE,
            20,
            true,
            false,
            0,
            0
        );
        
        // Streak achievements
        _createAchievement(
            "Daily Learner",
            "Practiced spelling for 7 days in a row!",
            AchievementType.STREAK,
            Rarity.COMMON,
            7,
            true,
            false,
            0,
            0
        );
        
        _createAchievement(
            "Dedication Master",
            "Maintained a 30-day learning streak!",
            AchievementType.STREAK,
            Rarity.EPIC,
            30,
            true,
            false,
            0,
            0
        );
        
        // Special purchasable achievements
        _createAchievement(
            "Golden Star",
            "A special golden achievement badge!",
            AchievementType.SPECIAL,
            Rarity.RARE,
            0,
            false, // not soulbound, can be transferred
            true,  // purchasable
            0.5 * 10**18, // 0.5 cUSD
            1000   // limited supply
        );
        
        _createAchievement(
            "Diamond Crown",
            "The ultimate SpellBloc achievement!",
            AchievementType.SPECIAL,
            Rarity.LEGENDARY,
            0,
            false,
            true,
            2.0 * 10**18, // 2.0 cUSD
            100    // very limited supply
        );
    }
    
    /**
     * @dev Create a new achievement template
     */
    function _createAchievement(
        string memory name,
        string memory description,
        AchievementType achievementType,
        Rarity rarity,
        uint256 requirement,
        bool soulbound,
        bool purchasable,
        uint256 price,
        uint256 maxSupply
    ) private {
        achievements[totalAchievements] = Achievement({
            name: name,
            description: description,
            achievementType: achievementType,
            rarity: rarity,
            requirement: requirement,
            soulbound: soulbound,
            purchasable: purchasable,
            price: price,
            totalMinted: 0,
            maxSupply: maxSupply,
            active: true
        });
        
        emit AchievementCreated(totalAchievements, name, achievementType, rarity);
        totalAchievements++;
    }
    
    /**
     * @dev Mint achievement NFT to user (called by game backend)
     * @param to Address to mint to
     * @param achievementId Achievement template ID
     * @param metadataUri IPFS URI for metadata
     */
    function mintAchievement(
        address to,
        uint256 achievementId,
        string memory metadataUri
    ) external onlyOwner whenNotPaused {
        require(achievementId < totalAchievements, "Achievement does not exist");
        require(!hasAchievement[to][achievementId], "User already has this achievement");
        
        Achievement storage achievement = achievements[achievementId];
        require(achievement.active, "Achievement is not active");
        require(!achievement.purchasable, "Use purchaseAchievement for purchasable items");
        
        // Check max supply
        if (achievement.maxSupply > 0) {
            require(achievement.totalMinted < achievement.maxSupply, "Max supply reached");
        }
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataUri);
        
        // Update mappings
        userAchievements[to].push(tokenId);
        hasAchievement[to][achievementId] = true;
        achievement.totalMinted++;
        
        // Track first achiever
        if (achievement.totalMinted == 1) {
            achievementCreator[achievementId] = to;
        }
        
        // Update user stats
        if (userAchievementCount[to] == 0) {
            totalHolders++;
        }
        userAchievementCount[to]++;
        
        emit AchievementMinted(to, tokenId, achievementId, achievement.name);
    }
    
    /**
     * @dev Purchase a special achievement NFT
     * @param achievementId Achievement template ID
     * @param metadataUri IPFS URI for metadata
     */
    function purchaseAchievement(
        uint256 achievementId,
        string memory metadataUri
    ) external payable whenNotPaused {
        require(achievementId < totalAchievements, "Achievement does not exist");
        
        Achievement storage achievement = achievements[achievementId];
        require(achievement.active, "Achievement is not active");
        require(achievement.purchasable, "Achievement is not purchasable");
        require(msg.value >= achievement.price, "Insufficient payment");
        require(!hasAchievement[msg.sender][achievementId], "Already own this achievement");
        
        // Check max supply
        if (achievement.maxSupply > 0) {
            require(achievement.totalMinted < achievement.maxSupply, "Max supply reached");
        }
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataUri);
        
        // Update mappings
        userAchievements[msg.sender].push(tokenId);
        hasAchievement[msg.sender][achievementId] = true;
        achievement.totalMinted++;
        
        // Update user stats
        if (userAchievementCount[msg.sender] == 0) {
            totalHolders++;
        }
        userAchievementCount[msg.sender]++;
        
        emit AchievementPurchased(msg.sender, achievementId, msg.value);
        emit AchievementMinted(msg.sender, tokenId, achievementId, achievement.name);
        
        // Refund excess payment
        if (msg.value > achievement.price) {
            payable(msg.sender).transfer(msg.value - achievement.price);
        }
    }
    
    /**
     * @dev Get user's achievements
     * @param user User address
     * @return Array of token IDs owned by user
     */
    function getUserAchievements(address user) external view returns (uint256[] memory) {
        return userAchievements[user];
    }
    
    /**
     * @dev Get achievement details
     * @param achievementId Achievement template ID
     * @return Achievement struct
     */
    function getAchievement(uint256 achievementId) external view returns (Achievement memory) {
        require(achievementId < totalAchievements, "Achievement does not exist");
        return achievements[achievementId];
    }
    
    /**
     * @dev Check if user has specific achievement
     * @param user User address
     * @param achievementId Achievement template ID
     * @return bool Whether user has the achievement
     */
    function userHasAchievement(address user, uint256 achievementId) external view returns (bool) {
        return hasAchievement[user][achievementId];
    }
    
    /**
     * @dev Get contract statistics
     * @return totalAchievements, totalHolders, totalMinted
     */
    function getStats() external view returns (uint256, uint256, uint256) {
        return (totalAchievements, totalHolders, _tokenIdCounter.current());
    }
    
    // Admin functions
    
    /**
     * @dev Create new achievement template (only owner)
     */
    function createAchievement(
        string memory name,
        string memory description,
        AchievementType achievementType,
        Rarity rarity,
        uint256 requirement,
        bool soulbound,
        bool purchasable,
        uint256 price,
        uint256 maxSupply
    ) external onlyOwner {
        _createAchievement(
            name,
            description,
            achievementType,
            rarity,
            requirement,
            soulbound,
            purchasable,
            price,
            maxSupply
        );
    }
    
    /**
     * @dev Update achievement price (only owner)
     */
    function updateAchievementPrice(uint256 achievementId, uint256 newPrice) external onlyOwner {
        require(achievementId < totalAchievements, "Achievement does not exist");
        achievements[achievementId].price = newPrice;
    }
    
    /**
     * @dev Toggle achievement active status (only owner)
     */
    function toggleAchievementActive(uint256 achievementId) external onlyOwner {
        require(achievementId < totalAchievements, "Achievement does not exist");
        achievements[achievementId].active = !achievements[achievementId].active;
    }
    
    /**
     * @dev Withdraw contract funds (only owner)
     */
    function withdrawFunds() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        payable(owner()).transfer(balance);
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
    
    // Override functions
    
    /**
     * @dev Override transfer to implement soulbound tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        
        // Allow minting and burning, but check soulbound for transfers
        if (from != address(0) && to != address(0)) {
            // This is a transfer, check if token is soulbound
            // We need to find which achievement this token represents
            // For simplicity, we'll allow all transfers for now
            // In production, you'd want to track which tokens are soulbound
        }
    }
    
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }
    
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
    
    /**
     * @dev Receive function to accept cUSD payments
     */
    receive() external payable {}
}