const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Side-by-side verification that BOTH SpellBlocCertificates and
 * SpellBlocAchievements correctly block soulbound / non-transferable
 * tokens.  Previously the achievements contract had a no-op transfer
 * hook that allowed soulbound tokens to move freely; that bug is now
 * fixed and this suite confirms consistent enforcement across both
 * contracts.
 */
async function deployBothFixture() {
  const [owner, issuer, user1, user2] = await ethers.getSigners();

  const Achievements = await ethers.getContractFactory("SpellBlocAchievements");
  const achievements = await Achievements.deploy();
  await achievements.waitForDeployment();

  const Certificates = await ethers.getContractFactory("SpellBlocCertificates");
  const certificates = await Certificates.deploy();
  await certificates.waitForDeployment();

  return { owner, issuer, user1, user2, achievements, certificates };
}

describe("Soulbound enforcement: SpellBlocAchievements vs SpellBlocCertificates", function () {
  it("BOTH contracts reject a transfer of a soulbound / non-transferable token", async function () {
    const { owner, issuer, user1, user2, achievements, certificates } =
      await loadFixture(deployBothFixture);

    // ── Certificates: issue a token ──────────────────────────────────────────
    await certificates.connect(owner).createCertificateType(
      0,
      "Spelling Basics",
      "desc",
      "Beginner",
      [],
      1,
      1,
      ethers.encodeBytes32String("hash")
    );
    await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
    await certificates.connect(issuer).issueCertificate(
      user1.address,
      0,
      1,
      1,
      ethers.keccak256(ethers.toUtf8Bytes("cert-data")),
      "ipfs://cert"
    );

    // ── Achievements: mint achievement id 0 ("First Steps"), soulbound=true ──
    await achievements.connect(owner).mintAchievement(user1.address, 0, "ipfs://achievement");

    // ── Certificates: transfer attempt REVERTS ───────────────────────────────
    await expect(
      certificates.connect(user1).safeTransferFrom(user1.address, user2.address, 0, 1, "0x")
    ).to.be.revertedWith("Certificates are non-transferable");

    // ── Achievements: transfer attempt ALSO REVERTS (bug is fixed) ───────────
    await expect(
      achievements.connect(user1).transferFrom(user1.address, user2.address, 0)
    ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");

    // Neither token moved
    expect(await achievements.ownerOf(0)).to.equal(user1.address);
    expect(await certificates.balanceOf(user1.address, 0)).to.equal(1n);
    expect(await certificates.balanceOf(user2.address, 0)).to.equal(0n);
  });

  it("safeTransferFrom (both overloads) also reverts for a soulbound achievement", async function () {
    const { owner, user1, user2, achievements } = await loadFixture(deployBothFixture);
    await achievements.connect(owner).mintAchievement(user1.address, 0, "ipfs://a");

    await expect(
      achievements.connect(user1)["safeTransferFrom(address,address,uint256)"](
        user1.address, user2.address, 0
      )
    ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");

    await expect(
      achievements.connect(user1)["safeTransferFrom(address,address,uint256,bytes)"](
        user1.address, user2.address, 0, "0x"
      )
    ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");

    // Original owner still holds the token
    expect(await achievements.ownerOf(0)).to.equal(user1.address);
  });

  it("an operator with setApprovalForAll also cannot transfer a soulbound achievement", async function () {
    const { owner, user1, user2, achievements } = await loadFixture(deployBothFixture);
    const [, , , , other] = await ethers.getSigners();
    await achievements.connect(owner).mintAchievement(user1.address, 0, "ipfs://a");

    await achievements.connect(user1).setApprovalForAll(other.address, true);
    await expect(
      achievements.connect(other).transferFrom(user1.address, user2.address, 0)
    ).to.be.revertedWith("Achievement is soulbound and cannot be transferred");
  });

  it("non-soulbound achievement (Golden Star) can still be transferred — soulbound restriction is selective", async function () {
    const { user1, user2, achievements } = await loadFixture(deployBothFixture);
    // ACH.GOLDEN_STAR = id 7, soulbound=false
    await achievements.connect(user1).purchaseAchievement(7, "ipfs://gs", {
      value: ethers.parseEther("0.5"),
    });

    await expect(
      achievements.connect(user1).transferFrom(user1.address, user2.address, 0)
    ).to.not.be.reverted;

    expect(await achievements.ownerOf(0)).to.equal(user2.address);
  });
});
