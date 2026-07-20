// Vanilla ES module for the parent billing page. No React or build pipeline required.
import { BrowserProvider, Contract, formatUnits, parseUnits } from 'https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm';

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const PAYMENT_ABI = ['function planPrices(uint8) view returns (uint256)', 'function purchaseSubscription(uint8)', 'function subscriptions(address) view returns (address,uint8,uint256,uint256,bool,uint256)'];
export const PLANS = { monthly: { id: 0, name: 'Monthly', price: '2.5', duration: '30 days' }, yearly: { id: 1, name: 'Yearly', price: '25', duration: '1 year' }, family: { id: 2, name: 'Family', price: '40', duration: '1 year' } };

function config() {
  const configured = window.SPELLBLOC_PAYMENT_CONFIG || {};
  const network = configured.network === 'celo' ? 'celo' : 'alfajores';
  return { network, chainId: network === 'celo' ? 42220 : 44787,
    cUSD: configured.cUSD || (network === 'celo' ? '0x765DE816845861e75A25fCA122bb6898B8B1282a' : '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1'),
    paymentContract: configured.paymentContract || '' };
}
function userMessage(error) {
  if (error?.code === 4001 || /rejected/i.test(error?.message)) return 'Transaction was rejected in MiniPay.';
  if (/insufficient funds|transfer amount exceeds balance/i.test(error?.message)) return 'Insufficient cUSD balance.';
  return error?.shortMessage || error?.message || 'Transaction failed.';
}

export class MiniPayPayments {
  constructor({ onChange = () => {}, timeoutMs = 120000 } = {}) { this.onChange = onChange; this.timeoutMs = timeoutMs; this.state = { available: false, connected: false, loading: false, account: null, balance: '0.00', error: null }; }
  get settings() { return config(); }
  get isAvailable() { return Boolean(window.ethereum?.isMiniPay); }
  publish(patch = {}) { Object.assign(this.state, patch); this.onChange({ ...this.state }); }
  async connect() {
    if (!this.isAvailable) throw new Error('MiniPay is not available. Open this page in the MiniPay dapp browser.');
    if (!this.settings.paymentContract) throw new Error('Payments are not configured for this network yet.');
    this.publish({ loading: true, error: null, available: true });
    try {
      this.provider = new BrowserProvider(window.ethereum);
      const chainId = Number((await this.provider.getNetwork()).chainId);
      if (chainId !== this.settings.chainId) throw new Error(`Wrong network. Switch MiniPay to ${this.settings.network === 'celo' ? 'Celo' : 'Alfajores'} and try again.`);
      await this.provider.send('eth_requestAccounts', []);
      this.signer = await this.provider.getSigner();
      this.account = await this.signer.getAddress();
      await this.refreshBalance();
      this.publish({ connected: true, account: this.account });
      return this.account;
    } catch (error) { this.publish({ error: userMessage(error) }); throw error; }
    finally { this.publish({ loading: false }); }
  }
  async refreshBalance() {
    if (!this.provider || !this.account) return '0.00';
    const token = new Contract(this.settings.cUSD, ERC20_ABI, this.provider);
    const raw = await token.balanceOf(this.account);
    const balance = Number(formatUnits(raw, 18)).toFixed(2);
    this.publish({ balance }); return balance;
  }
  async wait(tx) { return Promise.race([tx.wait(), new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction confirmation timed out. Check MiniPay activity before retrying.')), this.timeoutMs))]); }
  async purchase(planKey) {
    const plan = PLANS[planKey]; if (!plan) throw new Error('Invalid subscription plan.');
    if (!this.signer) await this.connect();
    this.publish({ loading: true, error: null });
    try {
      const { cUSD, paymentContract } = this.settings;
      const token = new Contract(cUSD, ERC20_ABI, this.signer);
      const payments = new Contract(paymentContract, PAYMENT_ABI, this.signer);
      const price = await payments.planPrices(plan.id);
      const balance = await token.balanceOf(this.account);
      if (balance < price) throw new Error(`Insufficient cUSD balance. You need ${formatUnits(price, 18)} cUSD.`);
      if ((await token.allowance(this.account, paymentContract)) < price) await this.wait(await token.approve(paymentContract, price));
      const receipt = await this.wait(await payments.purchaseSubscription(plan.id));
      if (receipt.status !== 1) throw new Error('Purchase was not confirmed.');
      await this.refreshBalance();
      return { receipt, plan, price: formatUnits(price, 18) };
    } catch (error) { this.publish({ error: userMessage(error) }); throw error; }
    finally { this.publish({ loading: false }); }
  }
  async linkWallet(accessToken) {
    if (!this.signer) await this.connect();
    const challenge = await fetch('/api/payments/wallet/challenge', { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json());
    if (!challenge.message) throw new Error(challenge.error || 'Could not create wallet challenge.');
    const signature = await this.signer.signMessage(challenge.message);
    const response = await fetch('/api/payments/wallet/link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ address: this.account, signature }) });
    if (!response.ok) throw new Error((await response.json()).error || 'Could not link wallet.');
    return response.json();
  }
}
