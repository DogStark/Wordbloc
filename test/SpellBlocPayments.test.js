const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

// PlanType enum: MONTHLY = 0, YEARLY = 1, FAMILY = 2
const PlanType = { MONTHLY: 0, YEARLY: 1, FAMILY: 2 };

const DAY = 24 * 60 * 60;
const MONTHLY_DURATION = 30 * DAY;
const YEARLY_DURATION = 365 * DAY; // also used for FAMILY

const PLAN_PRICE = {
  [PlanType.MONTHLY]: ethers.parseEther("2.5"),
  [PlanType.YEARLY]: ethers.parseEther("25"),
  [PlanType.FAMILY]: ethers.parseEther("40"),
};

const PLAN_DURATION = {
  [PlanType.MONTHLY]: MONTHLY_DURATION,
  [PlanType.YEARLY]: YEARLY_DURATION,
  [PlanType.FAMILY]: YEARLY_DURATION,
};

const ACHIEVEMENT_PRICE = {
  1: ethers.parseEther("0.5"),
  2: ethers.parseEther("1.0"),
  3: ethers.parseEther("2.0"),
};

async function deployPaymentsFixture() {
  const [owner, user1, user2, other] = await ethers.getSigners();
  const Payments = await ethers.getContractFactory("SpellBlocPayments");
  const payments = await Payments.deploy();
  await payments.waitForDeployment();
  return { payments, owner, user1, user2, other };
}

async function blockTimestampOf(tx) {
  const receipt = await tx.wait();
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return BigInt(block.timestamp);
}

