const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const MONTHLY = 0, YEARLY = 1, FAMILY = 2;
const prices = [ethers.parseEther("2.5"), ethers.parseEther("25"), ethers.parseEther("40")];

async function fixture() {
  const [owner, parent, other] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const cusd = await Token.deploy();
  const Payments = await ethers.getContractFactory("SpellBlocPayments");
  const payments = await Payments.deploy(await cusd.getAddress());
  await cusd.mint(parent.address, ethers.parseEther("100"));
  return { owner, parent, other, cusd, payments };
}

describe("SpellBlocPayments cUSD flow", function () {
  it("completes the approve -> purchase flow and records the cUSD subscription", async () => {
    const { parent, cusd, payments } = await loadFixture(fixture);
    await cusd.connect(parent).approve(await payments.getAddress(), prices[MONTHLY]);
    await expect(payments.connect(parent).purchaseSubscription(MONTHLY))
      .to.emit(payments, "SubscriptionPurchased");
    const sub = await payments.subscriptions(parent.address);
    expect(sub.planType).to.equal(MONTHLY);
    expect(sub.amountPaid).to.equal(prices[MONTHLY]);
    expect(await cusd.balanceOf(await payments.getAddress())).to.equal(prices[MONTHLY]);
  });

  it("rejects a purchase with insufficient allowance or cUSD balance", async () => {
    const { owner, parent, cusd, payments } = await loadFixture(fixture);
    await expect(payments.connect(parent).purchaseSubscription(MONTHLY)).to.be.reverted;
    await payments.connect(owner).updatePlanPrice(FAMILY, prices[FAMILY] * 3n);
    await cusd.connect(parent).approve(await payments.getAddress(), prices[FAMILY] * 3n);
    await expect(payments.connect(parent).purchaseSubscription(FAMILY)).to.be.reverted;
  });

  it("does not activate a subscription when the post-approval purchase fails", async () => {
    const { owner, parent, cusd, payments } = await loadFixture(fixture);
    await cusd.connect(parent).approve(await payments.getAddress(), prices[MONTHLY]);
    await payments.connect(owner).pause();
    await expect(payments.connect(parent).purchaseSubscription(MONTHLY)).to.be.revertedWith("Pausable: paused");
    expect((await payments.subscriptions(parent.address)).active).to.equal(false);
    expect(await cusd.allowance(parent.address, await payments.getAddress())).to.equal(prices[MONTHLY]);
  });

  it("renews from the existing expiry and supports owner token withdrawal", async () => {
    const { owner, parent, cusd, payments } = await loadFixture(fixture);
    await cusd.connect(parent).approve(await payments.getAddress(), prices[MONTHLY] * 2n);
    await payments.connect(parent).purchaseSubscription(MONTHLY);
    const first = (await payments.subscriptions(parent.address)).endTime;
    await payments.connect(parent).purchaseSubscription(MONTHLY);
    expect((await payments.subscriptions(parent.address)).endTime).to.equal(first + 30n * 24n * 60n * 60n);
    await expect(payments.connect(owner).withdrawFunds(prices[MONTHLY]))
      .to.changeTokenBalance(cusd, owner, prices[MONTHLY]);
  });
});
