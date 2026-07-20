const crypto = require('crypto');
const axios = require('axios');
const winston = require('winston');

/**
 * ipfsMetadataService
 *
 * Builds standard ERC-721 metadata for achievement badges and pins it to IPFS
 * via Pinata so the badge renders in NFT explorers (Celoscan, wallets).
 *
 * COPPA constraint (hard requirement): NO child PII is ever written to IPFS or
 * on-chain. Metadata carries only an **opaque, non-reversible child
 * identifier** — an HMAC of the internal child id keyed by a server secret.
 * Names, ages, emails, avatars, etc. are never included.
 */

const PINATA_PIN_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

class IpfsMetadataService {
    constructor() {
        this.logger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.json(),
            defaultMeta: { service: 'ipfs-metadata-service' },
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'logs/ipfs.log' }),
            ],
        });
        this.gatewayUrl = process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs/';
    }

    /**
     * Derive an opaque, stable, non-reversible identifier for a child.
     * Keyed HMAC means the same child always maps to the same token identifier
     * (useful for support/debugging) without exposing any PII on-chain.
     *
     * @param {string} childId internal database id
     * @returns {string} opaque hex identifier
     */
    opaqueChildId(childId) {
        const secret = process.env.CHILD_ID_HMAC_SECRET;
        if (!secret) {
            throw new Error(
                'CHILD_ID_HMAC_SECRET is not set. It is required to derive the opaque ' +
                'child identifier used in IPFS/on-chain metadata (COPPA: no child PII on-chain).'
            );
        }
        return crypto.createHmac('sha256', secret).update(String(childId)).digest('hex');
    }

    /**
     * Build ERC-721 metadata for an achievement badge.
     *
     * @param {object} params
     * @param {string} params.childId internal child id (converted to opaque id)
     * @param {string} params.name badge display name
     * @param {string} params.description badge description
     * @param {string} params.imageUri IPFS/https image URI for the badge art
     * @param {number} params.achievementId on-chain achievement template id
     * @param {string} [params.rarity]
     * @param {string} [params.category]
     * @param {number} [params.milestoneValue] e.g. words mastered threshold
     * @param {Date}   [params.earnedAt]
     * @returns {object} ERC-721 metadata object
     */
    buildAchievementMetadata({
        childId,
        name,
        description,
        imageUri,
        achievementId,
        rarity,
        category,
        milestoneValue,
        earnedAt,
    }) {
        if (!name || !imageUri) {
            throw new Error('buildAchievementMetadata requires at least name and imageUri');
        }

        const attributes = [
            { trait_type: 'Achievement ID', value: Number(achievementId) },
            { trait_type: 'Opaque Learner ID', value: this.opaqueChildId(childId) },
        ];
        if (rarity) attributes.push({ trait_type: 'Rarity', value: rarity });
        if (category) attributes.push({ trait_type: 'Category', value: category });
        if (typeof milestoneValue === 'number') {
            attributes.push({ trait_type: 'Milestone', value: milestoneValue });
        }
        attributes.push({
            display_type: 'date',
            trait_type: 'Earned',
            value: Math.floor(new Date(earnedAt || Date.now()).getTime() / 1000),
        });

        return {
            name,
            description: description || `SpellBloc learning achievement: ${name}`,
            image: imageUri,
            external_url: 'https://spellbloc.com',
            attributes,
        };
    }

    /**
     * Pin a metadata JSON object to IPFS via Pinata.
     *
     * @param {object} metadata ERC-721 metadata
     * @param {object} [options]
     * @param {string} [options.pinName] human-readable pin label (no PII)
     * @returns {Promise<{cid: string, tokenUri: string, gatewayUrl: string, size: number}>}
     */
    async pinMetadata(metadata, options = {}) {
        const apiKey = process.env.PINATA_API_KEY;
        const secret = process.env.PINATA_SECRET_API_KEY;
        if (!apiKey || !secret) {
            throw new Error(
                'Pinata credentials missing. Set PINATA_API_KEY and PINATA_SECRET_API_KEY ' +
                'to pin achievement metadata to IPFS.'
            );
        }

        const body = {
            pinataContent: metadata,
            pinataMetadata: { name: options.pinName || `spellbloc-badge-${Date.now()}` },
            pinataOptions: { cidVersion: 1 },
        };

        try {
            const response = await axios.post(PINATA_PIN_JSON_URL, body, {
                headers: {
                    pinata_api_key: apiKey,
                    pinata_secret_api_key: secret,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            const cid = response.data.IpfsHash;
            this.logger.info(`Pinned achievement metadata to IPFS: ${cid}`);

            return {
                cid,
                tokenUri: `ipfs://${cid}`,
                gatewayUrl: `${this.gatewayUrl}${cid}`,
                size: response.data.PinSize,
            };
        } catch (error) {
            const detail = error.response ? JSON.stringify(error.response.data) : error.message;
            this.logger.error(`Failed to pin metadata to IPFS: ${detail}`);
            throw new Error(`IPFS pinning failed: ${detail}`);
        }
    }

    /**
     * Convenience: build + pin in one call.
     *
     * @param {object} params see buildAchievementMetadata
     * @returns {Promise<{cid: string, tokenUri: string, gatewayUrl: string, metadata: object}>}
     */
    async buildAndPin(params) {
        const metadata = this.buildAchievementMetadata(params);
        const pinned = await this.pinMetadata(metadata, {
            pinName: `spellbloc-badge-a${params.achievementId}-${this.opaqueChildId(params.childId).slice(0, 12)}`,
        });
        return { ...pinned, metadata };
    }
}

module.exports = new IpfsMetadataService();
module.exports.IpfsMetadataService = IpfsMetadataService;
