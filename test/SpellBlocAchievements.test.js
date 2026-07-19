const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Seeded achievement ids (order created in _createInitialAchievements)
const ACH = {
  FIRST_STEPS: 0, // soulbound, not purchasable
  WORD_EXPLORER: 1,
  SPELLING_CHAMPION: 2,
  SPEED_DEMON: 3,
  PERFECT_SCORE: 4,
  DAILY_LEARNER: 5,
  DEDICATION_MASTER: 6,
  GOLDEN_STAR: 7, // NOT soulbound, purchasable, price 0.5 ether, maxSupply 1000
  DIAMOND_CROWN: 8, // NOT soulbound, purchasable, price 2.0 ether, maxSupply 100
};

const AchievementType = {
  MILESTONE: 0,
  PERFORMANCE: 1,
  STREAK: 2,
  CATEGORY: 3,
  SPECIAL: 4,
};
const Rarity = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 };

async function deployAchievementsFixture() {
  const [owner, user1, user2, other] = await ethers.getSigners();
  const Achievements = await ethers.getContractFactory(
    "SpellBlocAchievements"
  );
  const achievements = await Achievements.deploy();
  await achievements.waitForDeployment();
  return { achievements, owner, user1, user2, other };
}

describe("SpellBlocAchievements", function () {
  describe("Deployment / seeded data", function () {
    it("seeds exactly 9 achievement templates", async function () {
      const { achievements } = await loadFixture(deployAchievementsFixture);
      expect(await achievements.totalAchievements()).to.equal(9n);
    });

    it("seeds 'First Steps' as soulbound, free, unlimited MILESTONE", async function () {
      const { achievements } = await loadFixture(deployAchievementsFixture);
      const a = await achievements.getAchievement(ACH.FIRST_STEPS);
      expect(a.name).to.equal("First Steps");
      expect(a.achievementType).to.equal(AchievementType.MILESTONE);
      expect(a.rarity).to.equal(Rarity.COMMON);
      expect(a.soulbound).to.equal(true);
      expect(a.purchasable).to.equal(false);
      expect(a.price).to.equal(0n);
      expect(a.maxSupply).to.equal(0n);
      expect(a.active).to.equal(true);
    });

    it("seeds 'Golden Star' as purchasable, NOT soulbound, priced, capped supply", async function () {
      const { achievements } = await loadFixture(deployAchievementsFixture);
      const a = await achievements.getAchievement(ACH.GOLDEN_STAR);
      expect(a.soulbound).to.equal(false);
      expect(a.purchasable).to.equal(true);
      expect(a.price).to.equal(ethers.parseEther("0.5"));
      expect(a.maxSupply).to.equal(1000n);
    });

    it("getAchievement reverts for an out-of-range id", async function () {
      const { achievements } = await loadFixture(deployAchievementsFixture);
      await expect(achievements.getAchievement(999)).to.be.revertedWith(
        "Achievement does not exist"
      );
    });
  });

  describe("mintAchievement — access control and validation", function () {
    it("reverts for a non-owner", async function () {
      const { achievements, other, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(other)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts while paused, succeeds after unpause", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements.connect(owner).pause();
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Pausable: paused");

      await achievements.connect(owner).unpause();
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.emit(achievements, "AchievementMinted");
    });

    it("reverts for a non-existent achievement id", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, 999, "ipfs://x")
      ).to.be.revertedWith("Achievement does not exist");
    });

    it("reverts for a purchasable achievement (must use purchaseAchievement)", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.GOLDEN_STAR, "ipfs://x")
      ).to.be.revertedWith("Use purchaseAchievement for purchasable items");
    });

    it("reverts for an inactive achievement", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Achievement is not active");
    });

    it("reverts if the user already holds this achievement", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://y")
      ).to.be.revertedWith("User already has this achievement");
    });

    it("reverts once maxSupply is reached", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      const tx = await achievements
        .connect(owner)
        .createAchievement(
          "Limited Badge",
          "Only one exists",
          AchievementType.SPECIAL,
          Rarity.LEGENDARY,
          0,
          true,
          false,
          0,
          1 // maxSupply = 1
        );
      await tx.wait();
      const newId = (await achievements.totalAchievements()) - 1n;

      await achievements
        .connect(owner)
        .mintAchievement(user1.address, newId, "ipfs://a");
      await expect(
        achievements
          .connect(owner)
          .mintAchievement(user2.address, newId, "ipfs://b")
      ).to.be.revertedWith("Max supply reached");
    });
  });

  describe("mintAchievement — happy path bookkeeping", function () {
    it("mints, records ownership, tracks first achiever, updates holder/count stats, emits AchievementMinted", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );

      const tx = achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://meta");

      await expect(tx)
        .to.emit(achievements, "AchievementMinted")
        .withArgs(user1.address, 0n, ACH.FIRST_STEPS, "First Steps");

      expect(await achievements.ownerOf(0)).to.equal(user1.address);
      expect(
        await achievements.hasAchievement(user1.address, ACH.FIRST_STEPS)
      ).to.equal(true);
      expect(await achievements.achievementCreator(ACH.FIRST_STEPS)).to.equal(
        user1.address
      );
      expect(await achievements.totalHolders()).to.equal(1n);
      expect(await achievements.userAchievementCount(user1.address)).to.equal(
        1n
      );

      const a = await achievements.getAchievement(ACH.FIRST_STEPS);
      expect(a.totalMinted).to.equal(1n);

      const owned = await achievements.getUserAchievements(user1.address);
      expect(owned.length).to.equal(1);
      expect(owned[0]).to.equal(0n);
    });

    it("does not increment totalHolders for a second achievement minted to the same user", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.WORD_EXPLORER, "ipfs://b");

      expect(await achievements.totalHolders()).to.equal(1n);
      expect(await achievements.userAchievementCount(user1.address)).to.equal(
        2n
      );
    });
  });

  describe("purchaseAchievement", function () {
    it("reverts for a non-purchasable achievement", async function () {
      const { achievements, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(user1)
          .purchaseAchievement(ACH.FIRST_STEPS, "ipfs://x", {
            value: ethers.parseEther("1"),
          })
      ).to.be.revertedWith("Achievement is not purchasable");
    });

    it("reverts on underpayment", async function () {
      const { achievements, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(user1)
          .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
            value: ethers.parseEther("0.49"),
          })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("charges exact price, mints, refunds excess, emits both events", async function () {
      const { achievements, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      const price = ethers.parseEther("0.5");
      const overpay = ethers.parseEther("0.1");

      const tx = achievements
        .connect(user1)
        .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://gold", {
          value: price + overpay,
        });

      await expect(tx)
        .to.emit(achievements, "AchievementPurchased")
        .withArgs(user1.address, ACH.GOLDEN_STAR, price + overpay);
      await expect(tx)
        .to.emit(achievements, "AchievementMinted")
        .withArgs(user1.address, 0n, ACH.GOLDEN_STAR, "Golden Star");
      await expect(tx).to.changeEtherBalance(user1, -price);

      expect(await achievements.ownerOf(0)).to.equal(user1.address);
      expect(
        await achievements.hasAchievement(user1.address, ACH.GOLDEN_STAR)
      ).to.equal(true);
    });

    it("reverts if the user already owns this purchasable achievement", async function () {
      const { achievements, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(user1)
        .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://a", {
          value: ethers.parseEther("0.5"),
        });
      await expect(
        achievements
          .connect(user1)
          .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://b", {
            value: ethers.parseEther("0.5"),
          })
      ).to.be.revertedWith("Already own this achievement");
    });

    it("respects maxSupply for purchasable achievements", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .createAchievement(
          "Limited Purchasable",
          "One only",
          AchievementType.SPECIAL,
          Rarity.EPIC,
          0,
          false,
          true,
          ethers.parseEther("1"),
          1
        );
      const newId = (await achievements.totalAchievements()) - 1n;

      await achievements
        .connect(user1)
        .purchaseAchievement(newId, "ipfs://a", {
          value: ethers.parseEther("1"),
        });
      await expect(
        achievements.connect(user2).purchaseAchievement(newId, "ipfs://b", {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("Max supply reached");
    });

    it("reverts while paused, succeeds after unpause", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements.connect(owner).pause();
      await expect(
        achievements
          .connect(user1)
          .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
            value: ethers.parseEther("0.5"),
          })
      ).to.be.revertedWith("Pausable: paused");

      await achievements.connect(owner).unpause();
      await expect(
        achievements
          .connect(user1)
          .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
            value: ethers.parseEther("0.5"),
          })
      ).to.emit(achievements, "AchievementPurchased");
    });
  });

  describe("Soulbound behavior (finding — see also test/SoulboundComparison.test.js)", function () {
    it.skip(
      "[FINDING] transferFrom of a soulbound-flagged achievement should revert, per the contract's own NatSpec (\"Soulbound tokens\") and the Achievement.soulbound=true field — SpellBlocAchievements.sol:439-454",
      async function () {
        const { achievements, owner, user1, user2 } = await loadFixture(
          deployAchievementsFixture
        );
        await achievements
          .connect(owner)
          .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");

        await expect(
          achievements
            .connect(user1)
            .transferFrom(user1.address, user2.address, 0)
        ).to.be.reverted;
      }
    );

    it("[ACTUAL BEHAVIOR — documents the bug, does not endorse it] a soulbound-flagged achievement CAN be freely transferred via transferFrom", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");

      await achievements
        .connect(user1)
        .transferFrom(user1.address, user2.address, 0);

      expect(await achievements.ownerOf(0)).to.equal(user2.address);
    });

    it("[ACTUAL BEHAVIOR] safeTransferFrom (both overloads) also succeed for a soulbound-flagged token", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.WORD_EXPLORER, "ipfs://x");

      await achievements
        .connect(user1)
        ["safeTransferFrom(address,address,uint256)"](
          user1.address,
          user2.address,
          0
        );
      expect(await achievements.ownerOf(0)).to.equal(user2.address);

      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.SPELLING_CHAMPION, "ipfs://y");
      await achievements
        .connect(user1)
        ["safeTransferFrom(address,address,uint256,bytes)"](
          user1.address,
          user2.address,
          1,
          "0x"
        );
      expect(await achievements.ownerOf(1)).to.equal(user2.address);
    });

    it("[ACTUAL BEHAVIOR] approve-then-transferFrom by a third party also succeeds for a soulbound-flagged token", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");

      await achievements.connect(user1).approve(user2.address, 0);
      await achievements
        .connect(user2)
        .transferFrom(user1.address, user2.address, 0);
      expect(await achievements.ownerOf(0)).to.equal(user2.address);
    });

    it("a NON-soulbound purchased achievement (Golden Star) transferring is CORRECT/intended behavior, not a finding", async function () {
      const { achievements, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(user1)
        .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.5"),
        });
      await achievements
        .connect(user1)
        .transferFrom(user1.address, user2.address, 0);
      expect(await achievements.ownerOf(0)).to.equal(user2.address);
    });
  });

  describe("Admin access control", function () {
    it("createAchievement reverts for a non-owner", async function () {
      const { achievements, other } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(other)
          .createAchievement(
            "X",
            "Y",
            AchievementType.SPECIAL,
            Rarity.COMMON,
            0,
            true,
            false,
            0,
            0
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("updateAchievementPrice reverts for a non-owner, succeeds for owner", async function () {
      const { achievements, owner, other } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements
          .connect(other)
          .updateAchievementPrice(ACH.GOLDEN_STAR, ethers.parseEther("9"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await achievements
        .connect(owner)
        .updateAchievementPrice(ACH.GOLDEN_STAR, ethers.parseEther("9"));
      const a = await achievements.getAchievement(ACH.GOLDEN_STAR);
      expect(a.price).to.equal(ethers.parseEther("9"));
    });

    it("toggleAchievementActive reverts for a non-owner, flips state for owner", async function () {
      const { achievements, owner, other } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements.connect(other).toggleAchievementActive(ACH.FIRST_STEPS)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      expect((await achievements.getAchievement(ACH.FIRST_STEPS)).active).to.equal(
        false
      );
      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      expect((await achievements.getAchievement(ACH.FIRST_STEPS)).active).to.equal(
        true
      );
    });

    it("pause/unpause revert for a non-owner", async function () {
      const { achievements, other } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(achievements.connect(other).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(achievements.connect(other).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  describe("withdrawFunds", function () {
    it("reverts for a non-owner", async function () {
      const { achievements, user1, other } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(user1)
        .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.5"),
        });
      await expect(
        achievements.connect(other).withdrawFunds()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts when balance is zero", async function () {
      const { achievements, owner } = await loadFixture(
        deployAchievementsFixture
      );
      await expect(
        achievements.connect(owner).withdrawFunds()
      ).to.be.revertedWith("No funds to withdraw");
    });

    it("sends the full balance to the owner and zeroes the contract", async function () {
      const { achievements, owner, user1 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(user1)
        .purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.5"),
        });

      const tx = achievements.connect(owner).withdrawFunds();
      await expect(tx).to.changeEtherBalance(owner, ethers.parseEther("0.5"));
      expect(
        await ethers.provider.getBalance(await achievements.getAddress())
      ).to.equal(0n);
    });
  });

  describe("getStats", function () {
    it("reports totalAchievements, totalHolders, and the token counter", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(
        deployAchievementsFixture
      );
      await achievements
        .connect(owner)
        .mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements
        .connect(owner)
        .mintAchievement(user2.address, ACH.FIRST_STEPS, "ipfs://b");

      const [totalAchievements, totalHolders, totalMintedTokens] =
        await achievements.getStats();
      expect(totalAchievements).to.equal(9n);
      expect(totalHolders).to.equal(2n);
      expect(totalMintedTokens).to.equal(2n);
    });
  });
});
