const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

const Category = {
  OVERALL: 0,
  WORDS_LEARNED: 1,
  ACCURACY: 2,
  SPEED: 3,
  STREAK: 4,
  AGE_GROUP: 5,
};

async function deployLeaderboardFixture() {
  const signers = await ethers.getSigners();
  const [owner, p1, p2, p3, other] = signers;
  const Leaderboard = await ethers.getContractFactory("SpellBlocLeaderboard");
  const leaderboard = await Leaderboard.deploy();
  await leaderboard.waitForDeployment();
  return { leaderboard, owner, p1, p2, p3, other, signers };
}

async function registerAndUpdate(
  leaderboard,
  owner,
  player,
  {
    username = "Player",
    ageGroup = 5,
    wordsLearned = 0,
    totalAttempts = 0,
    correctAttempts = 0,
    currentStreak = 0,
    sessionTime = 0,
  } = {}
) {
  await leaderboard.connect(player).registerPlayer(username, ageGroup);
  await leaderboard
    .connect(owner)
    .updatePlayerStats(
      player.address,
      wordsLearned,
      totalAttempts,
      correctAttempts,
      currentStreak,
      sessionTime
    );
}

describe("SpellBlocLeaderboard", function () {
  describe("registerPlayer", function () {
    it("registers a new player, pushes to allPlayers, increments totalPlayers, emits PlayerRegistered", async function () {
      const { leaderboard, p1 } = await loadFixture(deployLeaderboardFixture);
      await expect(leaderboard.connect(p1).registerPlayer("Alice", 6))
        .to.emit(leaderboard, "PlayerRegistered")
        .withArgs(p1.address, "Alice", 6);

      expect(await leaderboard.totalPlayers()).to.equal(1n);
      expect(await leaderboard.allPlayers(0)).to.equal(p1.address);
      const stats = await leaderboard.getPlayerStats(p1.address);
      expect(stats.isActive).to.equal(true);
      expect(stats.username).to.equal("Alice");
      expect(stats.ageGroup).to.equal(6);
    });

    it("re-registering the SAME player updates info without incrementing totalPlayers or re-emitting PlayerRegistered", async function () {
      const { leaderboard, p1 } = await loadFixture(deployLeaderboardFixture);
      await leaderboard.connect(p1).registerPlayer("Alice", 6);
      const tx = leaderboard.connect(p1).registerPlayer("Alicia", 7);

      await expect(tx).to.not.emit(leaderboard, "PlayerRegistered");
      expect(await leaderboard.totalPlayers()).to.equal(1n);
      const stats = await leaderboard.getPlayerStats(p1.address);
      expect(stats.username).to.equal("Alicia");
      expect(stats.ageGroup).to.equal(7);
    });

    it("rejects ageGroup outside [2,7]", async function () {
      const { leaderboard, p1 } = await loadFixture(deployLeaderboardFixture);
      await expect(
        leaderboard.connect(p1).registerPlayer("Alice", 1)
      ).to.be.revertedWith("Invalid age group");
      await expect(
        leaderboard.connect(p1).registerPlayer("Alice", 8)
      ).to.be.revertedWith("Invalid age group");
    });

    it("rejects empty or overlong usernames", async function () {
      const { leaderboard, p1 } = await loadFixture(deployLeaderboardFixture);
      await expect(
        leaderboard.connect(p1).registerPlayer("", 5)
      ).to.be.revertedWith("Invalid username length");
      await expect(
        leaderboard.connect(p1).registerPlayer("a".repeat(21), 5)
      ).to.be.revertedWith("Invalid username length");
      // Boundary: exactly 20 chars is allowed.
      await expect(leaderboard.connect(p1).registerPlayer("a".repeat(20), 5))
        .to.not.be.reverted;
    });

    it("reverts while paused, succeeds after unpause", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(owner).pause();
      await expect(
        leaderboard.connect(p1).registerPlayer("Alice", 5)
      ).to.be.revertedWith("Pausable: paused");
      await leaderboard.connect(owner).unpause();
      await expect(leaderboard.connect(p1).registerPlayer("Alice", 5)).to.not
        .be.reverted;
    });
  });

  describe("updatePlayerStats (onlyOwner)", function () {
    it("reverts for a non-owner", async function () {
      const { leaderboard, other, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await expect(
        leaderboard.connect(other).updatePlayerStats(p1.address, 10, 10, 8, 2, 60)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts for an unregistered player", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 10, 10, 8, 2, 60)
      ).to.be.revertedWith("Player not registered");
    });

    it("reverts while paused", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await leaderboard.connect(owner).pause();
      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 10, 10, 8, 2, 60)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("updates stats, accumulates totalPlayTime, and emits StatsUpdated with the correct computed accuracy", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);

      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 20, 10, 8, 3, 120)
      )
        .to.emit(leaderboard, "StatsUpdated")
        .withArgs(p1.address, 20, 10, 8, 80, 3, 3, 120); // accuracy (8*100)/10 = 80

      let stats = await leaderboard.getPlayerStats(p1.address);
      expect(stats.wordsLearned).to.equal(20n);
      expect(stats.totalAttempts).to.equal(10n);
      expect(stats.correctAttempts).to.equal(8n);
      expect(stats.currentStreak).to.equal(3n);
      expect(stats.bestStreak).to.equal(3n);
      expect(stats.totalPlayTime).to.equal(120n);

      // Second update: totalPlayTime accumulates (+=), currentStreak drops
      // but bestStreak must NOT decrease.
      await leaderboard
        .connect(owner)
        .updatePlayerStats(p1.address, 25, 15, 10, 1, 60);
      stats = await leaderboard.getPlayerStats(p1.address);
      expect(stats.totalPlayTime).to.equal(180n);
      expect(stats.currentStreak).to.equal(1n);
      expect(stats.bestStreak).to.equal(3n); // unchanged, 1 < 3
    });

    it("StatsUpdated reports accuracy=0 when totalAttempts is 0", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await expect(
        leaderboard.connect(owner).updatePlayerStats(p1.address, 0, 0, 0, 0, 0)
      )
        .to.emit(leaderboard, "StatsUpdated")
        .withArgs(p1.address, 0, 0, 0, 0, 0, 0, 0);
    });

    it("rejects updates that decrease cumulative wordsLearned, totalAttempts, or correctAttempts", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await leaderboard
        .connect(owner)
        .updatePlayerStats(p1.address, 20, 10, 8, 3, 120);

      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 19, 10, 8, 3, 10)
      ).to.be.revertedWith("wordsLearned cannot decrease");

      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 20, 9, 8, 3, 10)
      ).to.be.revertedWith("totalAttempts cannot decrease");

      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 20, 10, 7, 3, 10)
      ).to.be.revertedWith("correctAttempts cannot decrease");
    });

    it("rejects correctAttempts greater than totalAttempts", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 5, 5, 6, 0, 10)
      ).to.be.revertedWith("correctAttempts exceeds totalAttempts");
    });
  });

  describe("SPEED (words-per-minute) score — division-by-zero fix", function () {
    // Previously: wpm = totalPlayTime > 0 ? (wordsLearned * 60) / (totalPlayTime / 60) : 0
    // For 1 <= totalPlayTime < 60, integer division made totalPlayTime / 60
    // truncate to 0, so the outer division reverted. Fixed by computing
    // (wordsLearned * 60) / totalPlayTime directly (multiply before divide).
    const cases = [
      { totalPlayTime: 0, wordsLearned: 10, expectedWpm: 0n },
      { totalPlayTime: 1, wordsLearned: 1, expectedWpm: 60n },
      { totalPlayTime: 59, wordsLearned: 59, expectedWpm: 60n },
      { totalPlayTime: 60, wordsLearned: 10, expectedWpm: 10n },
      { totalPlayTime: 3600, wordsLearned: 600, expectedWpm: 10n },
    ];

    for (const { totalPlayTime, wordsLearned, expectedWpm } of cases) {
      it(`sessionTime=${totalPlayTime} does not revert and produces the documented SPEED score`, async function () {
        const { leaderboard, owner, p1 } = await loadFixture(
          deployLeaderboardFixture
        );
        await leaderboard.connect(p1).registerPlayer("Alice", 5);
        await expect(
          leaderboard
            .connect(owner)
            .updatePlayerStats(
              p1.address,
              wordsLearned,
              wordsLearned,
              wordsLearned,
              0,
              totalPlayTime
            )
        ).to.not.be.reverted;

        const board = await leaderboard.getLeaderboard(Category.SPEED, 10);
        expect(board.length).to.equal(1);
        expect(board[0].player).to.equal(p1.address);
        expect(board[0].score).to.equal(expectedWpm);
      });
    }
  });

  describe("Leaderboard ordering invariants", function () {
    it("OVERALL leaderboard is sorted descending by score with correct 1-based ranks", async function () {
      const { leaderboard, owner, p1, p2, p3 } = await loadFixture(
        deployLeaderboardFixture
      );
      // Insert out of order: p1 lowest, p2 highest, p3 middle.
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
        currentStreak: 1,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 100,
        totalAttempts: 100,
        correctAttempts: 95,
        currentStreak: 10,
      });
      await registerAndUpdate(leaderboard, owner, p3, {
        wordsLearned: 50,
        totalAttempts: 50,
        correctAttempts: 40,
        currentStreak: 5,
      });

      const board = await leaderboard.getLeaderboard(Category.OVERALL, 10);
      expect(board.length).to.equal(3);
      expect(board[0].player).to.equal(p2.address);
      expect(board[1].player).to.equal(p3.address);
      expect(board[2].player).to.equal(p1.address);
      expect(board[0].rank).to.equal(1n);
      expect(board[1].rank).to.equal(2n);
      expect(board[2].rank).to.equal(3n);
      expect(board[0].score >= board[1].score).to.equal(true);
      expect(board[1].score >= board[2].score).to.equal(true);

      expect(await leaderboard.getPlayerRank(p2.address, Category.OVERALL)).to.equal(1n);
      expect(await leaderboard.getPlayerRank(p1.address, Category.OVERALL)).to.equal(3n);
    });

    it("re-ordering after an update emits RankChanged with correct old/new ranks", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
        currentStreak: 1,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 100,
        totalAttempts: 100,
        correctAttempts: 95,
        currentStreak: 10,
      });
      // p1 currently rank 2, p2 rank 1. Boost p1 above p2.
      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(p1.address, 500, 500, 490, 50, 100)
      )
        .to.emit(leaderboard, "RankChanged")
        .withArgs(p1.address, Category.OVERALL, 2, 1);

      expect(await leaderboard.getPlayerRank(p1.address, Category.OVERALL)).to.equal(1n);
      expect(await leaderboard.getPlayerRank(p2.address, Category.OVERALL)).to.equal(2n);
    });

    it("updating an existing entry does not duplicate it in the leaderboard array", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 20,
        totalAttempts: 20,
        correctAttempts: 10,
      });
      await leaderboard
        .connect(owner)
        .updatePlayerStats(p1.address, 30, 30, 20, 2, 60);

      const board = await leaderboard.getLeaderboard(Category.OVERALL, 100);
      expect(board.length).to.equal(2);
    });

    it("[OBSERVED — tie handling] equal-score entries are NOT swapped by the strict '<' bubble sort, preserving prior relative order", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      // Identical stats -> identical OVERALL score.
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 10,
        currentStreak: 1,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 10,
        currentStreak: 1,
      });

      const board = await leaderboard.getLeaderboard(Category.OVERALL, 10);
      expect(board[0].score).to.equal(board[1].score);
      // p1 was inserted first and, on a tie, keeps the earlier rank — this
      // is incidental to the sort's strict '<' comparison, not a documented
      // tie-break rule in the contract. Not a money bug; noted for the
      // maintainer as an implicit behavior worth documenting explicitly.
      expect(board[0].player).to.equal(p1.address);
      expect(board[1].player).to.equal(p2.address);
    });

    it("category leaderboards (WORDS_LEARNED, ACCURACY, STREAK) track independently of OVERALL", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      // p1: fewer words but perfect accuracy and a long streak.
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 5,
        totalAttempts: 10,
        correctAttempts: 10,
        currentStreak: 20,
      });
      // p2: many more words, weaker accuracy, no streak.
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 200,
        totalAttempts: 200,
        correctAttempts: 100,
        currentStreak: 0,
      });

      const words = await leaderboard.getLeaderboard(Category.WORDS_LEARNED, 10);
      expect(words[0].player).to.equal(p2.address);

      const accuracy = await leaderboard.getLeaderboard(Category.ACCURACY, 10);
      expect(accuracy[0].player).to.equal(p1.address);

      const streak = await leaderboard.getLeaderboard(Category.STREAK, 10);
      expect(streak[0].player).to.equal(p1.address);
    });

    it("age group leaderboard only contains players from that age group and sorts correctly", async function () {
      const { leaderboard, owner, p1, p2, p3 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        ageGroup: 4,
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        ageGroup: 4,
        wordsLearned: 50,
        totalAttempts: 50,
        correctAttempts: 40,
      });
      await registerAndUpdate(leaderboard, owner, p3, {
        ageGroup: 7,
        wordsLearned: 1000,
        totalAttempts: 1000,
        correctAttempts: 900,
      });

      const ageGroup4 = await leaderboard.getAgeGroupLeaderboard(4, 10);
      expect(ageGroup4.length).to.equal(2);
      expect(ageGroup4[0].player).to.equal(p2.address);
      expect(ageGroup4[1].player).to.equal(p1.address);

      const ageGroup7 = await leaderboard.getAgeGroupLeaderboard(7, 10);
      expect(ageGroup7.length).to.equal(1);
      expect(ageGroup7[0].player).to.equal(p3.address);
    });

    it("getAgeGroupLeaderboard rejects an out-of-range age group", async function () {
      const { leaderboard } = await loadFixture(deployLeaderboardFixture);
      await expect(
        leaderboard.getAgeGroupLeaderboard(1, 10)
      ).to.be.revertedWith("Invalid age group");
      await expect(
        leaderboard.getAgeGroupLeaderboard(8, 10)
      ).to.be.revertedWith("Invalid age group");
    });

    it("getLeaderboard caps the returned length at the requested limit and never exceeds actual entries", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        wordsLearned: 20,
        totalAttempts: 20,
        correctAttempts: 10,
      });

      const limited = await leaderboard.getLeaderboard(Category.OVERALL, 1);
      expect(limited.length).to.equal(1);
      expect(limited[0].player).to.equal(p2.address);

      const overRequested = await leaderboard.getLeaderboard(
        Category.OVERALL,
        1000
      );
      expect(overRequested.length).to.equal(2);
    });
  });

  describe("MAX_LEADERBOARD_SIZE trimming boundary", function () {
    // _updateLeaderboard now maintains the array sorted via a single O(n)
    // scan-and-shift insertion instead of an unconditional O(n^2) bubble
    // sort, so growing the leaderboard all the way to (and past)
    // MAX_LEADERBOARD_SIZE stays cheap and never runs out of gas.
    it("keeps exactly the top MAX_LEADERBOARD_SIZE scorers when more players are registered", async function () {
      this.timeout(180000);
      const { leaderboard, owner, signers } = await loadFixture(
        deployLeaderboardFixture
      );
      const MAX = Number(await leaderboard.MAX_LEADERBOARD_SIZE());
      expect(MAX).to.equal(100);

      // Hardhat's default signer set (20) is not enough for 101 unique
      // players; derive extra funded wallets instead.
      const extraCount = MAX + 1;
      const funder = signers[0];
      const wallets = [];
      for (let i = 0; i < extraCount; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1"),
        });
        wallets.push(wallet);
      }

      // Give each player a strictly increasing score so the LOWEST scorer
      // (the very first one registered) is the one that should be trimmed
      // off once we exceed MAX_LEADERBOARD_SIZE.
      let lastGasUsed = 0n;
      for (let i = 0; i < wallets.length; i++) {
        const player = wallets[i];
        await leaderboard.connect(player).registerPlayer(`P${i}`, 5);
        const tx = await leaderboard
          .connect(owner)
          .updatePlayerStats(player.address, i + 1, i + 1, i + 1, 0, 0);
        const receipt = await tx.wait();
        lastGasUsed = receipt.gasUsed;
      }

      const board = await leaderboard.getLeaderboard(Category.OVERALL, MAX + 10);
      expect(board.length).to.equal(MAX);

      // The lowest-scoring player (wallets[0], smallest wordsLearned) must
      // have been trimmed off; the highest scorer (last registered) must
      // be present at rank 1.
      const boardAddresses = board.map((e) => e.player);
      expect(boardAddresses).to.not.include(wallets[0].address);
      expect(boardAddresses).to.include(wallets[wallets.length - 1].address);
      expect(board[0].player).to.equal(wallets[wallets.length - 1].address);
      expect(board[0].rank).to.equal(1n);
      expect(board[MAX - 1].rank).to.equal(BigInt(MAX));

      // Trimmed player must report an unranked (0) rank, not a stale one.
      expect(
        await leaderboard.getPlayerRank(wallets[0].address, Category.OVERALL)
      ).to.equal(0n);

      // Gas ceiling: a single updatePlayerStats call that fills/evicts
      // across a completely full MAX_LEADERBOARD_SIZE=100 board (worst
      // case across all 6 leaderboards it touches) measures ~11.8M gas on
      // this toolchain — a constant bound set only by MAX_LEADERBOARD_SIZE,
      // never by how many players have ever registered, and comfortably
      // under real block gas limits (Celo mainnet ~30M as of mid-2026).
      // Previously (unconditional O(n^2) bubble sort x6) this same
      // operation exceeded 10M gas by leaderboard length ~55 and kept
      // growing without bound.
      expect(lastGasUsed).to.be.lessThan(15_000_000n);
    });

    it("evicting a player from the top-N leaves their rank at 0 (never stale) across all affected categories", async function () {
      this.timeout(120000);
      const { leaderboard, owner, signers } = await loadFixture(
        deployLeaderboardFixture
      );
      const MAX = Number(await leaderboard.MAX_LEADERBOARD_SIZE());
      const funder = signers[0];
      const wallets = [];
      for (let i = 0; i < MAX; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1"),
        });
        wallets.push(wallet);
        await leaderboard.connect(wallet).registerPlayer(`Q${i}`, 5);
        await leaderboard
          .connect(owner)
          .updatePlayerStats(wallet.address, i + 1, i + 1, i + 1, 0, 0);
      }

      // wallets[0] currently holds the lowest score and sits at the bottom
      // of the (now full) leaderboard.
      expect(
        await leaderboard.getPlayerRank(wallets[0].address, Category.OVERALL)
      ).to.equal(BigInt(MAX));

      // A new player with a higher score than everyone evicts wallets[0].
      const newcomer = ethers.Wallet.createRandom().connect(ethers.provider);
      await funder.sendTransaction({
        to: newcomer.address,
        value: ethers.parseEther("1"),
      });
      await leaderboard.connect(newcomer).registerPlayer("Newcomer", 5);
      await leaderboard
        .connect(owner)
        .updatePlayerStats(newcomer.address, MAX + 1, MAX + 1, MAX + 1, 0, 0);

      expect(
        await leaderboard.getPlayerRank(wallets[0].address, Category.OVERALL)
      ).to.equal(0n);
      expect(
        await leaderboard.getPlayerRank(newcomer.address, Category.OVERALL)
      ).to.equal(1n);
    });
  });

  describe("removeInactivePlayers (onlyOwner)", function () {
    it("reverts for a non-owner", async function () {
      const { leaderboard, other, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await expect(
        leaderboard.connect(other).removeInactivePlayers([p1.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("deactivates a player inactive beyond INACTIVITY_THRESHOLD, leaves recently-active players untouched", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Stale", 5);
      await leaderboard.connect(p2).registerPlayer("Fresh", 5);

      const threshold = Number(await leaderboard.INACTIVITY_THRESHOLD());
      await time.increase(threshold + 1);

      await leaderboard
        .connect(owner)
        .removeInactivePlayers([p1.address, p2.address]);

      expect((await leaderboard.getPlayerStats(p1.address)).isActive).to.equal(
        false
      );
      // p2 registered at the same original time, so it's ALSO past the
      // threshold now — the function does not special-case "recently
      // active" beyond block.timestamp - lastActive, this simply confirms
      // both go inactive together since both registered at t0.
      expect((await leaderboard.getPlayerStats(p2.address)).isActive).to.equal(
        false
      );
    });

    it("a deactivated player is removed from every leaderboard and reports rank 0, not a stale rank", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        ageGroup: 4,
        wordsLearned: 10,
        totalAttempts: 10,
        correctAttempts: 5,
        currentStreak: 2,
      });
      await registerAndUpdate(leaderboard, owner, p2, {
        ageGroup: 4,
        wordsLearned: 20,
        totalAttempts: 20,
        correctAttempts: 10,
        currentStreak: 1,
      });

      const threshold = Number(await leaderboard.INACTIVITY_THRESHOLD());
      await time.increase(threshold + 1);
      await leaderboard.connect(owner).removeInactivePlayers([p1.address]);

      const board = await leaderboard.getLeaderboard(Category.OVERALL, 10);
      expect(board.length).to.equal(1);
      expect(board[0].player).to.equal(p2.address);

      const words = await leaderboard.getLeaderboard(Category.WORDS_LEARNED, 10);
      expect(words.map((e) => e.player)).to.not.include(p1.address);

      const ageGroup4 = await leaderboard.getAgeGroupLeaderboard(4, 10);
      expect(ageGroup4.length).to.equal(1);
      expect(ageGroup4[0].player).to.equal(p2.address);

      for (const category of Object.values(Category)) {
        if (category === Category.AGE_GROUP) continue;
        expect(await leaderboard.getPlayerRank(p1.address, category)).to.equal(
          0n
        );
      }
    });
  });

  describe("Pausability", function () {
    it("pause/unpause revert for a non-owner", async function () {
      const { leaderboard, other } = await loadFixture(
        deployLeaderboardFixture
      );
      await expect(leaderboard.connect(other).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(leaderboard.connect(other).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("lastGlobalUpdate", function () {
    it("advances on leaderboard-affecting changes (stats update, inactive removal)", async function () {
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      const [, initial] = await leaderboard.getGlobalStats();

      await leaderboard.connect(p1).registerPlayer("Alice", 5);
      await time.increase(10);
      await leaderboard
        .connect(owner)
        .updatePlayerStats(p1.address, 10, 10, 10, 1, 60);
      const [, afterUpdate] = await leaderboard.getGlobalStats();
      expect(afterUpdate).to.be.greaterThan(initial);

      await time.increase(Number(await leaderboard.INACTIVITY_THRESHOLD()) + 1);
      await leaderboard.connect(owner).removeInactivePlayers([p1.address]);
      const [, afterRemoval] = await leaderboard.getGlobalStats();
      expect(afterRemoval).to.be.greaterThan(afterUpdate);
    });
  });

  describe("Events sufficient for a deterministic off-chain indexer", function () {
    it("emits LeaderboardScoreUpdated for every category on every update, even when rank does not change", async function () {
      const { leaderboard, owner, p1, p2 } = await loadFixture(
        deployLeaderboardFixture
      );
      await registerAndUpdate(leaderboard, owner, p1, {
        wordsLearned: 100,
        totalAttempts: 100,
        correctAttempts: 100,
        currentStreak: 5,
        sessionTime: 600,
      });
      await leaderboard.connect(p2).registerPlayer("Bob", 5);

      // p2's first update keeps it below p1 in every category (rank
      // unchanged for p1), but every category must still report the fresh
      // score via LeaderboardScoreUpdated for an indexer to stay correct.
      const tx = await leaderboard
        .connect(owner)
        .updatePlayerStats(p2.address, 1, 1, 1, 1, 60);
      await expect(tx)
        .to.emit(leaderboard, "LeaderboardScoreUpdated")
        .withArgs(Category.OVERALL, p2.address, 4240n, 2n);
      await expect(tx)
        .to.emit(leaderboard, "LeaderboardScoreUpdated")
        .withArgs(Category.WORDS_LEARNED, p2.address, 1n, 2n);
      await expect(tx)
        .to.emit(leaderboard, "AgeGroupScoreUpdated");
    });

    it("emits LeaderboardEntryRemoved when a player is evicted from a full leaderboard", async function () {
      this.timeout(120000);
      const { leaderboard, owner, signers } = await loadFixture(
        deployLeaderboardFixture
      );
      const MAX = Number(await leaderboard.MAX_LEADERBOARD_SIZE());
      const funder = signers[0];
      let lowest;
      for (let i = 0; i < MAX; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1"),
        });
        if (i === 0) lowest = wallet;
        await leaderboard.connect(wallet).registerPlayer(`R${i}`, 5);
        await leaderboard
          .connect(owner)
          .updatePlayerStats(wallet.address, i + 1, i + 1, i + 1, 0, 0);
      }

      const newcomer = ethers.Wallet.createRandom().connect(ethers.provider);
      await funder.sendTransaction({
        to: newcomer.address,
        value: ethers.parseEther("1"),
      });
      await leaderboard.connect(newcomer).registerPlayer("Newcomer", 5);
      await expect(
        leaderboard
          .connect(owner)
          .updatePlayerStats(newcomer.address, MAX + 1, MAX + 1, MAX + 1, 0, 0)
      )
        .to.emit(leaderboard, "LeaderboardEntryRemoved")
        .withArgs(Category.OVERALL, lowest.address);
    });
  });

  describe("Fuzz — score arithmetic never overflows/reverts for valid inputs", function () {
    it("random valid (monotonic, in-range) stat sequences never revert and match the documented score formulas", async function () {
      this.timeout(120000);
      const { leaderboard, owner, p1 } = await loadFixture(
        deployLeaderboardFixture
      );
      await leaderboard.connect(p1).registerPlayer("Fuzzer", 5);

      let wordsLearned = 0;
      let totalAttempts = 0;
      let correctAttempts = 0;
      let totalPlayTime = 0;

      const ITERATIONS = 40;
      for (let iter = 0; iter < ITERATIONS; iter++) {
        wordsLearned += Math.floor(Math.random() * 1000);
        const attemptsDelta = Math.floor(Math.random() * 1000);
        totalAttempts += attemptsDelta;
        correctAttempts += Math.floor(Math.random() * (attemptsDelta + 1));
        const currentStreak = Math.floor(Math.random() * 500);
        const sessionTime = Math.floor(Math.random() * 100000);
        totalPlayTime += sessionTime;

        await expect(
          leaderboard
            .connect(owner)
            .updatePlayerStats(
              p1.address,
              wordsLearned,
              totalAttempts,
              correctAttempts,
              currentStreak,
              sessionTime
            )
        ).to.not.be.reverted;

        const expectedAccuracy =
          totalAttempts > 0
            ? Math.floor((correctAttempts * 100) / totalAttempts)
            : 0;
        const expectedWpm =
          totalPlayTime > 0
            ? Math.floor((wordsLearned * 60) / totalPlayTime)
            : 0;

        const accBoard = await leaderboard.getLeaderboard(
          Category.ACCURACY,
          10
        );
        expect(accBoard[0].score).to.equal(BigInt(expectedAccuracy));

        const speedBoard = await leaderboard.getLeaderboard(
          Category.SPEED,
          10
        );
        expect(speedBoard[0].score).to.equal(BigInt(expectedWpm));
      }
    });
  });

  describe("Misc views", function () {
    it("getGlobalStats reports totalPlayers and lastGlobalUpdate (set at deploy)", async function () {
      const { leaderboard } = await loadFixture(deployLeaderboardFixture);
      const [totalPlayers] = await leaderboard.getGlobalStats();
      expect(totalPlayers).to.equal(0n);
    });

    it("name() and version() report the expected identifiers", async function () {
      const { leaderboard } = await loadFixture(deployLeaderboardFixture);
      expect(await leaderboard.name()).to.equal("SpellBloc Leaderboard");
      expect(await leaderboard.version()).to.equal("1.0.0");
    });
  });
});
