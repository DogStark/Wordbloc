const { EntitlementService } = require('../entitlementService');

const address = '0x1111111111111111111111111111111111111111';
function prisma() { return { paymentWallet: { findUnique: jest.fn() }, user: { update: jest.fn() } }; }
describe('EntitlementService', () => {
  it('sets PREMIUM only for a currently active on-chain subscription', async () => {
    const db = prisma(); db.paymentWallet.findUnique.mockResolvedValue({ address });
    const service = new EntitlementService({ prisma: db, contract: { subscriptions: jest.fn().mockResolvedValue({ active: true, endTime: BigInt(Math.floor(Date.now() / 1000) + 3600), planType: 1 }) } });
    await expect(service.syncUser('parent')).resolves.toMatchObject({ subscriptionType: 'PREMIUM', active: true });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionType: 'PREMIUM' }) }));
  });
  it('expires an old or inactive chain subscription instead of trusting stored premium', async () => {
    const db = prisma(); db.paymentWallet.findUnique.mockResolvedValue({ address });
    const service = new EntitlementService({ prisma: db, contract: { subscriptions: jest.fn().mockResolvedValue({ active: true, endTime: 1n, planType: 0 }) } });
    await expect(service.syncUser('parent')).resolves.toMatchObject({ subscriptionType: 'FREE', active: false });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { subscriptionType: 'FREE', subscriptionExpiresAt: null } }));
  });
});
