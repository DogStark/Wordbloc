const { MintQueueService, JobStatus } = require('../mintQueueService');

describe('MintQueueService', () => {
    describe('buildDedupeKey (pure)', () => {
        it('is deterministic for the same inputs', () => {
            expect(MintQueueService.buildDedupeKey('child-1', 0)).toBe(
                MintQueueService.buildDedupeKey('child-1', 0)
            );
        });

        it('differs across children and achievements', () => {
            expect(MintQueueService.buildDedupeKey('child-1', 0)).not.toBe(
                MintQueueService.buildDedupeKey('child-2', 0)
            );
            expect(MintQueueService.buildDedupeKey('child-1', 0)).not.toBe(
                MintQueueService.buildDedupeKey('child-1', 1)
            );
        });

        it('throws on missing inputs', () => {
            expect(() => MintQueueService.buildDedupeKey(null, 0)).toThrow();
            expect(() => MintQueueService.buildDedupeKey('child-1', undefined)).toThrow();
        });
    });

    describe('computeBackoffMs (pure exponential backoff)', () => {
        it('doubles each attempt', () => {
            expect(MintQueueService.computeBackoffMs(1)).toBe(15000);
            expect(MintQueueService.computeBackoffMs(2)).toBe(30000);
            expect(MintQueueService.computeBackoffMs(3)).toBe(60000);
        });
    });

    describe('enqueue (idempotency)', () => {
        it('does not create a duplicate job for the same dedupeKey', async () => {
            const existing = { id: 'job-1', status: JobStatus.QUEUED, dedupeKey: 'child:c1:achievement:0' };
            const prisma = {
                mintJob: {
                    findUnique: jest.fn().mockResolvedValue(existing),
                    create: jest.fn(),
                },
            };
            const svc = new MintQueueService(prisma);
            const job = await svc.enqueue({ childId: 'c1', achievementId: 0 });
            expect(job).toBe(existing);
            expect(prisma.mintJob.create).not.toHaveBeenCalled();
        });

        it('creates a new job when none exists', async () => {
            const created = { id: 'job-2', status: JobStatus.QUEUED };
            const prisma = {
                mintJob: {
                    findUnique: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue(created),
                },
            };
            const svc = new MintQueueService(prisma);
            const job = await svc.enqueue({ childId: 'c1', achievementId: 0 });
            expect(job).toBe(created);
            expect(prisma.mintJob.create).toHaveBeenCalledTimes(1);
        });
    });

    describe('markFailed (retry vs give up)', () => {
        it('schedules a retry while attempts remain', async () => {
            const job = { id: 'job-3', attempts: 2, maxAttempts: 5 };
            const prisma = {
                mintJob: {
                    findUnique: jest.fn().mockResolvedValue(job),
                    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...job, ...data })),
                },
            };
            const svc = new MintQueueService(prisma);
            const { willRetry, job: updated } = await svc.markFailed('job-3', 'timeout');
            expect(willRetry).toBe(true);
            expect(updated.status).toBe(JobStatus.QUEUED);
            expect(updated.nextAttemptAt).toBeInstanceOf(Date);
        });

        it('marks permanently FAILED once attempts are exhausted', async () => {
            const job = { id: 'job-4', attempts: 5, maxAttempts: 5 };
            const prisma = {
                mintJob: {
                    findUnique: jest.fn().mockResolvedValue(job),
                    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...job, ...data })),
                },
            };
            const svc = new MintQueueService(prisma);
            const { willRetry, job: updated } = await svc.markFailed('job-4', 'revert');
            expect(willRetry).toBe(false);
            expect(updated.status).toBe(JobStatus.FAILED);
        });
    });

    describe('claimNext (double-claim guard)', () => {
        it('returns null when nothing is due', async () => {
            const prisma = { mintJob: { findFirst: jest.fn().mockResolvedValue(null) } };
            const svc = new MintQueueService(prisma);
            expect(await svc.claimNext()).toBeNull();
        });

        it('returns null when another worker claimed the job first', async () => {
            const candidate = { id: 'job-5' };
            const prisma = {
                mintJob: {
                    findFirst: jest.fn().mockResolvedValue(candidate),
                    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                    findUnique: jest.fn(),
                },
            };
            const svc = new MintQueueService(prisma);
            expect(await svc.claimNext()).toBeNull();
            expect(prisma.mintJob.findUnique).not.toHaveBeenCalled();
        });
    });
});
