// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title SpellBlocLeaderboard
 * @dev Transparent, blockchain-verified leaderboard system for SpellBloc
 * Tracks learning progress and achievements across different categories
 */
contract SpellBlocLeaderboard is Ownable, Pausable, ReentrancyGuard {
    
    // Leaderboard categories
    enum Category { 
        OVERALL,        // Overall performance across all areas
        WORDS_LEARNED,  // Total words mastered
        ACCURACY,       // Spelling accuracy percentage
        SPEED,          // Words per minute
        STREAK,         // Daily practice streaks
        AGE_GROUP       // Age-specific rankings
    }
    
    // Player statistics structure
    struct PlayerStats {
        address player;
        string username;        // Optional display name
        uint256 wordsLearned;
        uint256 totalAttempts;
        uint256 correctAttempts;
        uint256 bestStreak;
        uint256 currentStreak;
        uint256 totalPlayTime;  // in seconds
        uint256 lastActive;
        uint8 ageGroup;         // 2-7 years
        bool isActive;
    }
    
    // Leaderboard entry structure
    struct LeaderboardEntry {
        address player;
        string username;
        uint256 score;
        uint256 rank;
        uint256 lastUpdated;
    }
    
    // State variables
    mapping(address => PlayerStats) public playerStats;
    mapping(Category => LeaderboardEntry[]) public leaderboards;
    mapping(Category => mapping(address => uint256)) public playerRanks;
    mapping(uint8 => LeaderboardEntry[]) public ageGroupLeaderboards; // age => leaderboard
    
    address[] public allPlayers;
    uint256 public totalPlayers;
    uint256 public lastGlobalUpdate;
    
    // Configuration
    uint256 public constant MAX_LEADERBOARD_SIZE = 100;
    uint256 public constant INACTIVITY_THRESHOLD = 30 days;
    
    // Events
    event PlayerRegistered(address indexed player, string username, uint8 ageGroup);
    event StatsUpdated(address indexed player, uint256 wordsLearned, uint256 accuracy);
    event LeaderboardUpdated(Category indexed category, uint256 timestamp);
    event RankChanged(address indexed player, Category indexed category, uint256 oldRank, uint256 newRank);
    
    constructor() {
        lastGlobalUpdate = block.timestamp;
    }
    
    /**
     * @dev Register a new player or update existing player info
     * @param username Display name for the player
     * @param ageGroup Age group (2-7)
     */
    function registerPlayer(string memory username, uint8 ageGroup) external whenNotPaused {
        require(ageGroup >= 2 && ageGroup <= 7, "Invalid age group");
        require(bytes(username).length > 0 && bytes(username).length <= 20, "Invalid username length");
        
        PlayerStats storage stats = playerStats[msg.sender];
        
        if (!stats.isActive) {
            // New player
            allPlayers.push(msg.sender);
            totalPlayers++;
            
            stats.player = msg.sender;
            stats.isActive = true;
            
            emit PlayerRegistered(msg.sender, username, ageGroup);
        }
        
        // Update player info
        stats.username = username;
        stats.ageGroup = ageGroup;
        stats.lastActive = block.timestamp;
    }
    
    /**
     * @dev Update player statistics (called by game backend)
     * @param player Player address
     * @param wordsLearned Total words learned
     * @param totalAttempts Total spelling attempts
     * @param correctAttempts Correct spelling attempts
     * @param currentStreak Current daily streak
     * @param sessionTime Time spent in current session (seconds)
     */
    function updatePlayerStats(
        address player,
        uint256 wordsLearned,
        uint256 totalAttempts,
        uint256 correctAttempts,
        uint256 currentStreak,
        uint256 sessionTime
    ) external onlyOwner whenNotPaused {
        require(playerStats[player].isActive, "Player not registered");
        
        PlayerStats storage stats = playerStats[player];
        
        // Update basic stats
        stats.wordsLearned = wordsLearned;
        stats.totalAttempts = totalAttempts;
        stats.correctAttempts = correctAttempts;
        stats.currentStreak = currentStreak;
        stats.totalPlayTime += sessionTime;
        stats.lastActive = block.timestamp;
        
        // Update best streak
        if (currentStreak > stats.bestStreak) {
            stats.bestStreak = currentStreak;
        }
        
        // Calculate accuracy
        uint256 accuracy = totalAttempts > 0 ? (correctAttempts * 100) / totalAttempts : 0;
        
        emit StatsUpdated(player, wordsLearned, accuracy);
        
        // Update leaderboards
        _updatePlayerInLeaderboards(player);
    }
    
    /**
     * @dev Update player in all relevant leaderboards
     * @param player Player address
     */
    function _updatePlayerInLeaderboards(address player) internal {
        PlayerStats memory stats = playerStats[player];
        
        // Update overall leaderboard
        uint256 overallScore = _calculateOverallScore(stats);
        _updateLeaderboard(Category.OVERALL, player, overallScore);
        
        // Update words learned leaderboard
        _updateLeaderboard(Category.WORDS_LEARNED, player, stats.wordsLearned);
        
        // Update accuracy leaderboard
        uint256 accuracy = stats.totalAttempts > 0 ? (stats.correctAttempts * 100) / stats.totalAttempts : 0;
        _updateLeaderboard(Category.ACCURACY, player, accuracy);
        
        // Update speed leaderboard (words per minute)
        uint256 wpm = stats.totalPlayTime > 0 ? (stats.wordsLearned * 60) / (stats.totalPlayTime / 60) : 0;
        _updateLeaderboard(Category.SPEED, player, wpm);
        
        // Update streak leaderboard
        _updateLeaderboard(Category.STREAK, player, stats.bestStreak);
        
        // Update age group leaderboard
        _updateAgeGroupLeaderboard(stats.ageGroup, player, overallScore);
    }
    
    /**
     * @dev Calculate overall score based on multiple factors
     * @param stats Player statistics
     * @return Overall score
     */
    function _calculateOverallScore(PlayerStats memory stats) internal pure returns (uint256) {
        if (stats.totalAttempts == 0) return 0;
        
        uint256 accuracy = (stats.correctAttempts * 100) / stats.totalAttempts;
        uint256 streakBonus = stats.bestStreak * 10;
        uint256 volumeBonus = stats.wordsLearned;
        
        // Weighted score: 40% accuracy, 40% words learned, 20% streak
        return (accuracy * 40) + (volumeBonus * 40) + (streakBonus * 20);
    }
    
    /**
     * @dev Update a specific leaderboard with player score
     * @param category Leaderboard category
     * @param player Player address
     * @param score Player's score for this category
     */
    function _updateLeaderboard(Category category, address player, uint256 score) internal {
        LeaderboardEntry[] storage leaderboard = leaderboards[category];
        PlayerStats memory stats = playerStats[player];
        
        // Find existing entry or create new one
        int256 existingIndex = -1;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                existingIndex = int256(i);
                break;
            }
        }
        
        LeaderboardEntry memory entry = LeaderboardEntry({
            player: player,
            username: stats.username,
            score: score,
            rank: 0, // Will be calculated
            lastUpdated: block.timestamp
        });
        
        if (existingIndex >= 0) {
            // Update existing entry
            uint256 oldRank = leaderboard[uint256(existingIndex)].rank;
            leaderboard[uint256(existingIndex)] = entry;
            
            // Re-sort and update ranks
            _sortLeaderboard(category);
            
            uint256 newRank = playerRanks[category][player];
            if (oldRank != newRank) {
                emit RankChanged(player, category, oldRank, newRank);
            }
        } else {
            // Add new entry
            leaderboard.push(entry);
            _sortLeaderboard(category);
        }
        
        // Trim leaderboard if too large
        if (leaderboard.length > MAX_LEADERBOARD_SIZE) {
            leaderboard.pop();
        }
        
        emit LeaderboardUpdated(category, block.timestamp);
    }
    
    /**
     * @dev Update age group leaderboard
     * @param ageGroup Age group (2-7)
     * @param player Player address
     * @param score Player's score
     */
    function _updateAgeGroupLeaderboard(uint8 ageGroup, address player, uint256 score) internal {
        LeaderboardEntry[] storage leaderboard = ageGroupLeaderboards[ageGroup];
        PlayerStats memory stats = playerStats[player];
        
        // Find existing entry or create new one
        int256 existingIndex = -1;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                existingIndex = int256(i);
                break;
            }
        }
        
        LeaderboardEntry memory entry = LeaderboardEntry({
            player: player,
            username: stats.username,
            score: score,
            rank: 0,
            lastUpdated: block.timestamp
        });
        
        if (existingIndex >= 0) {
            leaderboard[uint256(existingIndex)] = entry;
        } else {
            leaderboard.push(entry);
        }
        
        // Sort age group leaderboard
        _sortAgeGroupLeaderboard(ageGroup);
        
        // Trim if too large
        if (leaderboard.length > MAX_LEADERBOARD_SIZE) {
            leaderboard.pop();
        }
    }
    
    /**
     * @dev Sort leaderboard by score (descending) and update ranks
     * @param category Leaderboard category
     */
    function _sortLeaderboard(Category category) internal {
        LeaderboardEntry[] storage leaderboard = leaderboards[category];
        
        // Simple bubble sort (efficient for small arrays)
        for (uint256 i = 0; i < leaderboard.length; i++) {
            for (uint256 j = i + 1; j < leaderboard.length; j++) {
                if (leaderboard[i].score < leaderboard[j].score) {
                    // Swap entries
                    LeaderboardEntry memory temp = leaderboard[i];
                    leaderboard[i] = leaderboard[j];
                    leaderboard[j] = temp;
                }
            }
        }
        
        // Update ranks
        for (uint256 i = 0; i < leaderboard.length; i++) {
            leaderboard[i].rank = i + 1;
            playerRanks[category][leaderboard[i].player] = i + 1;
        }
    }
    
    /**
     * @dev Sort age group leaderboard
     * @param ageGroup Age group to sort
     */
    function _sortAgeGroupLeaderboard(uint8 ageGroup) internal {
        LeaderboardEntry[] storage leaderboard = ageGroupLeaderboards[ageGroup];
        
        // Simple bubble sort
        for (uint256 i = 0; i < leaderboard.length; i++) {
            for (uint256 j = i + 1; j < leaderboard.length; j++) {
                if (leaderboard[i].score < leaderboard[j].score) {
                    LeaderboardEntry memory temp = leaderboard[i];
                    leaderboard[i] = leaderboard[j];
                    leaderboard[j] = temp;
                }
            }
        }
        
        // Update ranks
        for (uint256 i = 0; i < leaderboard.length; i++) {
            leaderboard[i].rank = i + 1;
        }
    }
    
    // View functions
    
    /**
     * @dev Get leaderboard for a specific category
     * @param category Leaderboard category
     * @param limit Number of entries to return (max 100)
     * @return Array of leaderboard entries
     */
    function getLeaderboard(Category category, uint256 limit) 
        external 
        view 
        returns (LeaderboardEntry[] memory) 
    {
        LeaderboardEntry[] memory leaderboard = leaderboards[category];
        uint256 length = limit > leaderboard.length ? leaderboard.length : limit;
        length = length > MAX_LEADERBOARD_SIZE ? MAX_LEADERBOARD_SIZE : length;
        
        LeaderboardEntry[] memory result = new LeaderboardEntry[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = leaderboard[i];
        }
        
        return result;
    }
    
    /**
     * @dev Get age group leaderboard
     * @param ageGroup Age group (2-7)
     * @param limit Number of entries to return
     * @return Array of leaderboard entries
     */
    function getAgeGroupLeaderboard(uint8 ageGroup, uint256 limit) 
        external 
        view 
        returns (LeaderboardEntry[] memory) 
    {
        require(ageGroup >= 2 && ageGroup <= 7, "Invalid age group");
        
        LeaderboardEntry[] memory leaderboard = ageGroupLeaderboards[ageGroup];
        uint256 length = limit > leaderboard.length ? leaderboard.length : limit;
        length = length > MAX_LEADERBOARD_SIZE ? MAX_LEADERBOARD_SIZE : length;
        
        LeaderboardEntry[] memory result = new LeaderboardEntry[](length);
        for (uint256 i = 0; i < length; i++) {
            result[i] = leaderboard[i];
        }
        
        return result;
    }
    
    /**
     * @dev Get player's rank in a specific category
     * @param player Player address
     * @param category Leaderboard category
     * @return Player's rank (0 if not ranked)
     */
    function getPlayerRank(address player, Category category) external view returns (uint256) {
        return playerRanks[category][player];
    }
    
    /**
     * @dev Get player statistics
     * @param player Player address
     * @return PlayerStats struct
     */
    function getPlayerStats(address player) external view returns (PlayerStats memory) {
        return playerStats[player];
    }
    
    /**
     * @dev Get global statistics
     * @return totalPlayers, lastGlobalUpdate
     */
    function getGlobalStats() external view returns (uint256, uint256) {
        return (totalPlayers, lastGlobalUpdate);
    }
    
    // Admin functions
    
    /**
     * @dev Remove inactive players (only owner)
     * @param players Array of player addresses to remove
     */
    function removeInactivePlayers(address[] calldata players) external onlyOwner {
        for (uint256 i = 0; i < players.length; i++) {
            PlayerStats storage stats = playerStats[players[i]];
            if (stats.isActive && block.timestamp - stats.lastActive > INACTIVITY_THRESHOLD) {
                stats.isActive = false;
                // Note: This doesn't remove from leaderboards immediately
                // A full leaderboard refresh would be needed
            }
        }
    }
    
    /**
     * @dev Emergency pause (only owner)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause (only owner)
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Get contract name for identification
     */
    function name() external pure returns (string memory) {
        return "SpellBloc Leaderboard";
    }
    
    /**
     * @dev Get contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}