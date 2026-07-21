# Offline-First Architecture (issue #12)

This documents the design implemented in `offline-store.js`: an IndexedDB-
backed, event-sourced persistence layer meant to become the single
on-device source of truth for progress data, with an outbox that syncs to
the server once connectivity returns.

## Storage model

Three IndexedDB object stores, all in a `spellbloc` database:

| Store    | Key path | Purpose                                              |
|----------|----------|-------------------------------------------------------|
| `events` | `id`     | Durable, append-only log of every event ever recorded |
| `outbox` | `id`     | Events not yet confirmed by the server                 |
| `kv`     | `key`    | Small bits of local state (e.g. the migration flag)    |

The current progress snapshot is never stored directly — it's always a pure
reduction (`reduceEvents`) over the `events` log. This makes replay,
debugging, and multi-device merge all fall out of the same mechanism.

## Event schema

```js
{
  id: 'uuid-v4',        // idempotency key — also the server dedupe key (#9)
  type: 'star_award',   // one of the six types below
  payload: { ... },     // type-specific data
  clientId: 'uuid-v4',  // stable per-device id, for attribution/debugging
  childId: null,        // populated once auth/child context is wired in
  createdAt: 172839...  // client timestamp, ms since epoch
}
```

Event types, matching the issue's list of progress mutations plus settings:

- `word_attempt` — `{ word, category, correct, responseTimeMs }`
- `session_end` — a session summary object (same shape as the existing
  `AdaptiveLearningEngine` session records in `game.js`)
- `star_award` — `{ stars }`
- `achievement_trigger` — `{ achievementId }`
- `level_up` — `{ level }`
- `settings_change` — `{ key, value }` (`key` is one of `currentAge`,
  `language`, `gameMode`, `accessibility`)

## Conflict resolution rules

The same child profile may play on two devices. Merging two devices' event
logs is a **set union deduped by event id** (`mergeEventLogs`) — events are
immutable and content-addressed, so there's no special-case merge logic,
just union-then-reduce. `reduceEvents` then applies these rules per type:

| Event type            | Rule                                                          |
|------------------------|----------------------------------------------------------------|
| `star_award`           | Sum of all disjoint events (after id-dedup)                   |
| `level_up`              | Max across all events (monotonic high-water-mark)              |
| `achievement_trigger`  | Set membership by `achievementId` (idempotent — triggering twice is a no-op) |
| `settings_change`      | Last-write-wins by `createdAt`                                 |
| `word_attempt`/`session_end` | Collected as-is (full history, deduped by id)             |

Because dedup happens by event `id` before any of these rules run, **a
replayed event (double flush, resync, retry) can never double-award stars
or achievements** — the same rule that protects the local reduction is what
the server-side ingestion endpoint (#9) should apply to its dedupe-on-replay
requirement.

## Sync outbox

`SyncOutbox` flushes the `outbox` store to `POST /api/sync/events` (the
endpoint is a placeholder — actual ingestion lands on whichever backend wins
#9). It:

- Registers a `online` event listener as the primary fallback trigger.
- Opportunistically registers a Background Sync tag
  (`spellbloc-outbox-sync`) via the service worker registration, wrapped in
  try/catch — Background Sync support/permission varies, and the SW's sync
  handler itself is currently broken (`sw.js:78` calls `localStorage`,
  which doesn't exist in SW scope) pending issue #3. The `online` fallback
  does not depend on the SW at all, so this module works whether or not #3
  has landed yet.
- Retries with exponential backoff (5s → capped at 5 minutes) on failure,
  which is the expected behavior until the #9 endpoint exists.

## Migration from legacy `localStorage`

`OfflineStore.migrateFromLocalStorage()` runs once (guarded by a `kv` flag)
and copies the existing `spellbloc_*` keys into the event log as a handful
of lump-sum/LWW events — e.g. the existing `spellbloc_totalStars` value
becomes a single `star_award` event carrying the full total, not one event
per star, so re-running the migration (or a stray double-run) can't inflate
totals.

**This migration is read-only with respect to `localStorage`** — it never
modifies or clears the legacy keys. `game.js` still reads/writes those keys
directly and is unaffected by this module's presence.

## What this PR does *not* do

Scoped deliberately to keep this mergeable on its own, per the issue's own
"5+ PRs, mergeable in phases" framing:

- **Rewiring `game.js`'s game loop** (word attempts, session end, star
  awards, achievement triggers) to call into this store instead of
  `localStorage` directly — tracked in issue #6 (persistence-module
  extraction), which this issue explicitly "pairs with."
- **Offline UX** (the "offline — progress will sync" indicator, and
  ensuring achievement toasts still fire locally) — needs UI wiring that
  belongs with the #6 integration work.
- **TTS pre-caching** for offline speech synthesis — depends on the service
  worker's cache list, which is #3's scope.
- **The actual server ingestion endpoint** — explicitly deferred to
  "whichever backend wins issue #9" in the issue text. This module is
  built to talk to it (UUID idempotency keys, batched POST) once it exists.
- **Automated browser E2E test** — installing a browser automation
  dependency (Playwright/Puppeteer) was out of scope for this change. See
  the manual QA steps below instead.

## Manual QA: offline → online reconciliation

Until issue #6 wires this store into actual gameplay, there's no user-facing
flow to click through yet. Once it is wired in, the intended manual test is:

1. Open DevTools → Network tab → set to "Offline".
2. Play a few rounds (word attempts, complete a session, earn stars).
3. Reload the page while still offline — progress should persist (read from
   IndexedDB, not lost).
4. Set Network back to "Online".
5. Confirm the outbox drains: `spellBlocOffline.store.getOutboxEvents()`
   resolves to `[]` shortly after the `online` event fires (or after the
   next Background Sync, once #3 lands).
6. Confirm server-side state matches the local snapshot
   (`spellBlocOffline.store.getSnapshot()`), once the #9 ingestion endpoint
   exists.
