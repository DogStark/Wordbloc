const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function deployCertificatesFixture() {
  const [owner, issuer, child1, child2, other] = await ethers.getSigners();
  const Certificates = await ethers.getContractFactory(
    "SpellBlocCertificates"
  );
  const certificates = await Certificates.deploy();
  await certificates.waitForDeployment();
  return { certificates, owner, issuer, child1, child2, other };
}

function createDefaultTypeTx(certificates, owner) {
  return certificates
    .connect(owner)
    .createCertificateType(
      0,
      "Spelling Basics",
      "Completed the basics course",
      "Beginner",
      ["spelling", "phonics"],
      50,
      8000, // 80.00%
      ethers.encodeBytes32String("template-hash")
    );
}

async function withDefaultType(certificates, owner) {
  await createDefaultTypeTx(certificates, owner);
}

const dataHash = (label) => ethers.keccak256(ethers.toUtf8Bytes(label));

describe("SpellBlocCertificates", function () {
  describe("Authorized issuer management (onlyOwner)", function () {
    it("addAuthorizedIssuer/removeAuthorizedIssuer revert for a non-owner", async function () {
      const { certificates, other, issuer } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(
        certificates.connect(other).addAuthorizedIssuer(issuer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(
        certificates.connect(other).removeAuthorizedIssuer(issuer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("owner can add and remove an authorized issuer", async function () {
      const { certificates, owner, issuer } = await loadFixture(
        deployCertificatesFixture
      );
      expect(await certificates.authorizedIssuers(issuer.address)).to.equal(
        false
      );
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      expect(await certificates.authorizedIssuers(issuer.address)).to.equal(
        true
      );
      await certificates.connect(owner).removeAuthorizedIssuer(issuer.address);
      expect(await certificates.authorizedIssuers(issuer.address)).to.equal(
        false
      );
    });
  });

  describe("createCertificateType (onlyOwner)", function () {
    it("reverts for a non-owner", async function () {
      const { certificates, other } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(
        certificates
          .connect(other)
          .createCertificateType(
            0,
            "X",
            "Y",
            "Z",
            [],
            1,
            1,
            ethers.encodeBytes32String("x")
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("creates the type with correct fields and emits CertificateTypeCreated", async function () {
      const { certificates, owner } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(createDefaultTypeTx(certificates, owner))
        .to.emit(certificates, "CertificateTypeCreated")
        .withArgs(0, "Spelling Basics", "Beginner", 50);

      const cert = await certificates.getCertificateType(0);
      expect(cert.title).to.equal("Spelling Basics");
      expect(cert.wordsRequired).to.equal(50n);
      expect(cert.accuracyRequired).to.equal(8000n);
      expect(cert.isActive).to.equal(true);
      expect(cert.issuedCount).to.equal(0n);
    });
  });

  describe("issueCertificate", function () {
    it("reverts for a non-authorized issuer", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            60,
            8500,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.be.revertedWith("Not authorized to issue certificates");
    });

    it("reverts while paused", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates.connect(owner).pause();
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            60,
            8500,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.be.revertedWith("Pausable: paused");
    });

    it("reverts if the certificate type is not active", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates.connect(owner).disableCertificateType(0);
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            60,
            8500,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.be.revertedWith("Certificate type not active");
    });

    it("reverts if wordsCompleted is below the requirement", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            49,
            8500,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.be.revertedWith("Insufficient words completed");
    });

    it("reverts if accuracyAchieved is below the requirement", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            60,
            7999,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.be.revertedWith("Insufficient accuracy");
    });

    it("reverts if the same dataHash is reused (replay protection)", async function () {
      const { certificates, owner, issuer, child1, child2 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hash = dataHash("shared");
      await certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hash, "ipfs://a");
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(child2.address, 0, 60, 8500, hash, "ipfs://b")
      ).to.be.revertedWith("Data hash already used");
    });

    it("mints the certificate, updates bookkeeping, and emits CertificateIssued", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hash = dataHash("a");

      const tx = certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hash, "ipfs://cert");

      await expect(tx)
        .to.emit(certificates, "CertificateIssued")
        .withArgs(child1.address, 0n, 0n, "Spelling Basics", hash);
      await tx;

      expect(await certificates.balanceOf(child1.address, 0)).to.equal(1n);
      expect(await certificates.usedDataHashes(hash)).to.equal(true);
      expect((await certificates.getCertificateType(0)).issuedCount).to.equal(
        1n
      );
      const childCerts = await certificates.getChildCertificates(
        child1.address
      );
      expect(childCerts.length).to.equal(1);
      expect(childCerts[0]).to.equal(0n);
      expect(await certificates.totalCertificatesIssued()).to.equal(1n);

      const instance = await certificates.getCertificateInstance(0);
      expect(instance.childWallet).to.equal(child1.address);
      expect(instance.wordsCompleted).to.equal(60n);
      expect(instance.accuracyAchieved).to.equal(8500n);
      expect(instance.isVerified).to.equal(true);
    });
  });

  describe("Reentrancy — issueCertificate", function () {
    it("a malicious recipient contract cannot re-enter issueCertificate during the ERC1155 mint callback", async function () {
      const { certificates, owner, issuer } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);

      const reentryHash = dataHash("reentry");
      const ReentrantReceiver = await ethers.getContractFactory(
        "ReentrantERC1155Receiver"
      );
      const receiver = await ReentrantReceiver.deploy(
        await certificates.getAddress(),
        reentryHash
      );
      await receiver.waitForDeployment();

      // The receiver is itself the authorized issuer's chosen childWallet;
      // separately, we make the receiver contract also do the re-entrant
      // call as if it were an issuer would require it to BE authorized —
      // instead, this proves the guard blocks even the legitimate issuer's
      // own recursive call triggered by the ERC1155 callback.
      await certificates
        .connect(owner)
        .addAuthorizedIssuer(await receiver.getAddress());

      await certificates
        .connect(issuer)
        .issueCertificate(
          await receiver.getAddress(),
          0,
          60,
          8500,
          dataHash("outer"),
          "ipfs://cert"
        );

      expect(await receiver.reentryAttempted()).to.equal(true);
      expect(await receiver.reentrySucceeded()).to.equal(false);
      // Only the outer certificate was issued.
      expect(await certificates.totalCertificatesIssued()).to.equal(1n);
    });
  });

  describe("verifyCertificate / batchVerifyCertificates", function () {
    it("returns valid=true for a matching hash and existing balance", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hash = dataHash("a");
      await certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hash, "ipfs://cert");

      const [isValid] = await certificates.verifyCertificate(0, hash);
      expect(isValid).to.equal(true);
    });

    it("returns valid=false for a wrong expected hash", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hash = dataHash("a");
      await certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hash, "ipfs://cert");

      const [isValid] = await certificates.verifyCertificate(0, dataHash("wrong"));
      expect(isValid).to.equal(false);
    });

    it("returns valid=false after the certificate is revoked", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hash = dataHash("a");
      await certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hash, "ipfs://cert");

      await certificates.connect(owner).revokeCertificate(0, "fraud");
      const [isValid] = await certificates.verifyCertificate(0, hash);
      expect(isValid).to.equal(false);
    });

    it("batchVerifyCertificates reverts on array length mismatch", async function () {
      const { certificates } = await loadFixture(deployCertificatesFixture);
      await expect(
        certificates.batchVerifyCertificates([0, 1], [dataHash("a")])
      ).to.be.revertedWith("Array length mismatch");
    });

    it("batchVerifyCertificates returns per-entry results for a mix of valid/invalid", async function () {
      const { certificates, owner, issuer, child1, child2 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      const hashA = dataHash("a");
      const hashB = dataHash("b");
      await certificates
        .connect(issuer)
        .issueCertificate(child1.address, 0, 60, 8500, hashA, "ipfs://a");
      await certificates
        .connect(issuer)
        .issueCertificate(child2.address, 0, 60, 8500, hashB, "ipfs://b");

      const results = await certificates.batchVerifyCertificates(
        [0, 1],
        [hashA, dataHash("wrong")]
      );
      expect(results[0]).to.equal(true);
      expect(results[1]).to.equal(false);
    });
  });

  describe("revokeCertificate (onlyOwner)", function () {
    it("reverts for a non-owner", async function () {
      const { certificates, owner, issuer, child1, other } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates
        .connect(issuer)
        .issueCertificate(
          child1.address,
          0,
          60,
          8500,
          dataHash("a"),
          "ipfs://cert"
        );
      await expect(
        certificates.connect(other).revokeCertificate(0, "fraud")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts for a non-existent certificate instance", async function () {
      const { certificates, owner } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(
        certificates.connect(owner).revokeCertificate(999, "n/a")
      ).to.be.revertedWith("Certificate does not exist");
    });

    it("marks unverified, burns the token, and emits CertificateVerified (reused as the revocation event)", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates
        .connect(issuer)
        .issueCertificate(
          child1.address,
          0,
          60,
          8500,
          dataHash("a"),
          "ipfs://cert"
        );

      // NOTE: CertificateVerified is emitted here to signal a REVOCATION,
      // not a verification — the contract reuses one event name for two
      // opposite meanings. Documented as an observation, not a hard finding
      // (no funds/security impact, but a footgun for off-chain indexers
      // that assume this event always means "verified").
      const revokeTx = await certificates.connect(owner).revokeCertificate(0, "fraud");
      const revokeReceipt = await revokeTx.wait();
      const revokeBlock = await ethers.provider.getBlock(revokeReceipt.blockNumber);
      await expect(revokeTx)
        .to.emit(certificates, "CertificateVerified")
        .withArgs(0, owner.address, revokeBlock.timestamp);

      const instance = await certificates.getCertificateInstance(0);
      expect(instance.isVerified).to.equal(false);
      expect(await certificates.balanceOf(child1.address, 0)).to.equal(0n);
    });
  });

  describe("Soulbound behavior — CORRECTLY implemented (positive confirmation)", function () {
    it("safeTransferFrom reverts with 'Certificates are non-transferable'", async function () {
      const { certificates, owner, issuer, child1, child2 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates
        .connect(issuer)
        .issueCertificate(
          child1.address,
          0,
          60,
          8500,
          dataHash("a"),
          "ipfs://cert"
        );

      await expect(
        certificates
          .connect(child1)
          .safeTransferFrom(child1.address, child2.address, 0, 1, "0x")
      ).to.be.revertedWith("Certificates are non-transferable");
    });

    it("safeBatchTransferFrom also reverts", async function () {
      const { certificates, owner, issuer, child1, child2 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await certificates
        .connect(issuer)
        .issueCertificate(
          child1.address,
          0,
          60,
          8500,
          dataHash("a"),
          "ipfs://cert"
        );

      await expect(
        certificates
          .connect(child1)
          .safeBatchTransferFrom(
            child1.address,
            child2.address,
            [0],
            [1],
            "0x"
          )
      ).to.be.revertedWith("Certificates are non-transferable");
    });

    it("mint (from == address(0)) and burn-via-revoke (to == address(0)) are unaffected by the soulbound check", async function () {
      const { certificates, owner, issuer, child1 } = await loadFixture(
        deployCertificatesFixture
      );
      await withDefaultType(certificates, owner);
      await certificates.connect(owner).addAuthorizedIssuer(issuer.address);
      await expect(
        certificates
          .connect(issuer)
          .issueCertificate(
            child1.address,
            0,
            60,
            8500,
            dataHash("a"),
            "ipfs://cert"
          )
      ).to.not.be.reverted;
      await expect(certificates.connect(owner).revokeCertificate(0, "x")).to
        .not.be.reverted;
    });
  });

  describe("setURI / disableCertificateType (onlyOwner)", function () {
    it("setURI reverts for a non-owner, succeeds for owner", async function () {
      const { certificates, owner, other } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(
        certificates.connect(other).setURI("ipfs://new/{id}.json")
      ).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(certificates.connect(owner).setURI("ipfs://new/{id}.json"))
        .to.not.be.reverted;
    });

    it("disableCertificateType reverts for a non-owner", async function () {
      const { certificates, other } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(
        certificates.connect(other).disableCertificateType(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Pausability", function () {
    it("pause/unpause revert for a non-owner", async function () {
      const { certificates, other } = await loadFixture(
        deployCertificatesFixture
      );
      await expect(certificates.connect(other).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
      await expect(certificates.connect(other).unpause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});
