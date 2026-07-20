// Mock the heavy chain/service singletons so importing the pipeline never pulls
// in ethers / @celo/contractkit. Behavioural tests inject their own fakes.
jest.mock('../walletService', () => ({}));
jest.mock('../blockchainService', () => ({}));
jest.mock('../ipfsMetadataService', () => ({}));
jest.mock('../mintQueueService', () => ({}));

const { AchievementPipelineService } = require('../achievementPipelineService');

describe('AchievementPipelineService', () => {
    describe('isTransientError (pure classification)', () => {
        it('treats RPC/network hiccups as transient', () => {
            ['request timeout', 'ECONNRESET', 'nonce too low', '503 Service Unavailable', 'rate limit exceeded'].forEach(
                (msg) => expect(AchievementPipelineService.isTransientError(new Error(msg))).toBe(true)
            );
        });

        it('treats contract reverts as permanent', () => {
            ['execution reverted: User already has this achievement', 'invalid address'].forEach((msg) =>
                expect(AchievementPipelineService.isTransientError(new Error(msg))).toBe(false)
            );
        });
    });

    describe('resolveChildWallet (lazy creation)', () => {
        it('creates a wallet on first use when none exists', async () => {
            const walletService = {
                getWallet: jest.fn().mockResolvedValue(null),
                createChildWallet: jest.fn().mockResolvedValue({ id: 'w1', walletAddress: '0xabc' }),
            };
            const svc = new AchievementPipelineService({ walletService });
            const wallet = await svc.resolveChildWallet('child-1');
            expect(walletService.createChildWallet).toHaveBeenCalledWith('child-1');
            expect(wallet.walletAddress).toBe('0xabc');
        });

        it('reuses an existing wallet', async () => {
            const walletService = {
                getWallet: jest.fn().mockResolvedValue({ id: 'w1', walletAddress: '0xdef' }),
                createChildWallet: jest.fn(),
            };
            const svc = new AchievementPipelineService({ walletService });
            const wallet = await svc.resolveChildWallet('child-1');
            expect(walletService.createChildWallet).not.toHaveBeenCalled();
            expect(wallet.walletAddress).toBe('0xdef');
        });
    });

    describe('awardAchievement (immediate local award + enqueue, idempotent)', () => {
        function buildService({ existingAchievement = null } = {}) {
            const prisma = {
                achievementType: {
                    findUnique: jest.fn().mockResolvedValue({
                        id: 'type-1',
                        name: 'First Steps',
                        description: 'desc',
                        onChainId: 0,
                    }),
                },
                achievement: {
                    findUnique: jest.fn().mockResolvedValue(existingAchievement),
                    create: jest.fn().mockResolvedValue({ id: 'ach-1', earnedAt: new Date() }),
                },
            };
            const mintQueueService = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1', status: 'QUEUED' }) };
            const svc = new AchievementPipelineService({ prisma, mintQueueService });
            return { svc, prisma, mintQueueService };
        }

        it('awards locally and enqueues a mint job on first completion', async () => {
            const { svc, prisma, mintQueueService } = buildService();
            const result = await svc.awardAchievement({ childId: 'child-1', achievementTypeId: 'type-1' });
            expect(prisma.achievement.create).toHaveBeenCalledTimes(1);
            expect(mintQueueService.enqueue).toHaveBeenCalledWith(
                expect.objectContaining({ childId: 'child-1', achievementId: 0 })
            );
            expect(result.alreadyAwarded).toBe(false);
        });

        it('does not re-award when the achievement already exists (idempotent)', async () => {
            const { svc, prisma, mintQueueService } = buildService({
                existingAchievement: { id: 'ach-1', earnedAt: new Date() },
            });
            const result = await svc.awardAchievement({ childId: 'child-1', achievementTypeId: 'type-1' });
            expect(prisma.achievement.create).not.toHaveBeenCalled();
            expect(result.alreadyAwarded).toBe(true);
            // Enqueue is still idempotent at the queue layer.
            expect(mintQueueService.enqueue).toHaveBeenCalledTimes(1);
        });

        it('throws when the achievement type is unknown', async () => {
            const prisma = { achievementType: { findUnique: jest.fn().mockResolvedValue(null) } };
            const svc = new AchievementPipelineService({ prisma });
            await expect(
                svc.awardAchievement({ childId: 'child-1', achievementTypeId: 'nope' })
            ).rejects.toThrow(/not found/);
        });
    });

    describe('processNextMint (reconciliation + retry routing)', () => {
        it('returns null when the queue is empty', async () => {
            const mintQueueService = { claimNext: jest.fn().mockResolvedValue(null) };
            const svc = new AchievementPipelineService({ mintQueueService });
            expect(await svc.processNextMint()).toBeNull();
        });

        it('marks a job confirmed and reconciles the achievement on success', async () => {
            const job = { id: 'job-1', childId: 'child-1', achievementId: 0, achievementDbId: 'ach-1' };
            const prisma = {
                achievementType: { findFirst: jest.fn().mockResolvedValue({ name: 'First Steps', badgeImageUrl: 'ipfs://img', rarity: 'COMMON', category: 'MILESTONE', requirementValue: 10 }) },
                achievement: { update: jest.fn().mockResolvedValue({}) },
                blockchainTransaction: { upsert: jest.fn().mockResolvedValue({}) },
            };
            const mintQueueService = {
                claimNext: jest.fn().mockResolvedValue(job),
                markConfirmed: jest.fn().mockResolvedValue({}),
                markFailed: jest.fn(),
            };
            const walletService = {
                getWallet: jest.fn().mockResolvedValue({ walletAddress: '0xabc' }),
            };
            const ipfsMetadataService = {
                buildAndPin: jest.fn().mockResolvedValue({ tokenUri: 'ipfs://meta', cid: 'Qm123' }),
            };
            const blockchainService = {
                mintAchievementNFT: jest.fn().mockResolvedValue({ transactionHash: '0xtx', tokenId: 7 }),
            };
            const svc = new AchievementPipelineService({
                prisma,
                mintQueueService,
                walletService,
                ipfsMetadataService,
                blockchainService,
                getContractConfig: () => ({ addresses: { achievements: '0xcontract' } }),
            });

            const result = await svc.processNextMint();
            expect(result.status).toBe('CONFIRMED');
            expect(mintQueueService.markConfirmed).toHaveBeenCalledWith('job-1', expect.objectContaining({ transactionHash: '0xtx' }));
            expect(prisma.achievement.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ nftMinted: true, blockchainVerified: true }) })
            );
        });

        it('routes a transient failure to a scheduled retry', async () => {
            const job = { id: 'job-2', childId: 'child-1', achievementId: 0, achievementDbId: 'ach-1' };
            const prisma = {
                achievementType: { findFirst: jest.fn().mockResolvedValue(null) },
            };
            const mintQueueService = {
                claimNext: jest.fn().mockResolvedValue(job),
                markConfirmed: jest.fn(),
                markFailed: jest.fn().mockResolvedValue({ willRetry: true }),
            };
            const walletService = { getWallet: jest.fn().mockRejectedValue(new Error('ECONNRESET')) };
            const svc = new AchievementPipelineService({ prisma, mintQueueService, walletService });

            const result = await svc.processNextMint();
            expect(result.status).toBe('RETRY_SCHEDULED');
            expect(mintQueueService.markFailed).toHaveBeenCalledWith('job-2', expect.stringContaining('ECONNRESET'));
        });
    });
});
