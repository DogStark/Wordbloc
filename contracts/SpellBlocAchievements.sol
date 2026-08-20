// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

/**
 * @title SpellBlocAchievements
 * @dev NFT contract for SpellBloc learning achievements.
 *
 * SOULBOUND SEMANTICS
 * -------------------
 * Each achievement template carries a `soulbound` flag. When that flag is
 * true, any ERC-721 transfer (transferFrom / safeTransferFrom) by anyone
 * other than the contract itself is rejected. Minting (from == address(0))
 * is always allowed. Burning a soulbound token can only be performed by the
 * contract owner via `adminBurn` — this is the sole supported recovery path
 * (e.g., wallet compromise, account migration with consent).
 *
 * TRANSFERABLE ACHIEVEMENTS
 * -------------------------
 * When `soulbound` is false (purchasable specials such as "Golden Star"),
 * ERC-721 transfers work normally. All ownership-indexing state
 * (userAchievements, hasAchievement, userAchievementCount, totalHolders) is
 * updated consistently on every transfer and burn via `_afterTokenTransfer`.
 *
 * TOKEN → ACHIEVEMENT LOOKUP
 * --------------------------
 * `tokenAchievementId[tokenId]` is set immutably at mint time and is
 * readable by any caller.
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
        bool purchasable;          // Can be bought with native value
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

    /**
     * @notice Immutable token-to-template lookup.
     * Set once at mint time; never changed afterwards.
     * Allows any caller to determine which achievement template a token
     * represents without relying on off-chain data.
     */
    mapping(uint256 => uint256) public tokenAchievementId;
    
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

    /**
     * @notice Emitted when a non-soulbound achievement token is transferred
     * between two non-zero addresses. Suitable for off-chain indexers that
     * need to track ownership changes without re-scanning all ERC-721 Transfer
     * events.
     */
    event AchievementTransferred(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId,
        uint256 achievementId
    );

    /**
     * @notice Emitted when a token is burned (to == address(0)).
     * Covers both admin burns of soulbound tokens and any future burn paths
     * for transferable tokens.
     */
    event AchievementBurned(
        address indexed from,
        uint256 indexed tokenId,
        uint256 achievementId
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
            0.5 * 10**18, // 0.5 native (CELO on mainnet)
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
            2.0 * 10**18, // 2.0 native (CELO on mainnet)
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

    // -----------------------------------------------------------------------
    // Internal indexing helpers
    // -----------------------------------------------------------------------

    /**
     * @dev Add `tokenId` to `user`'s ownership index and update
     * userAchievementCount / totalHolders.
     */
    function _addToOwnerIndex(address user, uint256 tokenId) private {
        userAchievements[user].push(tokenId);
        if (userAchievementCount[user] == 0) {
            totalHolders++;
        }
        userAchievementCount[user]++;
    }

    /**
     * @dev Remove `tokenId` from `user`'s ownership array (swap-and-pop),
     * decrement userAchievementCount, and decrement totalHolders if the user
     * no longer holds any tokens.
     */
    function _removeFromOwnerIndex(address user, uint256 tokenId) private {
        uint256[] storage arr = userAchievements[user];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == tokenId) {
                arr[i] = arr[len - 1];
                arr.pop();
                break;
            }
        }
        if (userAchievementCount[user] > 0) {
            userAchievementCount[user]--;
        }
        if (userAchievementCount[user] == 0 && totalHolders > 0) {
            totalHolders--;
        }
    }

    // -----------------------------------------------------------------------
    // Mint
    // -----------------------------------------------------------------------
    
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

        // Record immutable token → template relationship before minting so
        // that _beforeTokenTransfer can read it even during the safeMint call.
        tokenAchievementId[tokenId] = achievementId;
        
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataUri);
        
        // Update mappings
        hasAchievement[to][achievementId] = true;
        achievement.totalMinted++;
        
        // Track first achiever
        if (achievement.totalMinted == 1) {
            achievementCreator[achievementId] = to;
        }
        
        // userAchievements / count / totalHolders are updated in
        // _afterTokenTransfer to keep a single authoritative code path.
        
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

        // Record immutable token → template relationship before minting.
        tokenAchievementId[tokenId] = achievementId;
        
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataUri);
        
        // Update mappings
        hasAchievement[msg.sender][achievementId] = true;
        achievement.totalMinted++;
        
        // userAchievements / count / totalHolders are updated in
        // _afterTokenTransfer.
        
        emit AchievementPurchased(msg.sender, achievementId, msg.value);
        emit AchievementMinted(msg.sender, tokenId, achievementId, achievement.name);
        
        // Refund excess payment
        if (msg.value > achievement.price) {
            payable(msg.sender).transfer(msg.value - achievement.price);
        }
    }

    // -----------------------------------------------------------------------
    // Admin burn (soulbound recovery)
    // -----------------------------------------------------------------------

    /**
     * @notice Burn a token that belongs to `holder`.
     *
     * This is the ONLY supported burn path for soulbound tokens. It is
     * intentionally restricted to the contract owner and should be used
     * only in documented recovery scenarios (e.g., a child's custodial
     * wallet is compromised and a replacement is being issued).
     *
     * For transferable tokens (soulbound == false) the owner may also call
     * this to revoke a token administratively.
     *
     * All ownership-index state (userAchievements, hasAchievement,
     * userAchievementCount, totalHolders) is cleaned up atomically via
     * _afterTokenTransfer.
     *
     * @param holder  Current owner of the token
     * @param tokenId Token to burn
     */
    function adminBurn(address holder, uint256 tokenId) external onlyOwner {
        require(ownerOf(tokenId) == holder, "Token not owned by holder");
        _burn(tokenId);
    }
    
    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

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
    
    // -----------------------------------------------------------------------
    // Admin functions
    // -----------------------------------------------------------------------
    
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
    
    // -----------------------------------------------------------------------
    // ERC-721 hook overrides
    // -----------------------------------------------------------------------
    
    /**
     * @dev Enforce soulbound restrictions and the Pausable guard.
     *
     * Rules:
     *  - Mint (from == address(0)): always allowed (subject to whenNotPaused
     *    guard on the external entry points).
     *  - Burn  (to   == address(0)): always allowed here; the public surface
     *    is restricted to `adminBurn` (onlyOwner).
     *  - Transfer (both addresses non-zero): reverts when the underlying
     *    achievement template is soulbound.
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        
        // Pure transfer — neither mint nor burn.
        if (from != address(0) && to != address(0)) {
            uint256 achId = tokenAchievementId[tokenId];
            require(
                !achievements[achId].soulbound,
                "Achievement is soulbound and cannot be transferred"
            );
        }
    }

    /**
     * @dev Maintain ownership-index state after every token movement.
     *
     * This is the single authoritative place where userAchievements,
     * userAchievementCount, totalHolders, and hasAchievement are updated
     * for transfers and burns. Mints are also handled here so that both
     * mintAchievement and purchaseAchievement share the same code path.
     *
     * Cases:
     *  - Mint  (from == address(0)): add token to recipient's index.
     *  - Burn  (to   == address(0)): remove token from sender's index,
     *    clear hasAchievement for that sender.
     *  - Transfer: remove from sender's index (clear hasAchievement),
     *    add to recipient's index (set hasAchievement), emit
     *    AchievementTransferred.
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        super._afterTokenTransfer(from, to, tokenId, batchSize);

        uint256 achId = tokenAchievementId[tokenId];

        if (from == address(0)) {
            // ── Mint ──────────────────────────────────────────────────────
            _addToOwnerIndex(to, tokenId);
            // hasAchievement[to][achId] is already set by the mint function
            // before _safeMint is called, so we do not set it again here.

        } else if (to == address(0)) {
            // ── Burn ──────────────────────────────────────────────────────
            _removeFromOwnerIndex(from, tokenId);
            hasAchievement[from][achId] = false;
            emit AchievementBurned(from, tokenId, achId);

        } else {
            // ── Transfer (non-soulbound, already validated in _before) ────
            _removeFromOwnerIndex(from, tokenId);
            hasAchievement[from][achId] = false;

            _addToOwnerIndex(to, tokenId);
            hasAchievement[to][achId] = true;

            emit AchievementTransferred(from, to, tokenId, achId);
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
     * @dev Receive function to accept native-value payments for purchasable
     * achievements. On Celo mainnet this is CELO; on Alfajores testnet this
     * is test CELO. The purchasable achievement price fields are denominated
     * in the same unit (wei-equivalent of the native asset).
     */
    receive() external payable {}
}