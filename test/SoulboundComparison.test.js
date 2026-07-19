const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Direct side-by-side demonstration of the headline finding:
 * SpellBlocCertificates correctly blocks transfers ("Certificates are
 * non-transferable"), while SpellBlocAchievements' soulbound flag is
 * entirely decorative — the SAME kind of transfer attempt reverts on one
 * contract and succeeds on the other, even though both contracts' NatSpec
 * claims "soulbound" / "non-transferable" semantics.
 */
async function deployBothFixture() {
  const [owner, issuer, user1, user2] = await ethers.getSigners();

  const Achievements = await ethers.getContractFactory(
    "SpellBlocAchievements"
  );
  const achievements = await Achievements.deploy();
  await achievements.waitForDeployment();

  const Certificates = await ethers.getContractFactory(
    "SpellBlocCertificates"
  );
  const certificates = await Certificates.deploy();
  await certificates.waitForDeployment();

  return { owner, issuer, user1, user2, achievements, certificates };
}

describe("Soulbound enforcement: SpellBlocAchievements vs SpellBlocCertificates", function () {
  it("the SAME transfer attempt reverts on Certificates but succeeds on Achievements", async function () {
    const { owner, issuer, user1, user2, achievements, certificates } =
      await loadFixture(deployBothFixture);

    // --- Certificates: issue a token flagged non-transferable by design ---
    await certificates
      .connect(owner)
      .createCertificateType(
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
    await certificates
      .connect(issuer)
      .issueCertificate(
        user1.address,
        0,
        1,
        1,
        ethers.keccak256(ethers.toUtf8Bytes("cert-data")),
        "ipfs://cert"
      );

    // --- Achievements: mint achievement id 0 ("First Steps"), soulbound=true ---
    await achievements
      .connect(owner)
      .mintAchievement(user1.address, 0, "ipfs://achievement");

    // Certificates: transfer attempt REVERTS (correct — matches NatSpec).
    await expect(
      certificates
        .connect(user1)
        .safeTransferFrom(user1.address, user2.address, 0, 1, "0x")
    ).to.be.revertedWith("Certificates are non-transferable");

    // Achievements: the equivalent transfer SUCCEEDS (bug — contradicts
    // NatSpec "Soulbound tokens that represent verified learning milestones"
    // and the Achievement.soulbound=true field set on this exact template).
    await expect(
      achievements.connect(user1).transferFrom(user1.address, user2.address, 0)
    ).to.not.be.reverted;
    expect(await achievements.ownerOf(0)).to.equal(user2.address);

    // Certificates never moved — ownership/balance unchanged.
    expect(await certificates.balanceOf(user1.address, 0)).to.equal(1n);
    expect(await certificates.balanceOf(user2.address, 0)).to.equal(0n);
  });
});
