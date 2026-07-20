const fs = require('fs');
const path = require('path');

/**
 * Contract address & network configuration.
 *
 * This issue targets **Alfajores testnet only** (mainnet is a separate
 * decision). Deployed contract addresses live in a committed JSON file
 * (`config/deployments/<network>.json`) so they are versioned and auditable,
 * and can be overridden per-environment via env vars for local/CI runs.
 *
 * Resolution order for each address:
 *   1. Environment variable (ACHIEVEMENTS_CONTRACT_ADDRESS, CERTIFICATES_CONTRACT_ADDRESS)
 *   2. Committed deployment JSON for the active network
 *
 * After running `scripts/deploy-contracts.js` against Alfajores, commit the
 * resulting addresses into `config/deployments/alfajores.json`.
 */

const SUPPORTED_NETWORKS = {
    alfajores: {
        chainId: 44787,
        rpcUrl: 'https://alfajores-forno.celo-testnet.org',
        explorerBaseUrl: 'https://alfajores.celoscan.io',
    },
};

function loadDeploymentFile(network) {
    const filePath = path.join(__dirname, 'deployments', `${network}.json`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse deployment file ${filePath}: ${error.message}`);
    }
}

/**
 * Build the resolved contract config for the active network.
 *
 * @param {object} [env=process.env]
 * @returns {{network: string, chainId: number, rpcUrl: string, explorerBaseUrl: string, addresses: {achievements: string, certificates: string}}}
 */
function getContractConfig(env = process.env) {
    const network = env.CELO_NETWORK || 'alfajores';
    const base = SUPPORTED_NETWORKS[network];

    if (!base) {
        throw new Error(
            `Unsupported CELO_NETWORK "${network}". This pipeline supports Alfajores only ` +
            `for now (mainnet is a separate decision). Set CELO_NETWORK=alfajores.`
        );
    }

    const deployment = loadDeploymentFile(network);
    const deployed = (deployment && deployment.contracts) || {};

    return {
        network,
        chainId: base.chainId,
        rpcUrl: env.CELO_RPC_URL || base.rpcUrl,
        explorerBaseUrl: env.CELO_EXPLORER_URL || base.explorerBaseUrl,
        addresses: {
            achievements:
                env.ACHIEVEMENTS_CONTRACT_ADDRESS ||
                (deployed.achievements && deployed.achievements.address) ||
                '',
            certificates:
                env.CERTIFICATES_CONTRACT_ADDRESS ||
                (deployed.certificates && deployed.certificates.address) ||
                '',
        },
    };
}

/**
 * Build a Celoscan link for a transaction hash so the parent dashboard can
 * render a "verify on blockchain" link per badge.
 *
 * @param {string} txHash
 * @param {object} [env=process.env]
 * @returns {string}
 */
function explorerTxUrl(txHash, env = process.env) {
    const { explorerBaseUrl } = getContractConfig(env);
    return `${explorerBaseUrl}/tx/${txHash}`;
}

/**
 * Build a Celoscan token link for an NFT.
 *
 * @param {string} contractAddress
 * @param {string|number} tokenId
 * @param {object} [env=process.env]
 * @returns {string}
 */
function explorerTokenUrl(contractAddress, tokenId, env = process.env) {
    const { explorerBaseUrl } = getContractConfig(env);
    return `${explorerBaseUrl}/token/${contractAddress}?a=${tokenId}`;
}

module.exports = {
    SUPPORTED_NETWORKS,
    getContractConfig,
    explorerTxUrl,
    explorerTokenUrl,
};