describe("SpellBlocPayments", function () {
  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      const { payments, owner } = await loadFixture(deployPaymentsFixture);
      expect(await payments.owner()).to.equal(owner.address);
    });

    it("seeds the correct initial plan prices", async function () {
      const { payments } = await loadFixture(deployPaymentsFixture);
      expect(await payments.planPrices(PlanType.MONTHLY)).to.equal(
        PLAN_PRICE[PlanType.MONTHLY]
      );
      expect(await payments.planPrices(PlanType.YEARLY)).to.equal(
        PLAN_PRICE[PlanType.YEARLY]
      );
      expect(await payments.planPrices(PlanType.FAMILY)).to.equal(
        PLAN_PRICE[PlanType.FAMILY]
      );
    });

    it("seeds the correct initial achievement prices", async function () {
      const { payments } = await loadFixture(deployPaymentsFixture);
      expect(await payments.achievementPrices(1)).to.equal(
        ACHIEVEMENT_PRICE[1]
      );
      expect(await payments.achievementPrices(2)).to.equal(
        ACHIEVEMENT_PRICE[2]
      );
      expect(await payments.achievementPrices(3)).to.equal(
        ACHIEVEMENT_PRICE[3]
      );
    });

    it("starts unpaused with zero stats", async function () {
      const { payments } = await loadFixture(deployPaymentsFixture);
      expect(await payments.paused()).to.equal(false);
      const [revenue, subs, achievements] = await payments.getStats();
      expect(revenue).to.equal(0n);
      expect(subs).to.equal(0n);
      expect(achievements).to.equal(0n);
    });
  });

  describe("purchaseSubscription — new purchase per plan type", function () {
    for (const [name, planType] of Object.entries(PlanType)) {
      it(`charges the exact price and computes endTime correctly for ${name}`, async function () {
        const { payments, user1 } = await loadFixture(deployPaymentsFixture);
        const price = PLAN_PRICE[planType];
        const duration = PLAN_DURATION[planType];

        const tx = await payments
          .connect(user1)
          .purchaseSubscription(planType, { value: price });
        const ts = await blockTimestampOf(tx);

        await expect(tx)
          .to.emit(payments, "SubscriptionPurchased")
          .withArgs(user1.address, planType, duration, price);

        const sub = await payments.getSubscription(user1.address);
        expect(sub.user).to.equal(user1.address);
        expect(sub.planType).to.equal(planType);
        expect(sub.startTime).to.equal(ts);
        expect(sub.endTime).to.equal(ts + BigInt(duration));
        expect(sub.active).to.equal(true);
        expect(sub.amountPaid).to.equal(price);
      });
    }

    it("increments totalSubscribers only on a genuinely new subscription", async function () {
      const { payments, user1, user2 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      expect(await payments.totalSubscribers()).to.equal(1n);

      await payments
        .connect(user2)
        .purchaseSubscription(PlanType.YEARLY, {
          value: PLAN_PRICE[PlanType.YEARLY],
        });
      expect(await payments.totalSubscribers()).to.equal(2n);
    });
  });

  describe("purchaseSubscription — renewal of an active subscription", function () {
    it("extends endTime from the OLD endTime, not from now (line 117)", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);

      const firstTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(firstTx);
      const oldEndTime = t0 + BigInt(MONTHLY_DURATION);

      // Move forward but stay within the active window.
      await time.increase(10 * DAY);

      const renewTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const renewalTimestamp = await blockTimestampOf(renewTx);

      const expectedEndTime = oldEndTime + BigInt(MONTHLY_DURATION);
      // Sanity: renewing early must NOT reset to now + duration.
      const wrongResetEndTime = renewalTimestamp + BigInt(MONTHLY_DURATION);
      expect(expectedEndTime).to.not.equal(wrongResetEndTime);

      await expect(renewTx)
        .to.emit(payments, "SubscriptionRenewed")
        .withArgs(user1.address, expectedEndTime, PLAN_PRICE[PlanType.MONTHLY]);

      const sub = await payments.getSubscription(user1.address);
      expect(sub.endTime).to.equal(expectedEndTime);
      // amountPaid accumulates across purchases for an active subscription.
      expect(sub.amountPaid).to.equal(PLAN_PRICE[PlanType.MONTHLY] * 2n);

      // RESULT: the contract gets this right — renewal is additive, matching
      // the issue's expected (non-buggy) behavior. This is a confirmation,
      // not a finding.
    });

    it("does not increment totalSubscribers on renewal", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      expect(await payments.totalSubscribers()).to.equal(1n);
    });

    it("allows switching plan type on renewal (upgrade/downgrade), applying the NEW plan's duration", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);

      const firstTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(firstTx);
      const oldEndTime = t0 + BigInt(MONTHLY_DURATION);

      const upgradeTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.YEARLY, {
          value: PLAN_PRICE[PlanType.YEARLY],
        });
      await upgradeTx.wait();

      const sub = await payments.getSubscription(user1.address);
      expect(sub.planType).to.equal(PlanType.YEARLY);
      // Extension uses the duration of the plan being purchased NOW (YEARLY),
      // added on top of the previous endTime.
      expect(sub.endTime).to.equal(oldEndTime + BigInt(YEARLY_DURATION));
    });
  });

  describe("Expired-subscription transitions and isSubscriptionActive boundary", function () {
    it("a purchase after expiry starts a fresh subscription from now (does not carry over old endTime)", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);

      const firstTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(firstTx);
      const firstEndTime = t0 + BigInt(MONTHLY_DURATION);

      // Move well past expiry.
      await time.increaseTo(firstEndTime + BigInt(DAY));

      const secondTx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t1 = await blockTimestampOf(secondTx);

      await expect(secondTx).to.emit(payments, "SubscriptionPurchased");

      const sub = await payments.getSubscription(user1.address);
      expect(sub.startTime).to.equal(t1);
      expect(sub.endTime).to.equal(t1 + BigInt(MONTHLY_DURATION));
    });

    it("isSubscriptionActive is true one second before endTime", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const tx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(tx);
      const endTime = t0 + BigInt(MONTHLY_DURATION);

      await time.increaseTo(endTime - 1n);
      expect(await payments.isSubscriptionActive(user1.address)).to.equal(
        true
      );
    });

    it("isSubscriptionActive is false at exactly endTime (strict > comparison)", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const tx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(tx);
      const endTime = t0 + BigInt(MONTHLY_DURATION);

      await time.increaseTo(endTime);
      expect(await payments.isSubscriptionActive(user1.address)).to.equal(
        false
      );
    });

    it("isSubscriptionActive is false one second after endTime", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const tx = await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const t0 = await blockTimestampOf(tx);
      const endTime = t0 + BigInt(MONTHLY_DURATION);

      await time.increaseTo(endTime + 1n);
      expect(await payments.isSubscriptionActive(user1.address)).to.equal(
        false
      );
    });
  });

  describe("purchaseAchievement", function () {
    it("charges the exact price, records the purchase, and updates global stats", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const price = ACHIEVEMENT_PRICE[2];

      const tx = await payments
        .connect(user1)
        .purchaseAchievement(2, { value: price });
      const ts = await blockTimestampOf(tx);

      await expect(tx)
        .to.emit(payments, "AchievementPurchased")
        .withArgs(user1.address, 2n, price);

      const purchases = await payments.getUserAchievements(user1.address);
      expect(purchases.length).to.equal(1);
      expect(purchases[0].user).to.equal(user1.address);
      expect(purchases[0].achievementId).to.equal(2n);
      expect(purchases[0].amountPaid).to.equal(price);
      expect(purchases[0].timestamp).to.equal(ts);

      expect(await payments.totalAchievementsSold()).to.equal(1n);
    });

    it("reverts for an achievement id with no configured price", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments.connect(user1).purchaseAchievement(999, { value: 1n })
      ).to.be.revertedWith("Achievement not available");
    });

    it("reverts on underpayment", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments
          .connect(user1)
          .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] - 1n })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("allows buying the same achievement more than once (no dedup)", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      await payments
        .connect(user1)
        .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] });
      await payments
        .connect(user1)
        .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] });
      const purchases = await payments.getUserAchievements(user1.address);
      expect(purchases.length).to.equal(2);
      expect(await payments.totalAchievementsSold()).to.equal(2n);
    });
  });

  describe("Accounting invariants across a mixed sequence of purchases", function () {
    it("contract balance equals the sum of exact-payment purchases (no overpayment involved)", async function () {
      const { payments, user1, user2 } = await loadFixture(
        deployPaymentsFixture
      );

      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await payments
        .connect(user2)
        .purchaseSubscription(PlanType.YEARLY, {
          value: PLAN_PRICE[PlanType.YEARLY],
        });
      await payments
        .connect(user1)
        .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] });
      await payments
        .connect(user2)
        .purchaseAchievement(3, { value: ACHIEVEMENT_PRICE[3] });

      const expectedTotal =
        PLAN_PRICE[PlanType.MONTHLY] +
        PLAN_PRICE[PlanType.YEARLY] +
        ACHIEVEMENT_PRICE[1] +
        ACHIEVEMENT_PRICE[3];

      const contractBalance = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      expect(contractBalance).to.equal(expectedTotal);

      const [totalRevenue, totalSubscribers, totalAchievementsSold] =
        await payments.getStats();
      expect(totalRevenue).to.equal(expectedTotal);
      expect(totalSubscribers).to.equal(2n);
      expect(totalAchievementsSold).to.equal(2n);
    });

    // FINDING (confirmed): totalRevenue overstates retained funds after any
    // overpayment (SpellBlocPayments.sol lines 137/166 run `totalRevenue +=
    // msg.value` BEFORE the excess-refund transfer). This test asserts the
    // CORRECT/intended invariant and is left failing-but-skipped per the
    // finding protocol rather than weakened to match the buggy behavior.
    // The next test documents the actual (buggy) behavior for comparison.
    it.skip("[FINDING] totalRevenue should equal retained funds after an overpayment, but currently overstates it — see companion test below", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);

      const price = PLAN_PRICE[PlanType.MONTHLY];
      const overpayAmount = ethers.parseEther("1"); // sent in excess, refunded
      const sent = price + overpayAmount;

      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, { value: sent });

      const contractBalance = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      const [totalRevenue] = await payments.getStats();

      // CORRECT/intended behavior: totalRevenue should track funds actually
      // retained by the contract (== contract balance, since nothing has
      // been withdrawn yet). This is what "totalRevenue" should mean.
      // This assertion documents the intended invariant and is expected to
      // FAIL against the current implementation — see SpellBlocPayments.sol
      // lines 137 and 166, where `totalRevenue += msg.value` runs BEFORE the
      // excess-refund transfer, so it always counts the pre-refund amount.
      expect(totalRevenue).to.equal(contractBalance);
    });

    it("[ACTUAL BEHAVIOR — documents the bug, does not endorse it] totalRevenue overstates retained funds by exactly the refunded overpayment", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);

      const price = PLAN_PRICE[PlanType.MONTHLY];
      const overpayAmount = ethers.parseEther("1");
      const sent = price + overpayAmount;

      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, { value: sent });

      const contractBalance = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      const [totalRevenue] = await payments.getStats();

      expect(contractBalance).to.equal(price); // excess was correctly refunded
      expect(totalRevenue).to.equal(sent); // but totalRevenue counted the excess anyway
      expect(totalRevenue - contractBalance).to.equal(overpayAmount); // exact drift, quantified
    });

    it("[ACTUAL BEHAVIOR — quantifies the receive() blind spot] a bare CELO transfer inflates totalRevenue with zero attribution", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );

      // A real, attributable purchase.
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });

      const bareTransferAmount = ethers.parseEther("3");
      await owner.sendTransaction({
        to: await payments.getAddress(),
        value: bareTransferAmount,
      });

      const [totalRevenue, totalSubscribers, totalAchievementsSold] =
        await payments.getStats();

      // totalRevenue includes the bare transfer...
      expect(totalRevenue).to.equal(
        PLAN_PRICE[PlanType.MONTHLY] + bareTransferAmount
      );
      // ...but it is invisible to every other stat: no subscriber, no
      // achievement, no event, no record of who sent it or why.
      expect(totalSubscribers).to.equal(1n);
      expect(totalAchievementsSold).to.equal(0n);

      // Quantified divergence between "money the contract received that is
      // attributable to a purchase" and totalRevenue:
      const attributable = PLAN_PRICE[PlanType.MONTHLY];
      expect(totalRevenue - attributable).to.equal(bareTransferAmount);
    });
  });

  describe("Access control — onlyOwner", function () {
    it("updatePlanPrice reverts for a non-owner", async function () {
      const { payments, other } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments
          .connect(other)
          .updatePlanPrice(PlanType.MONTHLY, ethers.parseEther("5"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("updatePlanPrice succeeds for the owner and emits PriceUpdated", async function () {
      const { payments, owner } = await loadFixture(deployPaymentsFixture);
      const newPrice = ethers.parseEther("5");
      await expect(payments.connect(owner).updatePlanPrice(PlanType.MONTHLY, newPrice))
        .to.emit(payments, "PriceUpdated")
        .withArgs(PlanType.MONTHLY, PLAN_PRICE[PlanType.MONTHLY], newPrice);
      expect(await payments.planPrices(PlanType.MONTHLY)).to.equal(newPrice);
    });

    it("updatePlanPrice reverts on a zero price", async function () {
      const { payments, owner } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments.connect(owner).updatePlanPrice(PlanType.MONTHLY, 0)
      ).to.be.revertedWith("Price must be greater than 0");
    });

    it("updateAchievementPrice reverts for a non-owner", async function () {
      const { payments, other } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments.connect(other).updateAchievementPrice(1, ethers.parseEther("9"))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("withdrawFunds reverts for a non-owner", async function () {
      const { payments, owner, user1, other } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await expect(
        payments.connect(other).withdrawFunds(1n)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("emergencyWithdraw reverts for a non-owner", async function () {
      const { payments, user1, other } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await expect(
        payments.connect(other).emergencyWithdraw()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("pause/unpause revert for a non-owner", async function () {
      const { payments, other } = await loadFixture(deployPaymentsFixture);
      await expect(payments.connect(other).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(payments.connect(other).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("cancelSubscription reverts for a non-owner", async function () {
      const { payments, user1, other } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await expect(
        payments.connect(other).cancelSubscription(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("cancelSubscription (by owner) deactivates and does not refund on-chain", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      const balanceBefore = await ethers.provider.getBalance(
        await payments.getAddress()
      );

      await payments.connect(owner).cancelSubscription(user1.address);

      expect(await payments.isSubscriptionActive(user1.address)).to.equal(
        false
      );
      const balanceAfter = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      // NatSpec: "for refunds/disputes" — but no CELO moves on-chain here.
      expect(balanceAfter).to.equal(balanceBefore);
    });
  });

  describe("Pausability — purchase paths must respect whenNotPaused", function () {
    it("purchaseSubscription reverts while paused and succeeds after unpause", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments.connect(owner).pause();
      await expect(
        payments
          .connect(user1)
          .purchaseSubscription(PlanType.MONTHLY, {
            value: PLAN_PRICE[PlanType.MONTHLY],
          })
      ).to.be.revertedWith("Pausable: paused");

      await payments.connect(owner).unpause();
      await expect(
        payments
          .connect(user1)
          .purchaseSubscription(PlanType.MONTHLY, {
            value: PLAN_PRICE[PlanType.MONTHLY],
          })
      ).to.emit(payments, "SubscriptionPurchased");
    });

    it("purchaseAchievement reverts while paused and succeeds after unpause", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments.connect(owner).pause();
      await expect(
        payments
          .connect(user1)
          .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] })
      ).to.be.revertedWith("Pausable: paused");

      await payments.connect(owner).unpause();
      await expect(
        payments
          .connect(user1)
          .purchaseAchievement(1, { value: ACHIEVEMENT_PRICE[1] })
      ).to.emit(payments, "AchievementPurchased");
    });
  });

  describe("Withdrawals", function () {
    it("withdrawFunds sends the requested amount to the owner and emits FundsWithdrawn", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });

      const withdrawAmount = ethers.parseEther("1");
      const tx = payments.connect(owner).withdrawFunds(withdrawAmount);

      await expect(tx)
        .to.emit(payments, "FundsWithdrawn")
        .withArgs(owner.address, withdrawAmount);
      await expect(tx).to.changeEtherBalance(owner, withdrawAmount);

      const remaining = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      expect(remaining).to.equal(
        PLAN_PRICE[PlanType.MONTHLY] - withdrawAmount
      );
    });

    it("withdrawFunds reverts when amount exceeds contract balance", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await expect(
        payments
          .connect(owner)
          .withdrawFunds(PLAN_PRICE[PlanType.MONTHLY] + 1n)
      ).to.be.revertedWith("Insufficient contract balance");
    });

    it("withdrawFunds reverts on a zero amount", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await expect(
        payments.connect(owner).withdrawFunds(0)
      ).to.be.revertedWith("Amount must be greater than 0");
    });

    it("withdrawFunds reverts when the contract balance is zero", async function () {
      const { payments, owner } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments.connect(owner).withdrawFunds(1n)
      ).to.be.revertedWith("Insufficient contract balance");
    });

    it("getContractBalance reports the contract's CELO balance and tracks it through purchases and withdrawals", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      expect(await payments.getContractBalance()).to.equal(0n);

      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      expect(await payments.getContractBalance()).to.equal(
        PLAN_PRICE[PlanType.MONTHLY]
      );

      const withdrawAmount = ethers.parseEther("1");
      await payments.connect(owner).withdrawFunds(withdrawAmount);
      expect(await payments.getContractBalance()).to.equal(
        PLAN_PRICE[PlanType.MONTHLY] - withdrawAmount
      );
      expect(await payments.getContractBalance()).to.equal(
        await ethers.provider.getBalance(await payments.getAddress())
      );
    });

    it("emergencyWithdraw sends the FULL balance to the owner, zeroes the contract, and emits FundsWithdrawn", async function () {
      const { payments, owner, user1, user2 } = await loadFixture(
        deployPaymentsFixture
      );
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await payments
        .connect(user2)
        .purchaseSubscription(PlanType.YEARLY, {
          value: PLAN_PRICE[PlanType.YEARLY],
        });

      const totalBalance =
        PLAN_PRICE[PlanType.MONTHLY] + PLAN_PRICE[PlanType.YEARLY];

      const tx = payments.connect(owner).emergencyWithdraw();
      await expect(tx)
        .to.emit(payments, "FundsWithdrawn")
        .withArgs(owner.address, totalBalance);
      await expect(tx).to.changeEtherBalance(owner, totalBalance);

      expect(
        await ethers.provider.getBalance(await payments.getAddress())
      ).to.equal(0n);
    });

    it("emergencyWithdraw reverts when the contract balance is zero", async function () {
      const { payments, owner } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments.connect(owner).emergencyWithdraw()
      ).to.be.revertedWith("No funds to withdraw");
    });
  });

  describe("Reentrancy — withdrawal paths", function () {
    async function deployReentrantOwnerFixture() {
      const base = await deployPaymentsFixture();
      const { payments, owner, user1 } = base;

      const ReentrantOwner = await ethers.getContractFactory(
        "ReentrantOwner"
      );
      const attacker = await ReentrantOwner.deploy(await payments.getAddress());
      await attacker.waitForDeployment();

      // Fund the contract, then hand ownership to the attacker so that
      // withdrawal payouts land on the attacker's `receive()`.
      await payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, {
          value: PLAN_PRICE[PlanType.MONTHLY],
        });
      await payments.connect(owner).transferOwnership(await attacker.getAddress());

      return { ...base, attacker };
    }

    it("[RESULT] a malicious owner's receive() cannot re-enter withdrawFunds for extra funds, and the outer withdrawal still completes — the nested reentrant call reaches the nonReentrant guard (target is warm, no value forwarded to the nested call) and is rejected there, with just enough gas left in the 2300 stipend for the parent receive()'s try/catch to absorb the failure cleanly", async function () {
      const { payments, attacker } = await loadFixture(
        deployReentrantOwnerFixture
      );

      const withdrawAmount = ethers.parseEther("1");
      const tx = await attacker.callWithdrawFunds(withdrawAmount);
      const receipt = await tx.wait();

      // Exactly one FundsWithdrawn event: if the nested reentrant call to
      // withdrawFunds(1) had succeeded, there would be a second one.
      const iface = payments.interface;
      const withdrawEvents = receipt.logs
        .map((log) => {
          try {
            return iface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed) => parsed && parsed.name === "FundsWithdrawn");
      expect(withdrawEvents.length).to.equal(1);
      expect(withdrawEvents[0].args.amount).to.equal(withdrawAmount);

      // Only the outer amount left the contract — no extra 1 wei from a
      // successful nested reentrant withdrawal.
      const remaining = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      expect(remaining).to.equal(
        PLAN_PRICE[PlanType.MONTHLY] - withdrawAmount
      );
    });

    it("[FINDING — actual behavior, no fund loss] a malicious owner's receive() reentering emergencyWithdraw makes the ENTIRE withdrawal revert, unlike withdrawFunds", async function () {
      const { payments, attacker } = await loadFixture(
        deployReentrantOwnerFixture
      );

      // Unlike withdrawFunds above, emergencyWithdraw's extra SLOAD
      // (`balance = address(this).balance`) before the transfer leaves
      // slightly less of the 2300-gas stipend available by the time the
      // nested reentrant call reaches the nonReentrant guard. The guard's
      // check itself runs out of gas mid-evaluation, which (per EVM gas
      // forwarding rules — "all but 1/64" is forwarded to external calls)
      // leaves the parent receive() without enough gas left to execute its
      // own try/catch handling, so receive() itself reverts via OOG. That
      // makes `.transfer()` see call failure and revert the whole outer
      // emergencyWithdraw() — no funds move at all, but the withdrawal that
      // should have succeeded (paying the legitimate 1 ether+ balance to the
      // owner) fails outright. This is a real behavioral difference between
      // the two withdrawal functions when the owner is ever a contract, not
      // a fund-loss bug — confirmed non-drainable: no wei is extracted, the
      // legitimate withdrawal simply cannot complete in this configuration.
      await expect(attacker.callEmergencyWithdraw()).to.be.reverted;

      // Balance is untouched — the revert is total, nothing partially moved.
      expect(
        await ethers.provider.getBalance(await payments.getAddress())
      ).to.equal(PLAN_PRICE[PlanType.MONTHLY]);
    });
  });

  describe("Edge cases", function () {
    it("overpayment on purchaseSubscription refunds exactly the excess (does not keep it, does not revert)", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const price = PLAN_PRICE[PlanType.MONTHLY];
      const overpay = ethers.parseEther("0.75");

      const tx = payments
        .connect(user1)
        .purchaseSubscription(PlanType.MONTHLY, { value: price + overpay });

      await expect(tx).to.changeEtherBalance(user1, -price);
      const balance = await ethers.provider.getBalance(
        await payments.getAddress()
      );
      expect(balance).to.equal(price);
    });

    it("overpayment on purchaseAchievement refunds exactly the excess", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const price = ACHIEVEMENT_PRICE[1];
      const overpay = ethers.parseEther("0.25");

      const tx = payments
        .connect(user1)
        .purchaseAchievement(1, { value: price + overpay });

      await expect(tx).to.changeEtherBalance(user1, -price);
    });

    it("[ACTUAL BEHAVIOR] a payer that cannot receive CELO reverts the ENTIRE purchase when overpaying, losing the purchase along with the refund", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const NonPayableCaller = await ethers.getContractFactory(
        "NonPayableCaller"
      );
      const caller = await NonPayableCaller.deploy();
      await caller.waitForDeployment();

      const price = PLAN_PRICE[PlanType.MONTHLY];
      await expect(
        caller
          .connect(user1)
          .purchaseSubscription(await payments.getAddress(), PlanType.MONTHLY, {
            value: price + 1n, // any overpayment triggers the refund path
          })
      ).to.be.reverted;

      // Exact payment (no refund needed) must succeed for the same caller.
      await expect(
        caller
          .connect(user1)
          .purchaseSubscription(await payments.getAddress(), PlanType.MONTHLY, {
            value: price,
          })
      ).to.not.be.reverted;
    });

    it("underpayment on purchaseSubscription reverts", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      await expect(
        payments
          .connect(user1)
          .purchaseSubscription(PlanType.MONTHLY, {
            value: PLAN_PRICE[PlanType.MONTHLY] - 1n,
          })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("updatePlanPrice cannot be used to set a zero price (guarded), but updateAchievementPrice CAN be set to zero (no guard) — asymmetric admin controls", async function () {
      const { payments, owner, user1 } = await loadFixture(
        deployPaymentsFixture
      );
      await expect(
        payments.connect(owner).updatePlanPrice(PlanType.MONTHLY, 0)
      ).to.be.revertedWith("Price must be greater than 0");

      // No revert here — updateAchievementPrice has no >0 check.
      await payments.connect(owner).updateAchievementPrice(1, 0);
      expect(await payments.achievementPrices(1)).to.equal(0n);

      // Effect: the achievement becomes permanently unpurchasable, since
      // purchaseAchievement requires achievementPrices[id] > 0.
      await expect(
        payments.connect(user1).purchaseAchievement(1, { value: 1n })
      ).to.be.revertedWith("Achievement not available");
    });

    it("rejects an out-of-range PlanType value at the ABI layer", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const iface = new ethers.Interface([
        "function purchaseSubscription(uint8 _planType) external payable",
      ]);
      const data = iface.encodeFunctionData("purchaseSubscription", [3]); // no PlanType.3
      await expect(
        user1.sendTransaction({
          to: await payments.getAddress(),
          data,
          value: PLAN_PRICE[PlanType.FAMILY],
        })
      ).to.be.reverted;
    });

    it("a bare CELO transfer via receive() increases totalRevenue without any purchase record", async function () {
      const { payments, user1 } = await loadFixture(deployPaymentsFixture);
      const amount = ethers.parseEther("2");
      await user1.sendTransaction({
        to: await payments.getAddress(),
        value: amount,
      });
      const [totalRevenue] = await payments.getStats();
      expect(totalRevenue).to.equal(amount);
    });
  });
});
