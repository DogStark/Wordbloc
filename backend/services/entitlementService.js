const { Contract, JsonRpcProvider, isAddress } = require('ethers');

const PAYMENTS_ABI = ['function subscriptions(address) view returns (address user,uint8 planType,uint256 startTime,uint256 endTime,bool active,uint256 amountPaid)'];

class EntitlementService {
  constructor({ prisma, provider, contractAddress, contract } = {}) {
    this.prisma = prisma;
    this.contractAddress = contractAddress || process.env.PAYMENT_CONTRACT_ADDRESS;
    this.provider = provider || (this.contractAddress ? new JsonRpcProvider(process.env.CELO_RPC_URL || 'https://alfajores-forno.celo-testnet.org') : null);
    this.contract = contract;
  }
  configured() { return Boolean(this.prisma && this.provider && this.contractAddress && isAddress(this.contractAddress)); }
  async read(address) {
    if (!this.contract && !this.configured()) throw new Error('Payment entitlement service is not configured');
    if (!isAddress(address)) throw new Error('Invalid wallet address');
    const contract = this.contract || new Contract(this.contractAddress, PAYMENTS_ABI, this.provider);
    const sub = await contract.subscriptions(address);
    const expiresAt = new Date(Number(sub.endTime) * 1000);
    const active = Boolean(sub.active) && expiresAt > new Date();
    return { subscriptionType: active ? 'PREMIUM' : 'FREE', subscriptionExpiresAt: active ? expiresAt : null, planType: Number(sub.planType), active };
  }
  async syncUser(userId) {
    const wallet = await this.prisma.paymentWallet.findUnique({ where: { userId } });
    const entitlement = wallet ? await this.read(wallet.address) : { subscriptionType: 'FREE', subscriptionExpiresAt: null, active: false };
    await this.prisma.user.update({ where: { id: userId }, data: { subscriptionType: entitlement.subscriptionType, subscriptionExpiresAt: entitlement.subscriptionExpiresAt } });
    return entitlement;
  }
}
module.exports = { EntitlementService };
