const winston = require('winston');

const walletService = require('./walletService');
const blockchainService = require('./blockchainService');
const ipfsMetadataService = require('./ipfsMetadataService');
const mintQueueService = require('./mintQueueService');
const { getContractConfig, explorerTxUrl, explorerTokenUrl } = require('../config/contracts');

/**
 * achievementPipelineService
 *
 * End-to-end orchestration of the "child earns a blockchain-verified badge"
 * flow, decomposed into two phases so gameplay is never blocked:
 *
 *   1. awardAchievement()  — synchronous, fast. Persists the badge locally
 *      (awarded immediately, no crypto vocabulary surfaced) and enqueues an
 *      idempotent async mint job. Chain being down does NOT break the game.
 *
 *   2. processNextMint()   — asynchronous worker step (cron / queue drainer).
 *      Resolves (or lazily creates) the child's custodial wallet, pins
 *      COPPA-safe metadata to IPFS, mints the NFT with gas estimation + nonce
 *      management, retries transient RPC failures, and reconciles status so
 *      the parent dashboard can show "pending → confirmed" plus a Celoscan
 *      "verify on blockchain" link.
 *
 * Dependencies are injectable for unit testing without a DB or RPC node.
 */

// RPC / network hiccups worth retrying; contract-level reverts are permanent.
const TRANSIENT_ERROR_PATTERNS = [
    'timeout',
    'timed out',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'network',
    'rate limit',
    'too many requests',
    'nonce too low',
    'replacement transaction underpriced',
    'server error',
    'bad gateway',
    'service unavailable',
    '503',
    '502',
    '429',
];

