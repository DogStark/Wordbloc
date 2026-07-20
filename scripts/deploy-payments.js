const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const network = await ethers.provider.getNetwork();
  const isMainnet = Number(network.chainId) === 42220;
  const cUSD = process.env.CUSD_TOKEN_ADDRESS || (isMainnet ? '0x765DE816845861e75A25fCA122bb6898B8B1282a' : '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1');
  const Payments = await ethers.getContractFactory('SpellBlocPayments');
  const payments = await Payments.deploy(cUSD);
  await payments.waitForDeployment();
  const address = await payments.getAddress();
  const result = { network: isMainnet ? 'celo' : 'alfajores', chainId: Number(network.chainId), cUSD, paymentContract: address, deployedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(__dirname, '..', 'deployments'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'deployments', `payments-${result.network}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
