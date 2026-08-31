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
    event StatsUpdated(
        address indexed player,
        uint256 wordsLearned,
        uint256 totalAttempts,
        uint256 correctAttempts,
        uint256 accuracy,
        uint256 bestStreak,
        uint256 currentStreak,
        uint256 totalPlayTime
    );
    event LeaderboardUpdated(Category indexed category, uint256 timestamp);
    event LeaderboardScoreUpdated(Category indexed category, address indexed player, uint256 score, uint256 rank);
    event LeaderboardEntryRemoved(Category indexed category, address indexed player);
    event AgeGroupScoreUpdated(uint8 indexed ageGroup, address indexed player, uint256 score, uint256 rank);
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
     * @param wordsLearned Total words learned (cumulative; cannot decrease)
     * @param totalAttempts Total spelling attempts (cumulative; cannot decrease)
     * @param correctAttempts Correct spelling attempts (cumulative; cannot decrease, cannot exceed totalAttempts)
     * @param currentStreak Current daily streak
     * @param sessionTime Time spent in current session (seconds), added to cumulative totalPlayTime
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

        // Stats are cumulative running totals; reject updates that would
        // silently roll them back or report an impossible accuracy.
        require(wordsLearned >= stats.wordsLearned, "wordsLearned cannot decrease");
        require(totalAttempts >= stats.totalAttempts, "totalAttempts cannot decrease");
        require(correctAttempts >= stats.correctAttempts, "correctAttempts cannot decrease");
        require(correctAttempts <= totalAttempts, "correctAttempts exceeds totalAttempts");

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

        emit StatsUpdated(
            player,
            stats.wordsLearned,
            stats.totalAttempts,
            stats.correctAttempts,
            accuracy,
            stats.bestStreak,
            stats.currentStreak,
            stats.totalPlayTime
        );

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

        // Update speed leaderboard: words per minute, derived from cumulative
        // wordsLearned and cumulative totalPlayTime (seconds) as
        // (wordsLearned * 60) / totalPlayTime. Multiplying before dividing
        // avoids the previous bug where totalPlayTime / 60 truncated to zero
        // (and reverted on division by zero) for any 1 <= totalPlayTime < 60.
        // totalPlayTime == 0 is defined to score 0.
        uint256 wpm = stats.totalPlayTime > 0 ? (stats.wordsLearned * 60) / stats.totalPlayTime : 0;
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
     * @dev Update a specific leaderboard with a player's score, keeping the
     * array sorted descending and bounded to MAX_LEADERBOARD_SIZE entries.
     *
     * Instead of a full O(n^2) re-sort on every call, this removes the
     * player's previous entry (if any) and re-inserts it at its correct
     * sorted position via a single O(n) scan-and-shift. Total cost per call
     * is O(n), bounded by MAX_LEADERBOARD_SIZE regardless of how many
     * players have ever registered.
     * @param category Leaderboard category
     * @param player Player address
     * @param score Player's score for this category
     */
    function _updateLeaderboard(Category category, address player, uint256 score) internal {
        LeaderboardEntry[] storage leaderboard = leaderboards[category];
        PlayerStats memory stats = playerStats[player];

        uint256 oldRank = playerRanks[category][player];

        // Remove any existing entry for this player, closing the gap.
        if (oldRank > 0 && oldRank <= leaderboard.length && leaderboard[oldRank - 1].player == player) {
            uint256 idx = oldRank - 1;
            for (uint256 i = idx; i + 1 < leaderboard.length; i++) {
                leaderboard[i] = leaderboard[i + 1];
            }
            leaderboard.pop();
        }

        // Find the sorted (descending) insertion position. Ties keep the
        // existing entries' relative order (new entry inserts after equals),
        // matching the previous strict '<' bubble-sort behavior.
        uint256 insertPos = leaderboard.length;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (score > leaderboard[i].score) {
                insertPos = i;
                break;
            }
        }

        address evictedPlayer = address(0);
        if (insertPos < MAX_LEADERBOARD_SIZE) {
            LeaderboardEntry memory entry = LeaderboardEntry({
                player: player,
                username: stats.username,
                score: score,
                rank: 0,
                lastUpdated: block.timestamp
            });

            leaderboard.push(entry);
            for (uint256 i = leaderboard.length - 1; i > insertPos; i--) {
                leaderboard[i] = leaderboard[i - 1];
            }
            leaderboard[insertPos] = entry;

            // Trim the lowest entry if we're over capacity.
            if (leaderboard.length > MAX_LEADERBOARD_SIZE) {
                evictedPlayer = leaderboard[leaderboard.length - 1].player;
                leaderboard.pop();
            }
        }
        // else: score doesn't qualify for the bounded top-N; player is (or
        // remains) unranked in this category.

        // Re-derive ranks for the (small, capped) array in a single pass.
        for (uint256 i = 0; i < leaderboard.length; i++) {
            leaderboard[i].rank = i + 1;
            playerRanks[category][leaderboard[i].player] = i + 1;
        }

        // A player who fell out of the top-N (evicted, or score too low to
        // enter) must never keep reporting a stale rank.
        if (evictedPlayer != address(0) && evictedPlayer != player) {
            playerRanks[category][evictedPlayer] = 0;
            emit LeaderboardEntryRemoved(category, evictedPlayer);
        }
        if (insertPos >= MAX_LEADERBOARD_SIZE) {
            playerRanks[category][player] = 0;
        }

        lastGlobalUpdate = block.timestamp;

        uint256 newRank = playerRanks[category][player];
        if (oldRank != newRank) {
            emit RankChanged(player, category, oldRank, newRank);
        }
        emit LeaderboardScoreUpdated(category, player, score, newRank);
        emit LeaderboardUpdated(category, block.timestamp);
    }

    /**
     * @dev Update age group leaderboard using the same bounded, O(n)
     * insertion approach as _updateLeaderboard.
     * @param ageGroup Age group (2-7)
     * @param player Player address
     * @param score Player's score
     */
    function _updateAgeGroupLeaderboard(uint8 ageGroup, address player, uint256 score) internal {
        LeaderboardEntry[] storage leaderboard = ageGroupLeaderboards[ageGroup];
        PlayerStats memory stats = playerStats[player];

        // Remove any existing entry for this player, closing the gap.
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                for (uint256 j = i; j + 1 < leaderboard.length; j++) {
                    leaderboard[j] = leaderboard[j + 1];
                }
                leaderboard.pop();
                break;
            }
        }

        uint256 insertPos = leaderboard.length;
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (score > leaderboard[i].score) {
                insertPos = i;
                break;
            }
        }

        if (insertPos < MAX_LEADERBOARD_SIZE) {
            LeaderboardEntry memory entry = LeaderboardEntry({
                player: player,
                username: stats.username,
                score: score,
                rank: 0,
                lastUpdated: block.timestamp
            });

            leaderboard.push(entry);
            for (uint256 i = leaderboard.length - 1; i > insertPos; i--) {
                leaderboard[i] = leaderboard[i - 1];
            }
            leaderboard[insertPos] = entry;

            if (leaderboard.length > MAX_LEADERBOARD_SIZE) {
                leaderboard.pop();
            }
        }

        for (uint256 i = 0; i < leaderboard.length; i++) {
            leaderboard[i].rank = i + 1;
        }

        lastGlobalUpdate = block.timestamp;

        uint256 newRank = 0;
        if (insertPos < leaderboard.length && leaderboard[insertPos].player == player) {
            newRank = leaderboard[insertPos].rank;
        }
        emit AgeGroupScoreUpdated(ageGroup, player, score, newRank);
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
     * @return Player's rank (0 if not ranked / outside the bounded top-N)
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
     * @dev Remove inactive players (only owner). Deactivated players are
     * also removed from every leaderboard they currently appear on, so
     * stale/inactive entries and ranks cannot linger.
     * @param players Array of player addresses to remove
     */
    function removeInactivePlayers(address[] calldata players) external onlyOwner {
        for (uint256 i = 0; i < players.length; i++) {
            PlayerStats storage stats = playerStats[players[i]];
            if (stats.isActive && block.timestamp - stats.lastActive > INACTIVITY_THRESHOLD) {
                stats.isActive = false;
                _removeFromAllLeaderboards(players[i], stats.ageGroup);
            }
        }
    }

    /**
     * @dev Remove a player from every category leaderboard and their age
     * group leaderboard.
     */
    function _removeFromAllLeaderboards(address player, uint8 ageGroup) internal {
        _removeFromLeaderboard(Category.OVERALL, player);
        _removeFromLeaderboard(Category.WORDS_LEARNED, player);
        _removeFromLeaderboard(Category.ACCURACY, player);
        _removeFromLeaderboard(Category.SPEED, player);
        _removeFromLeaderboard(Category.STREAK, player);
        _removeFromAgeGroupLeaderboard(ageGroup, player);
    }

    /**
     * @dev Remove a single player's entry from one category leaderboard,
     * closing the gap and re-deriving ranks for the shifted tail. O(n),
     * bounded by MAX_LEADERBOARD_SIZE.
     */
    function _removeFromLeaderboard(Category category, address player) internal {
        uint256 rank = playerRanks[category][player];
        if (rank == 0) return;

        LeaderboardEntry[] storage leaderboard = leaderboards[category];
        uint256 idx = rank - 1;
        if (idx >= leaderboard.length || leaderboard[idx].player != player) return;

        for (uint256 i = idx; i + 1 < leaderboard.length; i++) {
            leaderboard[i] = leaderboard[i + 1];
        }
        leaderboard.pop();
        playerRanks[category][player] = 0;

        for (uint256 i = idx; i < leaderboard.length; i++) {
            leaderboard[i].rank = i + 1;
            playerRanks[category][leaderboard[i].player] = i + 1;
        }

        lastGlobalUpdate = block.timestamp;
        emit LeaderboardEntryRemoved(category, player);
        emit LeaderboardUpdated(category, block.timestamp);
    }

    /**
     * @dev Remove a single player's entry from an age group leaderboard.
     */
    function _removeFromAgeGroupLeaderboard(uint8 ageGroup, address player) internal {
        LeaderboardEntry[] storage leaderboard = ageGroupLeaderboards[ageGroup];
        for (uint256 i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].player == player) {
                for (uint256 j = i; j + 1 < leaderboard.length; j++) {
                    leaderboard[j] = leaderboard[j + 1];
                }
                leaderboard.pop();
                for (uint256 j = i; j < leaderboard.length; j++) {
                    leaderboard[j].rank = j + 1;
                }
                lastGlobalUpdate = block.timestamp;
                break;
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