class AchievementPipelineService {
    constructor(deps = {}) {
        this.walletService = deps.walletService || walletService;
        this.blockchainService = deps.blockchainService || blockchainService;
        this.ipfsMetadataService = deps.ipfsMetadataService || ipfsMetadataService;
        this.mintQueue = deps.mintQueueService || mintQueueService;
        this.getContractConfig = deps.getContractConfig || getContractConfig;
        this.explorerTxUrl = deps.explorerTxUrl || explorerTxUrl;
        this.explorerTokenUrl = deps.explorerTokenUrl || explorerTokenUrl;
        this.prisma = deps.prisma || null;

        this.logger = deps.logger || winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.json(),
            defaultMeta: { service: 'achievement-pipeline-service' },
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'logs/achievement-pipeline.log' }),
            ],
        });
    }

    _client() {
        if (!this.prisma) {
            const { PrismaClient } = require('@prisma/client');
            this.prisma = new PrismaClient();
        }
        return this.prisma;
    }

    /**
     * Classify an error as transient (retry) vs permanent (give up). Pure.
     * @param {Error|string} error
     * @returns {boolean}
     */
    static isTransientError(error) {
        const message = (error && error.message ? error.message : String(error)).toLowerCase();
        return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
    }

    /**
     * Resolve a child's custodial wallet, lazily creating it on first use.
     * @param {string} childId
     * @returns {Promise<object>} wallet { id, walletAddress, ... }
     */
    async resolveChildWallet(childId) {
        let wallet = await this.walletService.getWallet(null, childId);
        if (!wallet) {
            this.logger.info(`No wallet for child ${childId}; creating custodial wallet`);
            wallet = await this.walletService.createChildWallet(childId);
        }
        return wallet;
    }

    /**
     * Phase 1 — award the badge locally and enqueue the async mint.
     *
     * Idempotent on (childId, achievementTypeId): the Achievement row has a
     * unique constraint, and the mint job dedupes on (child, on-chain id), so a
     * milestone can never award or mint twice.
     *
     * @param {object} params
     * @param {string} params.childId
     * @param {string} params.achievementTypeId AchievementType row id
     * @returns {Promise<{achievement: object, job: object, alreadyAwarded: boolean}>}
     */
    async awardAchievement({ childId, achievementTypeId }) {
        const prisma = this._client();

        const type = await prisma.achievementType.findUnique({ where: { id: achievementTypeId } });
        if (!type) {
            throw new Error(`AchievementType ${achievementTypeId} not found`);
        }

        // Local, immediate award (idempotent via unique [childId, achievementTypeId]).
        const existing = await prisma.achievement.findUnique({
            where: { childId_achievementTypeId: { childId, achievementTypeId } },
        });

        let achievement = existing;
        let alreadyAwarded = Boolean(existing);
        if (!existing) {
            achievement = await prisma.achievement.create({
                data: { childId, achievementTypeId, nftMinted: false, blockchainVerified: false },
            });
            this.logger.info(`Awarded achievement "${type.name}" to child ${childId} (local)`);
        }

        // The on-chain template id is stored on AchievementType (onChainId).
        const onChainId = this._resolveOnChainId(type);

        const job = await this.mintQueue.enqueue({
            childId,
            achievementId: onChainId,
            achievementDbId: achievement.id,
        });

        return { achievement, job, alreadyAwarded };
    }

    /**
     * Resolve the numeric on-chain achievement template id for a type.
     * Convention: AchievementType.requirementValue is NOT the id; the on-chain
     * id is carried in the type's nftMetadataUri-adjacent field. We store it in
     * the (existing) `nftMetadataUri` only as a URI, so on-chain id comes from a
     * dedicated numeric field parsed here. Falls back to explicit map errors.
     */
    _resolveOnChainId(type) {
        if (type.onChainId !== undefined && type.onChainId !== null) {
            return Number(type.onChainId);
        }
        throw new Error(
            `AchievementType "${type.name}" has no onChainId set; cannot map to an ` +
            'on-chain achievement template. Seed AchievementType.onChainId to match the contract.'
        );
    }

    /**
     * Phase 2 — process the next due mint job (single unit of work).
     * Safe to call from a cron/worker loop. Returns a summary or null if the
     * queue is empty.
     *
     * @returns {Promise<object|null>}
     */
    async processNextMint() {
        const job = await this.mintQueue.claimNext();
        if (!job) return null;

        try {
            const result = await this._executeMint(job);
            await this.mintQueue.markConfirmed(job.id, result);
            await this._reconcileAchievement(job, result);
            this.logger.info(`Mint confirmed for job ${job.id}: ${result.transactionHash}`);
            return { jobId: job.id, status: 'CONFIRMED', ...result };
        } catch (error) {
            const transient = AchievementPipelineService.isTransientError(error);
            const { willRetry } = await this.mintQueue.markFailed(job.id, error.message);
            this.logger.error(
                `Mint job ${job.id} error (transient=${transient}, willRetry=${willRetry}): ${error.message}`
            );
            return { jobId: job.id, status: willRetry ? 'RETRY_SCHEDULED' : 'FAILED', error: error.message };
        }
    }

    /**
     * Drain up to `limit` due jobs. Stops early when the queue is empty.
     * @param {number} [limit=10]
     * @returns {Promise<object[]>}
     */
    async processQueue(limit = 10) {
        const results = [];
        for (let i = 0; i < limit; i += 1) {
            const result = await this.processNextMint();
            if (!result) break;
            results.push(result);
        }
        return results;
    }

    /**
     * Perform the actual pin + mint for a claimed job.
     */
    async _executeMint(job) {
        const prisma = this._client();
        const type = job.achievementDbId
            ? await prisma.achievementType.findFirst({
                  where: { achievements: { some: { id: job.achievementDbId } } },
              })
            : null;

        const wallet = await this.resolveChildWallet(job.childId);

        // Pin COPPA-safe metadata (opaque child id only).
        const pinned = await this.ipfsMetadataService.buildAndPin({
            childId: job.childId,
            achievementId: job.achievementId,
            name: type ? type.name : `Achievement ${job.achievementId}`,
            description: type ? type.description : undefined,
            imageUri: (type && type.badgeImageUrl) || 'ipfs://placeholder-badge-image',
            rarity: type ? type.rarity : undefined,
            category: type ? type.category : undefined,
            milestoneValue: type ? type.requirementValue : undefined,
            earnedAt: new Date(),
        });

        // Mint on-chain (blockchainService handles gas price + send).
        const tx = await this.blockchainService.mintAchievementNFT(
            wallet.walletAddress,
            job.achievementId,
            pinned.tokenUri
        );

        return {
            transactionHash: tx.transactionHash,
            tokenId: tx.tokenId !== undefined ? tx.tokenId : null,
            tokenUri: pinned.tokenUri,
            ipfsCid: pinned.cid,
            walletAddress: wallet.walletAddress,
        };
    }

    /**
     * Update the local Achievement row so the parent dashboard reflects the
     * confirmed on-chain state and can render a Celoscan verify link.
     */
    async _reconcileAchievement(job, result) {
        if (!job.achievementDbId) return;
        const prisma = this._client();
        const config = this.getContractConfig();

        await prisma.achievement.update({
            where: { id: job.achievementDbId },
            data: {
                nftMinted: true,
                blockchainVerified: true,
                nftTransactionHash: result.transactionHash,
                nftTokenId: result.tokenId !== null && result.tokenId !== undefined ? BigInt(result.tokenId) : null,
                metadataUri: result.tokenUri,
            },
        });

        // Persist a verifiable audit record for the transaction.
        await prisma.blockchainTransaction.upsert({
            where: { transactionHash: result.transactionHash },
            update: { status: 'CONFIRMED' },
            create: {
                transactionHash: result.transactionHash,
                transactionType: 'ACHIEVEMENT_MINT',
                fromAddress: config.addresses.achievements || 'platform-signer',
                toAddress: result.walletAddress,
                contractAddress: config.addresses.achievements || '',
                status: 'CONFIRMED',
                relatedEntityType: 'achievement',
                relatedEntityId: job.achievementDbId,
            },
        });
    }

    /**
     * Build the parent-facing verification view for a child's badge, including
     * the Celoscan "verify on blockchain" link. Never surfaces crypto jargon in
     * the child UI — this is the parent dashboard shape.
     *
     * @param {string} childId
     * @param {number} onChainAchievementId
     * @returns {Promise<object>}
     */
    async getBadgeVerification(childId, onChainAchievementId) {
        const job = await this.mintQueue.getStatus(childId, onChainAchievementId);
        if (!job) return { status: 'NOT_AWARDED' };

        const config = this.getContractConfig();
        const view = { status: job.status };
        if (job.transactionHash) {
            view.transactionHash = job.transactionHash;
            view.verifyUrl = this.explorerTxUrl(job.transactionHash);
        }
        if (job.tokenId !== null && job.tokenId !== undefined && config.addresses.achievements) {
            view.tokenUrl = this.explorerTokenUrl(config.addresses.achievements, job.tokenId.toString());
        }
        return view;
    }
}

module.exports = new AchievementPipelineService();
module.exports.AchievementPipelineService = AchievementPipelineService;
