const winston = require('winston');

/**
 * mintQueueService
 *
 * A simple, durable, DB-backed job queue for NFT minting. Minting must never
 * block gameplay: the game awards the badge locally and immediately, and a
 * mint job is enqueued to be reconciled asynchronously ("pending → confirmed").
 *
 * Durability & idempotency:
 *  - Each job has a unique `dedupeKey` (child + achievement). Enqueuing the
 *    same milestone twice is a no-op — a milestone can never mint twice.
 *  - Jobs carry an attempt counter and an exponential backoff `nextAttemptAt`
 *    so transient RPC failures are retried without hammering the node.
 *
 * The queue is intentionally DB-backed (Prisma `MintJob` model) rather than an
 * in-memory / Redis queue so a process restart never drops an in-flight mint.
 */

const JobStatus = Object.freeze({
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    CONFIRMED: 'CONFIRMED',
    FAILED: 'FAILED',
});

const DEFAULT_MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 15000; // 15s, doubles each attempt (15s, 30s, 60s, ...)

class MintQueueService {
    /**
     * @param {object} [prismaClient] injectable Prisma client (defaults to a
     *   real one). Injection keeps the pure logic unit-testable without a DB.
     */
    constructor(prismaClient) {
        this.prisma = prismaClient || null;
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.json(),
            defaultMeta: { service: 'mint-queue-service' },
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'logs/mint-queue.log' }),
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
     * Deterministic idempotency key for a child + on-chain achievement.
     * Pure — safe to unit test.
     *
     * @param {string} childId
     * @param {number|string} achievementId on-chain template id
     * @returns {string}
     */
    static buildDedupeKey(childId, achievementId) {
        if (childId === undefined || childId === null || achievementId === undefined || achievementId === null) {
            throw new Error('buildDedupeKey requires both childId and achievementId');
        }
        return `child:${childId}:achievement:${achievementId}`;
    }

    /**
     * Exponential backoff for retry attempt N (1-indexed). Pure.
     *
     * @param {number} attempt
     * @returns {number} milliseconds to wait before the next attempt
     */
    static computeBackoffMs(attempt) {
        const n = Math.max(1, attempt);
        return BASE_BACKOFF_MS * Math.pow(2, n - 1);
    }

    /**
     * Enqueue a mint job. Idempotent: enqueuing an existing dedupeKey returns
     * the existing job instead of creating a duplicate.
     *
     * @param {object} params
     * @param {string} params.childId
     * @param {number} params.achievementId on-chain template id
     * @param {string} [params.achievementDbId] Achievement row id (for reconcile)
     * @param {number} [params.maxAttempts]
     * @returns {Promise<object>} the job row
     */
    async enqueue({ childId, achievementId, achievementDbId = null, maxAttempts = DEFAULT_MAX_ATTEMPTS }) {
        const prisma = this._client();
        const dedupeKey = MintQueueService.buildDedupeKey(childId, achievementId);

        const existing = await prisma.mintJob.findUnique({ where: { dedupeKey } });
        if (existing) {
            this.logger.info(`Mint job already queued for ${dedupeKey} (status=${existing.status})`);
            return existing;
        }

        const job = await prisma.mintJob.create({
            data: {
                dedupeKey,
                childId,
                achievementId,
                achievementDbId,
                status: JobStatus.QUEUED,
                attempts: 0,
                maxAttempts,
                nextAttemptAt: new Date(),
            },
        });
        this.logger.info(`Enqueued mint job ${job.id} for ${dedupeKey}`);
        return job;
    }

    /**
     * Claim the next due job (QUEUED and nextAttemptAt <= now), flipping it to
     * PROCESSING and incrementing attempts. Returns null when nothing is due.
     *
     * @returns {Promise<object|null>}
     */
    async claimNext() {
        const prisma = this._client();
        const candidate = await prisma.mintJob.findFirst({
            where: { status: JobStatus.QUEUED, nextAttemptAt: { lte: new Date() } },
            orderBy: { nextAttemptAt: 'asc' },
        });
        if (!candidate) return null;

        // Guarded update: only claim if still QUEUED, avoiding a double-claim race.
        const claimed = await prisma.mintJob.updateMany({
            where: { id: candidate.id, status: JobStatus.QUEUED },
            data: { status: JobStatus.PROCESSING, attempts: { increment: 1 } },
        });
        if (claimed.count === 0) {
            return null; // another worker grabbed it first
        }
        return prisma.mintJob.findUnique({ where: { id: candidate.id } });
    }

    /**
     * Mark a job confirmed after a successful on-chain mint.
     */
    async markConfirmed(jobId, { transactionHash, tokenId, tokenUri }) {
        const prisma = this._client();
        return prisma.mintJob.update({
            where: { id: jobId },
            data: {
                status: JobStatus.CONFIRMED,
                transactionHash,
                tokenId: tokenId !== undefined && tokenId !== null ? BigInt(tokenId) : null,
                tokenUri: tokenUri || null,
                lastError: null,
            },
        });
    }

    /**
     * Record a failed attempt. Schedules a backoff retry until maxAttempts is
     * exhausted, after which the job is marked permanently FAILED.
     *
     * @returns {Promise<{job: object, willRetry: boolean}>}
     */
    async markFailed(jobId, errorMessage) {
        const prisma = this._client();
        const job = await prisma.mintJob.findUnique({ where: { id: jobId } });
        if (!job) throw new Error(`Mint job ${jobId} not found`);

        const willRetry = job.attempts < job.maxAttempts;
        const data = willRetry
            ? {
                  status: JobStatus.QUEUED,
                  lastError: errorMessage,
                  nextAttemptAt: new Date(Date.now() + MintQueueService.computeBackoffMs(job.attempts)),
              }
            : { status: JobStatus.FAILED, lastError: errorMessage };

        const updated = await prisma.mintJob.update({ where: { id: jobId }, data });
        this.logger.warn(
            `Mint job ${jobId} failed (attempt ${job.attempts}/${job.maxAttempts}): ${errorMessage}` +
            (willRetry ? ` — retrying at ${data.nextAttemptAt.toISOString()}` : ' — giving up')
        );
        return { job: updated, willRetry };
    }

    /**
     * Read the current status for a child + achievement (for the parent
     * dashboard "pending → confirmed" surface).
     */
    async getStatus(childId, achievementId) {
        const prisma = this._client();
        const dedupeKey = MintQueueService.buildDedupeKey(childId, achievementId);
        return prisma.mintJob.findUnique({ where: { dedupeKey } });
    }
}

module.exports = new MintQueueService();
module.exports.MintQueueService = MintQueueService;
module.exports.JobStatus = JobStatus;
