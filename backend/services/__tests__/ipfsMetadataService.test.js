const { IpfsMetadataService } = require('../ipfsMetadataService');

describe('IpfsMetadataService', () => {
    const service = new IpfsMetadataService();

    beforeEach(() => {
        process.env.CHILD_ID_HMAC_SECRET = 'test-hmac-secret';
    });

    describe('opaqueChildId', () => {
        it('requires CHILD_ID_HMAC_SECRET to be set', () => {
            delete process.env.CHILD_ID_HMAC_SECRET;
            expect(() => service.opaqueChildId('child-1')).toThrow(/CHILD_ID_HMAC_SECRET is not set/);
        });

        it('is stable for the same child and different across children', () => {
            const a1 = service.opaqueChildId('child-1');
            const a2 = service.opaqueChildId('child-1');
            const b = service.opaqueChildId('child-2');
            expect(a1).toBe(a2);
            expect(a1).not.toBe(b);
            expect(a1).toMatch(/^[0-9a-f]{64}$/);
        });

        it('is not reversible to the raw child id', () => {
            const opaque = service.opaqueChildId('child-1');
            expect(opaque).not.toContain('child-1');
        });
    });

    describe('buildAchievementMetadata (COPPA + ERC-721 shape)', () => {
        const params = {
            childId: 'child-1',
            name: 'First Steps',
            description: 'Learned your first 10 words!',
            imageUri: 'ipfs://QmBadgeImage',
            achievementId: 0,
            rarity: 'COMMON',
            category: 'MILESTONE',
            milestoneValue: 10,
            earnedAt: new Date('2026-07-20T00:00:00Z'),
        };

        it('produces the standard ERC-721 fields', () => {
            const meta = service.buildAchievementMetadata(params);
            expect(meta.name).toBe('First Steps');
            expect(meta.image).toBe('ipfs://QmBadgeImage');
            expect(Array.isArray(meta.attributes)).toBe(true);
            expect(meta.attributes.some((a) => a.trait_type === 'Achievement ID' && a.value === 0)).toBe(true);
            expect(meta.attributes.some((a) => a.trait_type === 'Milestone' && a.value === 10)).toBe(true);
        });

        it('carries only an opaque learner id — never child PII', () => {
            const meta = service.buildAchievementMetadata({
                ...params,
                // Simulate PII that must NOT leak — service only receives childId.
            });
            const serialized = JSON.stringify(meta);
            expect(serialized).not.toContain('child-1'); // raw id never present
            const opaqueAttr = meta.attributes.find((a) => a.trait_type === 'Opaque Learner ID');
            expect(opaqueAttr).toBeDefined();
            expect(opaqueAttr.value).toMatch(/^[0-9a-f]{64}$/);
        });

        it('throws without required fields', () => {
            expect(() => service.buildAchievementMetadata({ childId: 'child-1' })).toThrow();
        });
    });
});
