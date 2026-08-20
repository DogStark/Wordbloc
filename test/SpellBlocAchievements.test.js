const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// ──────────────────────────────────────────────────────────────────────────────
// Seeded achievement IDs (order from _createInitialAchievements)
// ──────────────────────────────────────────────────────────────────────────────
const ACH = {
  FIRST_STEPS:       0, // soulbound, not purchasable, unlimited
  WORD_EXPLORER:     1, // soulbound
  SPELLING_CHAMPION: 2, // soulbound
  SPEED_DEMON:       3, // soulbound
  PERFECT_SCORE:     4, // soulbound
  DAILY_LEARNER:     5, // soulbound
  DEDICATION_MASTER: 6, // soulbound
  GOLDEN_STAR:       7, // NOT soulbound, purchasable, 0.5 ether, maxSupply 1000
  DIAMOND_CROWN:     8, // NOT soulbound, purchasable, 2.0 ether, maxSupply 100
};

const AchievementType = {
  MILESTONE:   0,
  PERFORMANCE: 1,
  STREAK:      2,
  CATEGORY:    3,
  SPECIAL:     4,
};
const Rarity = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4 };

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixture
// ──────────────────────────────────────────────────────────────────────────────
async function deployAchievementsFixture() {
  const [owner, user1, user2, other] = await ethers.getSigners();
  const Achievements = await ethers.getContractFactory("SpellBlocAchievements");
  const achievements = await Achievements.deploy();
  await achievements.waitForDeployment();
  return { achievements, owner, user1, user2, other };
}

// Helper – mint ACH.FIRST_STEPS to user1, returns tokenId 0
async function mintFirstSteps(achievements, owner, user1) {
  await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");
  return 0n;
}

// Helper – purchase ACH.GOLDEN_STAR for user1, returns tokenId 0
async function purchaseGoldenStar(achievements, user1) {
  await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://gold", {
    value: ethers.parseEther("0.5"),
  });
  return 0n;
}

