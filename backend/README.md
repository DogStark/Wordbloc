# SpellBloc Backend

## Status

This implements **Phase 1 (persistence layer)** of [#9](https://github.com/DogStark/Wordbloc/issues/9):
the Prisma schema (`prisma/schema.prisma`), Postgres-backed auth (`routes/auth.js`,
`services/walletService.js`, `services/blockchainService.js`), a local Postgres/Redis
dev setup, and a migration script for the legacy `users.json` accounts.

`server.js` still imports the Phase 2 route/middleware modules (`routes/game.js`,
`routes/achievements.js`, `routes/certificates.js`, `routes/leaderboard.js`,
`routes/dashboard.js`, `routes/teacher.js`, `routes/analytics.js`,
`middleware/auth.js`, `middleware/validation.js`, `middleware/coppa.js`,
`middleware/errorHandler.js`), which don't exist yet — those are tracked as
follow-up work on #9. Until they land, the root `server.js` (flat-file
`users.json` store) remains the one that actually runs in production.

## Local database setup

1. Copy the env template and fill in real secrets: `cp .env.example .env`
2. From the repo root, start Postgres + Redis for local dev:
   ```bash
   docker compose up -d
   ```
   This provisions both services with credentials matching the defaults in
   `.env.example` (`DATABASE_URL` / `REDIS_URL`), so no further config is
   needed for local development.
3. Install dependencies: `npm install`
4. Apply the Prisma schema to the database: `npx prisma migrate dev`
5. (Optional) Import existing `users.json` accounts into Postgres:
   ```bash
   npm run migrate:legacy-users
   ```

## Scripts

- `npm run migrate:legacy-users` — one-time import of the legacy
  `users.json` accounts into `User`/`Child` rows. Safe to re-run; emails
  that were already migrated are skipped. Migrated accounts get
  `privacyConsent: false` since the legacy file never recorded consent —
  parents must re-confirm consent before any child-scoped write is allowed
  (enforced by the COPPA middleware once it lands in Phase 2).
