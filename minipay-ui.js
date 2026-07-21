import { MiniPayPayments, PLANS } from './minipay-integration.js';

const root = document.getElementById('minipayBilling');
if (root) {
  const payments = new MiniPayPayments({ onChange: render });
  function render() {
    const s = payments.state;
    if (!payments.isAvailable) { root.hidden = true; return; } // Graceful outside MiniPay: no payment UI.
    root.hidden = false;
    root.innerHTML = `<h2>Parent subscription</h2><p>${s.connected ? `${s.account.slice(0, 6)}…${s.account.slice(-4)} · ${s.balance} cUSD` : 'Use MiniPay to manage your family subscription.'}</p>
      <div class="plans">${Object.entries(PLANS).map(([key, p]) => `<button data-plan="${key}" ${s.loading ? 'disabled' : ''}>${p.name}: ${p.price} cUSD / ${p.duration}</button>`).join('')}</div>
      <p role="status">${s.error || ''}</p>`;
    root.querySelectorAll('[data-plan]').forEach(button => button.onclick = async () => {
      try { if (!payments.state.connected) await payments.connect(); const token = localStorage.getItem('spellbloc_token'); if (token) await payments.linkWallet(token); await payments.purchase(button.dataset.plan); root.querySelector('[role=status]').textContent = 'Payment confirmed. Your subscription will be verified by SpellBloc.'; }
      catch (_) { /* state already carries a safe user-facing error */ }
    });
  }
  render();
}
