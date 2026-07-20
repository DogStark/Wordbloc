# Blockchain Achievement Pipeline

End-to-end pipeline that turns an in-game milestone into a blockchain-verified
achievement NFT minted to a child's **custodial** wallet — with zero crypto
vocabulary surfaced to the child. Targets **Celo Alfajores testnet only**
(mainnet is a separate decision). Implements issue #10.

## Target flow

1. Child completes a milestone (e.g. 10 words mastered).
2. Frontend reports it to `POST /api/achievements/milestone`.
3. Backend awards the badge **locally and immediately** and enqueues an async
   mint job — gameplay is never blocked, and the chain being down never breaks
   the game.
4. A worker (`POST /api/achievements/mint-queue/process`, driven by cron)
   resolves (or lazily creates) the child's custodial wallet, pins COPPA-safe
   metadata to IPFS, and mints the NFT.
5. The parent dashboard reads
   `GET /api/achievements/:childId/:onChainId/verification` for a
   "pending → confirmed" status and a Celoscan "verify on blockchain" link.

## Components (all new, self-contained)

| Module | Responsibility |
| --- | --- |
| `backend/utils/walletCrypto.js` | AES-256-GCM envelope encryption for custodial private keys. Master key from `WALLET_ENCRYPTION_KEY`; **fails loudly if unset**. Keys are never stored in plaintext; auth-tag protected. |
| `backend/config/contracts.js` + `config/deployments/alfajores.json` | Network + committed contract-address config; Celoscan link builders. |
| `backend/services/ipfsMetadataService.js` | Builds standard ERC-721 metadata and pins it to IPFS (Pinata). Carries an **opaque, non-reversible child identifier only** — no child PII (COPPA). |
| `backend/services/mintQueueService.js` | Durable, DB-backed mint queue (`MintJob`). Idempotent on `(child, achievement)`; exponential-backoff retries for transient RPC failures. |
| `backend/services/achievementPipelineService.js` | Orchestrator: award locally + enqueue; process/reconcile mints; transient-vs-permanent error classification; parent verification view. |
| `backend/routes/achievements.js` | HTTP surface (milestone report, verification, queue drain). |

## Idempotency

A milestone can never mint twice:

- `Achievement` has a unique `[childId, achievementTypeId]` constraint (local award).
- `MintJob.dedupeKey` is unique per `(child, on-chain achievement id)`.
- The `SpellBlocAchievements` contract itself reverts on `hasAchievement[to][id]`.

## Child-safety (COPPA)

No child PII is ever written to IPFS or on-chain. Metadata contains an opaque
HMAC-derived learner id (`CHILD_ID_HMAC_SECRET`) — stable for support, not
reversible to any name, age, or email.

## Required environment (startup fails loudly if unset)

```
WALLET_ENCRYPTION_KEY   # 32-byte hex, `openssl rand -hex 32`
CHILD_ID_HMAC_SECRET    # 32-byte hex, `openssl rand -hex 32`
CELO_PRIVATE_KEY        # platform signer (must be the contract owner)
PINATA_API_KEY / PINATA_SECRET_API_KEY
ACHIEVEMENTS_CONTRACT_ADDRESS  # or committed in config/deployments/alfajores.json
```

## Deployment

1. Deploy `SpellBlocAchievements` + `SpellBlocCertificates` to Alfajores.
2. Commit the resulting addresses into
   `backend/config/deployments/alfajores.json`.
3. Set `onChainId` on each `AchievementType` to match the on-chain template id.

## Migration

The pipeline adds `AchievementType.onChainId` and a new `MintJob` model /
`MintJobStatus` enum. Generate the migration with:

```
cd backend && npx prisma migrate dev --name add_mint_job_queue
```

## Tests

Unit tests (no DB / RPC required) cover encryption round-trip + tamper
resistance, COPPA metadata shape, queue idempotency + backoff, and pipeline
award/reconcile/retry logic:

```
cd backend && npm test
```

## Known deferral — soulbound enforcement

`SpellBlocAchievements._beforeTokenTransfer` does **not** currently block
transfers despite the `soulbound` flag; this pre-existing behaviour is already
documented by the existing test suite (`test/SoulboundComparison.test.js`,
`test/SpellBlocAchievements.test.js`, labelled `[ACTUAL BEHAVIOR — documents the
bug]`). Fixing the contract would edit pre-existing code and break those
intentional characterization tests, so it is intentionally **out of scope for
this pipeline PR** and tracked as a follow-up.