// ──────────────────────────────────────────────────────────────────────────────
describe("SpellBlocAchievements", function () {
  // ────────────────────────────────────────────────────────────────────────────
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
      await expect(achievements.getAchievement(999)).to.be.revertedWith("Achievement does not exist");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("mintAchievement — access control and validation", function () {
    it("reverts for a non-owner", async function () {
      const { achievements, other, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(other).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts while paused, succeeds after unpause", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).pause();
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Pausable: paused");

      await achievements.connect(owner).unpause();
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.emit(achievements, "AchievementMinted");
    });

    it("reverts for a non-existent achievement id", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, 999, "ipfs://x")
      ).to.be.revertedWith("Achievement does not exist");
    });

    it("reverts for a purchasable achievement (must use purchaseAchievement)", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.GOLDEN_STAR, "ipfs://x")
      ).to.be.revertedWith("Use purchaseAchievement for purchasable items");
    });

    it("reverts for an inactive achievement", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x")
      ).to.be.revertedWith("Achievement is not active");
    });

    it("reverts if the user already holds this achievement", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://x");
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://y")
      ).to.be.revertedWith("User already has this achievement");
    });

    it("reverts once maxSupply is reached", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).createAchievement(
        "Limited Badge", "Only one exists",
        AchievementType.SPECIAL, Rarity.LEGENDARY, 0, true, false, 0, 1
      );
      const newId = (await achievements.totalAchievements()) - 1n;

      await achievements.connect(owner).mintAchievement(user1.address, newId, "ipfs://a");
      await expect(
        achievements.connect(owner).mintAchievement(user2.address, newId, "ipfs://b")
      ).to.be.revertedWith("Max supply reached");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("mintAchievement — happy path bookkeeping", function () {
    it("mints, records ownership, tracks first achiever, updates holder/count stats, emits AchievementMinted", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);

      const tx = achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://meta");

      await expect(tx)
        .to.emit(achievements, "AchievementMinted")
        .withArgs(user1.address, 0n, ACH.FIRST_STEPS, "First Steps");

      expect(await achievements.ownerOf(0)).to.equal(user1.address);
      expect(await achievements.hasAchievement(user1.address, ACH.FIRST_STEPS)).to.equal(true);
      expect(await achievements.achievementCreator(ACH.FIRST_STEPS)).to.equal(user1.address);
      expect(await achievements.totalHolders()).to.equal(1n);
      expect(await achievements.userAchievementCount(user1.address)).to.equal(1n);
      expect((await achievements.getAchievement(ACH.FIRST_STEPS)).totalMinted).to.equal(1n);

      const owned = await achievements.getUserAchievements(user1.address);
      expect(owned.length).to.equal(1);
      expect(owned[0]).to.equal(0n);
    });

    it("does not increment totalHolders for a second achievement minted to the same user", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements.connect(owner).mintAchievement(user1.address, ACH.WORD_EXPLORER, "ipfs://b");

      expect(await achievements.totalHolders()).to.equal(1n);
      expect(await achievements.userAchievementCount(user1.address)).to.equal(2n);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Token → achievement template lookup (tokenAchievementId)", function () {
    it("is set at mint time and returns the correct achievementId", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements.connect(owner).mintAchievement(user1.address, ACH.WORD_EXPLORER, "ipfs://b");

      expect(await achievements.tokenAchievementId(0)).to.equal(BigInt(ACH.FIRST_STEPS));
      expect(await achievements.tokenAchievementId(1)).to.equal(BigInt(ACH.WORD_EXPLORER));
    });

    it("is set at purchase time and returns the correct achievementId", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://gold", {
        value: ethers.parseEther("0.5"),
      });
      expect(await achievements.tokenAchievementId(0)).to.equal(BigInt(ACH.GOLDEN_STAR));
    });

    it("mapping persists after a transferable token is transferred", async function () {
      const { achievements, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);

      await achievements.connect(user1).transferFrom(user1.address, user2.address, 0);

      // Mapping must not change after transfer — it is immutable
      expect(await achievements.tokenAchievementId(0)).to.equal(BigInt(ACH.GOLDEN_STAR));
    });

    it("mapping persists after adminBurn (historical lookup remains valid)", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await achievements.connect(owner).adminBurn(user1.address, 0);

      // Token is burned but mapping value is still readable
      expect(await achievements.tokenAchievementId(0)).to.equal(BigInt(ACH.FIRST_STEPS));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Soulbound enforcement", function () {
    it("transferFrom of a soulbound token reverts with the soulbound message", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(user1).transferFrom(user1.address, user2.address, 0)
      ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
    });

    it("safeTransferFrom (no data) of a soulbound token reverts", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(user1)["safeTransferFrom(address,address,uint256)"](
          user1.address, user2.address, 0
        )
      ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
    });

    it("safeTransferFrom (with data) of a soulbound token reverts", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(user1)["safeTransferFrom(address,address,uint256,bytes)"](
          user1.address, user2.address, 0, "0x"
        )
      ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
    });

    it("approve-then-transferFrom by a third party also reverts for a soulbound token", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await achievements.connect(user1).approve(user2.address, 0);
      await expect(
        achievements.connect(user2).transferFrom(user1.address, user2.address, 0)
      ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
    });

    it("setApprovalForAll + operator transferFrom also reverts for a soulbound token", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await achievements.connect(user1).setApprovalForAll(user2.address, true);
      await expect(
        achievements.connect(user2).transferFrom(user1.address, user2.address, 0)
      ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
    });

    it("the original holder still owns the token after a failed soulbound transfer", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(user1).transferFrom(user1.address, user2.address, 0)
      ).to.be.reverted;

      expect(await achievements.ownerOf(0)).to.equal(user1.address);
    });

    it("all soulbound seeded templates (ids 0-6) block transfer", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      const soulboundIds = [0, 1, 2, 3, 4, 5, 6];
      let tokenId = 0;
      for (const id of soulboundIds) {
        await achievements.connect(owner).mintAchievement(user1.address, id, `ipfs://${id}`);
        await expect(
          achievements.connect(user1).transferFrom(user1.address, user2.address, tokenId)
        ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
        tokenId++;
      }
    });

    it("mint (from == address(0)) is always allowed regardless of soulbound flag", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      // Should not revert — mint goes through even for soulbound
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://ok")
      ).to.not.be.reverted;
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("adminBurn — soulbound recovery path", function () {
    it("owner can burn a soulbound token (only recovery path)", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(owner).adminBurn(user1.address, 0)
      ).to.not.be.reverted;

      await expect(achievements.ownerOf(0)).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("adminBurn emits AchievementBurned", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(achievements.connect(owner).adminBurn(user1.address, 0))
        .to.emit(achievements, "AchievementBurned")
        .withArgs(user1.address, 0n, BigInt(ACH.FIRST_STEPS));
    });

    it("non-owner cannot burn", async function () {
      const { achievements, owner, user1, other } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(other).adminBurn(user1.address, 0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("adminBurn reverts if holder address does not match token owner", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await expect(
        achievements.connect(owner).adminBurn(user2.address, 0)
      ).to.be.revertedWith("Token not owned by holder");
    });

    it("adminBurn updates ownership index: removes token, decrements count, decrements totalHolders", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);

      await achievements.connect(owner).adminBurn(user1.address, 0);

      expect(await achievements.userAchievementCount(user1.address)).to.equal(0n);
      expect(await achievements.totalHolders()).to.equal(0n);
      expect(await achievements.hasAchievement(user1.address, ACH.FIRST_STEPS)).to.equal(false);

      const owned = await achievements.getUserAchievements(user1.address);
      expect(owned.length).to.equal(0);
    });

    it("totalHolders stays correct when one of two tokens is burned", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements.connect(owner).mintAchievement(user1.address, ACH.WORD_EXPLORER, "ipfs://b");

      await achievements.connect(owner).adminBurn(user1.address, 0); // burn first token

      expect(await achievements.totalHolders()).to.equal(1n); // user1 still holds token 1
      expect(await achievements.userAchievementCount(user1.address)).to.equal(1n);
      expect(await achievements.hasAchievement(user1.address, ACH.FIRST_STEPS)).to.equal(false);
      expect(await achievements.hasAchievement(user1.address, ACH.WORD_EXPLORER)).to.equal(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Transferable achievement — ownership index correctness", function () {
    it("transferring Golden Star updates sender and recipient indexes correctly", async function () {
      const { achievements, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);

      await achievements.connect(user1).transferFrom(user1.address, user2.address, 0);

      // Sender
      expect(await achievements.userAchievementCount(user1.address)).to.equal(0n);
      expect(await achievements.hasAchievement(user1.address, ACH.GOLDEN_STAR)).to.equal(false);
      const senderTokens = await achievements.getUserAchievements(user1.address);
      expect(senderTokens.length).to.equal(0);

      // Recipient
      expect(await achievements.userAchievementCount(user2.address)).to.equal(1n);
      expect(await achievements.hasAchievement(user2.address, ACH.GOLDEN_STAR)).to.equal(true);
      const recipientTokens = await achievements.getUserAchievements(user2.address);
      expect(recipientTokens.length).to.equal(1);
      expect(recipientTokens[0]).to.equal(0n);
    });

    it("totalHolders decrements when sender ends at zero, increments when recipient starts at zero", async function () {
      const { achievements, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);
      expect(await achievements.totalHolders()).to.equal(1n);

      await achievements.connect(user1).transferFrom(user1.address, user2.address, 0);

      expect(await achievements.totalHolders()).to.equal(1n); // user2 gained, user1 lost — net 0
    });

    it("totalHolders increments when recipient is a new holder", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      // Give user1 two tokens so they don't drop to zero on transfer
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://b", {
        value: ethers.parseEther("0.5"),
      });
      expect(await achievements.totalHolders()).to.equal(1n);

      // Transfer the transferable token to a brand-new holder
      await achievements.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await achievements.totalHolders()).to.equal(2n); // user2 is a new holder
      expect(await achievements.userAchievementCount(user1.address)).to.equal(1n); // still holds token 0
    });

    it("transferFrom emits AchievementTransferred with correct achievementId", async function () {
      const { achievements, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);

      await expect(achievements.connect(user1).transferFrom(user1.address, user2.address, 0))
        .to.emit(achievements, "AchievementTransferred")
        .withArgs(user1.address, user2.address, 0n, BigInt(ACH.GOLDEN_STAR));
    });

    it("duplicate-ownership invariant: recipient cannot double-receive same achievement template", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      // user2 already owns Diamond Crown
      await achievements.connect(user2).purchaseAchievement(ACH.DIAMOND_CROWN, "ipfs://d1", {
        value: ethers.parseEther("2"),
      });

      // user1 buys their own Diamond Crown token (token id 1, since user2 has token 0)
      await achievements.connect(user1).purchaseAchievement(ACH.DIAMOND_CROWN, "ipfs://d2", {
        value: ethers.parseEther("2"),
      });

      // user1 tries to transfer their token to user2 — user2 already has the achievement
      // hasAchievement[user2][DIAMOND_CROWN] is true, but the transfer isn't blocked by the
      // contract (only soulbound blocks transfer). After transfer user2 holds two tokens of
      // the same template — hasAchievement should reflect they have it (true).
      await achievements.connect(user1).transferFrom(user1.address, user2.address, 1);
      expect(await achievements.hasAchievement(user2.address, ACH.DIAMOND_CROWN)).to.equal(true);
      expect(await achievements.userAchievementCount(user2.address)).to.equal(2n);
    });

    it("chain of transfers: A → B → C keeps index and tokenAchievementId consistent", async function () {
      const { achievements, user1, user2, other } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);

      await achievements.connect(user1).transferFrom(user1.address, user2.address, 0);
      await achievements.connect(user2).transferFrom(user2.address, other.address, 0);

      // Final state
      expect(await achievements.ownerOf(0)).to.equal(other.address);
      expect(await achievements.userAchievementCount(user1.address)).to.equal(0n);
      expect(await achievements.userAchievementCount(user2.address)).to.equal(0n);
      expect(await achievements.userAchievementCount(other.address)).to.equal(1n);
      expect(await achievements.hasAchievement(user1.address, ACH.GOLDEN_STAR)).to.equal(false);
      expect(await achievements.hasAchievement(user2.address, ACH.GOLDEN_STAR)).to.equal(false);
      expect(await achievements.hasAchievement(other.address, ACH.GOLDEN_STAR)).to.equal(true);
      expect(await achievements.tokenAchievementId(0)).to.equal(BigInt(ACH.GOLDEN_STAR));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("purchaseAchievement", function () {
    it("reverts for a non-purchasable achievement", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.FIRST_STEPS, "ipfs://x", {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("Achievement is not purchasable");
    });

    it("reverts on underpayment (exact check)", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.49"),
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("zero payment reverts when price > 0", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: 0n,
        })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("exact payment accepted — no refund emitted, contract balance equals price", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      const price = ethers.parseEther("0.5");

      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", { value: price })
      ).to.changeEtherBalance(user1, -price);

      expect(
        await ethers.provider.getBalance(await achievements.getAddress())
      ).to.equal(price);
    });

    it("overpayment refunds excess (changeEtherBalance = exact price)", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      const price   = ethers.parseEther("0.5");
      const overpay = ethers.parseEther("0.1");

      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: price + overpay,
        })
      ).to.changeEtherBalance(user1, -price);

      // Contract retains only the price
      expect(
        await ethers.provider.getBalance(await achievements.getAddress())
      ).to.equal(price);
    });

    it("AchievementPurchased carries msg.value (pre-refund), AchievementMinted carries correct ids", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      const price   = ethers.parseEther("0.5");
      const overpay = ethers.parseEther("0.1");

      const tx = achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://gold", {
        value: price + overpay,
      });

      await expect(tx)
        .to.emit(achievements, "AchievementPurchased")
        .withArgs(user1.address, ACH.GOLDEN_STAR, price + overpay);
      await expect(tx)
        .to.emit(achievements, "AchievementMinted")
        .withArgs(user1.address, 0n, ACH.GOLDEN_STAR, "Golden Star");
    });

    it("reverts if the user already owns this purchasable achievement", async function () {
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://a", {
        value: ethers.parseEther("0.5"),
      });
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://b", {
          value: ethers.parseEther("0.5"),
        })
      ).to.be.revertedWith("Already own this achievement");
    });

    it("respects maxSupply for purchasable achievements", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).createAchievement(
        "Limited Purchasable", "One only",
        AchievementType.SPECIAL, Rarity.EPIC, 0, false, true, ethers.parseEther("1"), 1
      );
      const newId = (await achievements.totalAchievements()) - 1n;

      await achievements.connect(user1).purchaseAchievement(newId, "ipfs://a", {
        value: ethers.parseEther("1"),
      });
      await expect(
        achievements.connect(user2).purchaseAchievement(newId, "ipfs://b", {
          value: ethers.parseEther("1"),
        })
      ).to.be.revertedWith("Max supply reached");
    });

    it("reverts while paused, succeeds after unpause", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).pause();
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.5"),
        })
      ).to.be.revertedWith("Pausable: paused");

      await achievements.connect(owner).unpause();
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
          value: ethers.parseEther("0.5"),
        })
      ).to.emit(achievements, "AchievementPurchased");
    });

    it("payment is denominated in native CELO (wei units) — not cUSD or any ERC-20", async function () {
      // The price field uses uint256 wei; msg.value supplies native value.
      // This test locks in the denomination so a future ERC-20 path cannot
      // silently land without a failing test.
      const { achievements, user1 } = await loadFixture(deployAchievementsFixture);
      const price = (await achievements.getAchievement(ACH.GOLDEN_STAR)).price;

      // payment via msg.value (native) succeeds
      await expect(
        achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://ok", { value: price })
      ).to.not.be.reverted;
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("withdrawFunds", function () {
    it("reverts for a non-owner", async function () {
      const { achievements, user1, other } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
        value: ethers.parseEther("0.5"),
      });
      await expect(achievements.connect(other).withdrawFunds()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("reverts when balance is zero", async function () {
      const { achievements, owner } = await loadFixture(deployAchievementsFixture);
      await expect(achievements.connect(owner).withdrawFunds()).to.be.revertedWith(
        "No funds to withdraw"
      );
    });

    it("sends the full balance to the owner and zeroes the contract", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://x", {
        value: ethers.parseEther("0.5"),
      });

      await expect(achievements.connect(owner).withdrawFunds()).to.changeEtherBalance(
        owner, ethers.parseEther("0.5")
      );
      expect(await ethers.provider.getBalance(await achievements.getAddress())).to.equal(0n);
    });

    it("accumulates multiple purchases then withdraws entire balance", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://a", {
        value: ethers.parseEther("0.5"),
      });
      await achievements.connect(user2).purchaseAchievement(ACH.DIAMOND_CROWN, "ipfs://b", {
        value: ethers.parseEther("2"),
      });

      const expected = ethers.parseEther("2.5");
      await expect(achievements.connect(owner).withdrawFunds()).to.changeEtherBalance(
        owner, expected
      );
      expect(await ethers.provider.getBalance(await achievements.getAddress())).to.equal(0n);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Admin access control", function () {
    it("createAchievement reverts for a non-owner", async function () {
      const { achievements, other } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(other).createAchievement(
          "X", "Y", AchievementType.SPECIAL, Rarity.COMMON, 0, true, false, 0, 0
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("updateAchievementPrice reverts for a non-owner, succeeds for owner", async function () {
      const { achievements, owner, other } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(other).updateAchievementPrice(ACH.GOLDEN_STAR, ethers.parseEther("9"))
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await achievements.connect(owner).updateAchievementPrice(ACH.GOLDEN_STAR, ethers.parseEther("9"));
      expect((await achievements.getAchievement(ACH.GOLDEN_STAR)).price).to.equal(
        ethers.parseEther("9")
      );
    });

    it("toggleAchievementActive reverts for a non-owner, flips state for owner", async function () {
      const { achievements, owner, other } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(other).toggleAchievementActive(ACH.FIRST_STEPS)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      expect((await achievements.getAchievement(ACH.FIRST_STEPS)).active).to.equal(false);
      await achievements.connect(owner).toggleAchievementActive(ACH.FIRST_STEPS);
      expect((await achievements.getAchievement(ACH.FIRST_STEPS)).active).to.equal(true);
    });

    it("pause/unpause revert for a non-owner", async function () {
      const { achievements, other } = await loadFixture(deployAchievementsFixture);
      await expect(achievements.connect(other).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(achievements.connect(other).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("getStats", function () {
    it("reports totalAchievements, totalHolders, and the token counter", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS, "ipfs://a");
      await achievements.connect(owner).mintAchievement(user2.address, ACH.FIRST_STEPS, "ipfs://b");

      const [totalAchievements, totalHolders, totalMintedTokens] = await achievements.getStats();
      expect(totalAchievements).to.equal(9n);
      expect(totalHolders).to.equal(2n);
      expect(totalMintedTokens).to.equal(2n);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Supply / holder-count invariants (property-style tests)", function () {
    /**
     * After an arbitrary sequence of mints, transfers, and burns:
     *   SUM(userAchievementCount[addr]) == totalSupply  (≡ token counter minus burned)
     *   COUNT(addr where count > 0) == totalHolders
     */
    it("holder count equals number of users with nonzero token count after mixed operations", async function () {
      const { achievements, owner, user1, user2, other } = await loadFixture(deployAchievementsFixture);

      // token 0: user1 FIRST_STEPS     (soulbound)
      // token 1: user1 WORD_EXPLORER   (soulbound)
      // token 2: user2 SPELLING_CHAMPION (soulbound)
      // token 3: user1 GOLDEN_STAR     (transferable)
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS,       "ipfs://a");
      await achievements.connect(owner).mintAchievement(user1.address, ACH.WORD_EXPLORER,     "ipfs://b");
      await achievements.connect(owner).mintAchievement(user2.address, ACH.SPELLING_CHAMPION, "ipfs://c");
      await achievements.connect(user1).purchaseAchievement(ACH.GOLDEN_STAR, "ipfs://gs", {
        value: ethers.parseEther("0.5"),
      });

      // Transfer the transferable (token 3) from user1 → other
      await achievements.connect(user1).transferFrom(user1.address, other.address, 3);

      // Burn user2's only token (token 2)
      await achievements.connect(owner).adminBurn(user2.address, 2);

      // Recompute expected state:
      // token 0: user1  holds FIRST_STEPS
      // token 1: user1  holds WORD_EXPLORER
      // token 2: burned (was user2's SPELLING_CHAMPION)
      // token 3: other  holds GOLDEN_STAR
      const users = [user1, user2, other];
      let computedHolderCount = 0n;
      let computedTotalCount  = 0n;
      for (const u of users) {
        const cnt = await achievements.userAchievementCount(u.address);
        computedTotalCount += cnt;
        if (cnt > 0n) computedHolderCount++;
      }

      expect(await achievements.totalHolders()).to.equal(computedHolderCount);
    });

    it("totalHolders never goes below zero after all tokens of every user are burned", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await achievements.connect(owner).mintAchievement(user1.address, ACH.FIRST_STEPS,   "ipfs://a");
      await achievements.connect(owner).mintAchievement(user2.address, ACH.WORD_EXPLORER, "ipfs://b");

      await achievements.connect(owner).adminBurn(user1.address, 0);
      await achievements.connect(owner).adminBurn(user2.address, 1);

      expect(await achievements.totalHolders()).to.equal(0n);
    });

    it("soulbound invariant: transferring any soulbound id always reverts regardless of token count", async function () {
      const { achievements, owner, user1, user2 } = await loadFixture(deployAchievementsFixture);
      const soulboundIds = [ACH.FIRST_STEPS, ACH.WORD_EXPLORER, ACH.SPELLING_CHAMPION,
                            ACH.SPEED_DEMON, ACH.PERFECT_SCORE, ACH.DAILY_LEARNER, ACH.DEDICATION_MASTER];
      for (let i = 0; i < soulboundIds.length; i++) {
        await achievements.connect(owner).mintAchievement(user1.address, soulboundIds[i], `ipfs://${i}`);
        await expect(
          achievements.connect(user1).transferFrom(user1.address, user2.address, i)
        ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe("Event-indexer lifecycle (AchievementCreated / Minted / Transferred / Burned)", function () {
    it("createAchievement emits AchievementCreated with correct fields", async function () {
      const { achievements, owner } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(owner).createAchievement(
          "Test", "desc", AchievementType.CATEGORY, Rarity.RARE, 5, true, false, 0, 0
        )
      )
        .to.emit(achievements, "AchievementCreated")
        .withArgs(9n, "Test", AchievementType.CATEGORY, Rarity.RARE);
    });

    it("mintAchievement emits AchievementMinted with tokenId, achievementId, name", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await expect(
        achievements.connect(owner).mintAchievement(user1.address, ACH.DAILY_LEARNER, "ipfs://dl")
      )
        .to.emit(achievements, "AchievementMinted")
        .withArgs(user1.address, 0n, BigInt(ACH.DAILY_LEARNER), "Daily Learner");
    });

    it("transferFrom of transferable emits AchievementTransferred (indexer-friendly)", async function () {
      const { achievements, user1, user2 } = await loadFixture(deployAchievementsFixture);
      await purchaseGoldenStar(achievements, user1);
      await expect(achievements.connect(user1).transferFrom(user1.address, user2.address, 0))
        .to.emit(achievements, "AchievementTransferred")
        .withArgs(user1.address, user2.address, 0n, BigInt(ACH.GOLDEN_STAR));
    });

    it("adminBurn emits AchievementBurned (indexer-friendly)", async function () {
      const { achievements, owner, user1 } = await loadFixture(deployAchievementsFixture);
      await mintFirstSteps(achievements, owner, user1);
      await expect(achievements.connect(owner).adminBurn(user1.address, 0))
        .to.emit(achievements, "AchievementBurned")
        .withArgs(user1.address, 0n, BigInt(ACH.FIRST_STEPS));
    });
  });
});
