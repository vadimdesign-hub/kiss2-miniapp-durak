# Server Analytics Events — Schema & Rules

> **This is a hard contract enforced by the platform backend.** Events that violate it are **rejected** and reported to Sentry — they never reach Kafka or ClickHouse. Read this file end-to-end before emitting a new event type or changing an existing one.

All mini-apps emit server-side analytics into a **single shared Kafka topic** (`miniapp.serverEvent.created`). Mini-apps are distinguished by `payload.miniappSlug`. Data lands in ClickHouse JSON columns, where every unique JSON path becomes a separate column on disk — so dynamic keys, `null`-only paths, and stray top-level fields destroy the warehouse.

---

## 1. The producer method

```ts
producer.sendServerAnalytics(event, analyticsHeaders)

interface ServerAnalyticsEventInput {
  readonly entity: string;            // camelCase, e.g. "plant", "bid", "round"
  readonly action: "created" | "updated" | "deleted" | "upserted";
  readonly eventVersion: number;      // start at 1; bump on breaking meta changes
  readonly new?: ServerAnalyticsRecord;
  readonly old?: ServerAnalyticsRecord;
}
```

The producer (`KafkaProducerService` from `@playneta/node-kiss2-lib`) auto-fills:

- `payload.miniappSlug` (= service name)
- `ts` (envelope timestamp)
- `meta.clientHeaders` (from the `analyticsHeaders` argument, which `analyticsPlugin` extracts from the incoming HTTP request)

**Never** assemble those yourself.

For events that originate **outside** an HTTP request (cron, game loop, Kafka consumer handler), there are no analytics headers — pass an empty object: `producer.sendServerAnalytics(event, {})`. See §10 for the full system-event pattern.

---

## 2. Core rule: never send `null` as a value

If a field can have no value, it is **optional** — and in that case the **key is omitted** from the JSON entirely. There are no `"foo": null` values anywhere in the event.

Why: ClickHouse JSON stores each path as a dynamic subcolumn whose type is auto-inferred from values. A path that only ever sees `null` can pick up a surprising type (e.g. `value::String` may return the literal string `'null'` instead of SQL NULL). Storing a path that's `null` in every event is gratuitous pain at extraction time. Omitting the key avoids the path; readers of the JSON column get NULL for missing keys natively.

This applies everywhere: top-level optional fields, fields inside `meta`, `actors[]` items. The only exception is `null` as an array element when the array deliberately models a sparse list.

---

## 3. Canonical message template

`new`/`old` keys split into two groups:

- **Required** — always present, always with a **valid non-null value**. For collections, an empty `[]`/`{}` is valid (it's an empty container, not a null path).
- **Optional** — present **only** when there is a meaningful value. Otherwise the key is **absent** from the JSON.

`new`/`old` themselves are present/absent per `action` (see §6). **Never** write `"new": null` / `"old": null` — that's a forbidden third state.

```jsonc
{
  /* === Producer fills automatically — DO NOT SET === */
  "ts": 1777987756785,
  "meta": { "clientHeaders": { /* X-* headers, from analyticsHeaders */ } },

  /* === You provide this via sendServerAnalytics() === */
  "payload": {
    // ---- Event identity (required) ----
    "miniappSlug":  "garden",                   // auto-filled by producer
    "entity":       "plant",                    // string, camelCase
    "action":       "created",                  // created | updated | deleted | upserted
    "eventVersion": 1,                          // UInt8

    "new": {                                    // present per §6 — NEVER "new": null
      // ---- REQUIRED (always present, non-null; collections may be empty) ----
      "actors": [                               // required array; [] is valid for system events
        { "role": "owner", "userId": "uuid" }   //   each item is exactly {role, userId}
      ],
      "createdAt": "2026-05-05T13:29:16.768Z",  // required ISO-8601 UTC
      "updatedAt": "2026-05-05T13:29:16.768Z",
      "meta": { /* mini-app fields, §8 */ },    // required object; {} is valid

      // ---- OPTIONAL (omit the key when no value; never send null) ----
      "id":             "uuid|cuid",            // when entity has an id (string only — see §5.1)
      "userId":         "uuid",                 // primary actor; omit for system events
      "parentId":       "string",               // when entity has a parent
      "externalId":     "string",               // when used
      "idempotencyKey": "string",               // when used
      "deletedAt":      "2026-05-05T...",       // for soft-delete
      "status":         "growing",              // when applicable
      "type":           "ashSweet",             // when applicable
      "source":         "manual",               // when applicable
      "amount":         1750,                   // signed Int64, minor units
      "currency":       "coin",                 // required iff amount or balance is sent
      "balance":        12500
    },

    "old": {                                    // present per §6 — NEVER "old": null
      // Same rules as "new"; full snapshot of the prior state, not a diff.
    }
  }
}
```

**Top-level keys in `new`/`old` are a CLOSED LIST.** The set above is everything you may put at the top level. Any entity-specific field — game state, prices that aren't `amount`, business attributes, foreign keys, configuration values — goes into `meta`. Adding a new top-level key is a contract violation.

---

## 4. Event identity (`payload`-level)

| Key | Type | Description |
|---|---|---|
| `miniappSlug` | string (short enum) | Auto-filled by the producer. Stable mini-app slug, allow-listed by the platform. |
| `entity` | string (short enum) | Logical entity name in camelCase: `plant`, `auction`, `bid`, `round`, `cropHarvest`, ... Stable per mini-app. |
| `action` | string enum | `created` \| `updated` \| `deleted` \| `upserted`. See §6. |
| `eventVersion` | UInt8 | Schema version for this `(miniappSlug, entity, action)`. Start at `1`; bump only on breaking changes inside `meta`. No parallel topics, no version suffixes in `entity`. |

The triple `(miniappSlug, entity, action)` uniquely identifies an event type.

---

## 5. `payload.new` / `payload.old` schema

Identical shape in `new` and `old`.

### 5.1 Identifiers

| Key | Type | Required? | Notes |
|---|---|---|---|
| `actors` | array of `{role, userId}` | **required** | All participants including primary. `[]` is valid for system events. See §5.2. |
| `id` | string (UUID or CUID) | optional | The entity's id. **Always a string** — UUID or CUID. Auto-increment integers from your DB are forbidden; generate a UUID/CUID at the event source if your entity has only a numeric primary key. **Omit** the key for aggregate-style events with no entity. |
| `userId` | string (UUID) | optional | Primary actor. **Omit** for system events (cron, bot, game loop). |
| `parentId` | string | optional | Omit if no parent. |
| `externalId` | string | optional | Omit if unused. |
| `idempotencyKey` | string | optional | Omit if unused. |

> Optional keys are **never sent as `null`** — either a valid value or no key at all.

### 5.2 Multi-user events: `userId` + `actors`

Server events often involve multiple users with different roles (auction: `creator`, `winner`, `topBidder`; gift: `sender`, `receiver`; round-based game: `winner`, `bettor`). Roles can't be predicted across all future mini-apps, so we use a fixed-shape array.

**Rules:**

- `userId` (optional) = the actor whose action triggered the event. Primary axis for "user activity" analytics. For system-triggered events, **omit the key** — do not send `null`.
- `actors` (required) = all participants **including primary**. Each item is **exactly** `{ "role": <camelCase enum>, "userId": <UUID> }`. **No extra keys** in the object.
- The role list per `(entity, action)` is closed and documented in the mini-app README.
- No duplicate roles in one event. For multiple participants of the same kind, use indexed names from a closed list (`opponent1`, `opponent2`, `judgePrimary`).
- `actors: []` is valid when an event has no user participants. The `actors` key itself is always present.
- `old.actors` reflects the prior participant set (e.g., on owner change, the old `owner` is in `old.actors`, the new one in `new.actors`).

**Role-specific extra data** goes into a separate collection in `meta`, joined by `role`. Never bake the role into a top-level key (`winnerUserId` ❌) and never put participant objects on the top level (`winner: { ... }` ❌, `bets: [ { player: {...}, amount: ... } ]` ❌).

```json
"actors": [
  { "role": "winner", "userId": "..." },
  { "role": "bettor", "userId": "..." },
  { "role": "bettor", "userId": "..." }
],
"meta": {
  "actorDetails": [
    { "role": "winner", "amountWon": 88,  "sharePercent": 55.56 },
    { "role": "bettor", "amount":    40,  "sectorFrom": 0,    "sectorTo": 44.5 },
    { "role": "bettor", "amount":    50,  "sectorFrom": 44.5, "sectorTo": 100  }
  ]
}
```

If multiple participants share the same role and need to be distinguished, give the role an index (`bettor1`, `bettor2`) — keep the `(role, userId)` shape but disambiguate with a stable suffix. Or include a separate `actorRef` field inside `meta.actorDetails` items if that fits the data better. The hard rule is: roles are **strings from a closed list**, not pivoted into key names.

### 5.3 Timestamps

| Key | Type | Required? | Notes |
|---|---|---|---|
| `createdAt` | ISO-8601 string | **required** | Entity creation time. |
| `updatedAt` | ISO-8601 string | **required** | Last update; equal to `createdAt` for `created`. |
| `deletedAt` | ISO-8601 string | optional | Soft-delete time. **Omit** if not applicable. |

Always UTC with milliseconds: `2026-05-05T13:29:16.768Z`.

`createdAt`/`updatedAt` are **standard entity timestamps**, not business timestamps. Event-specific times (`startedAt`, `phaseEndsAt`, `plantedAt`, `mintedAt`, ...) go into `meta`.

### 5.4 Status / type / source

| Key | Type | Required? | Notes |
|---|---|---|---|
| `status` | string (short enum) | optional | Entity status (`active`, `pending`, `done`, `growing`, `locked`, ...). **Omit** if the entity has no status concept. |
| `type` | string (short enum) | optional | Subtype (`free`, `premium`, `auction`, `wheat`, ...). **Omit** if not applicable. |
| `source` | string (short enum) | optional | Trigger source (`auto`, `manual`, `cron`, named trigger). **Omit** if not applicable. |

### 5.5 Economy: `amount` / `currency` / `balance`

So that cross-mini-app economy analytics doesn't drown in `coinDelta` / `coinsGranted` / `priceMinor` / `xpReward` scattered across `meta`, the schema reserves three slots for the **single key economic value** of the event.

| Key | Type | Required? | Notes |
|---|---|---|---|
| `amount` | Int64 | optional | **Operation delta** in **minor units** (cents, gem-units, units). **Signed:** negative = debit, positive = credit. This is "what flowed through this event," not a balance. **Omit** for non-economic events. |
| `currency` | string (short enum) | optional | Slug for `amount` / `balance` (`coin`, `crystal`, `xp`, `gem`, `usd_minor`, `rub_minor`, ...). **Required when `amount` or `balance` is sent.** Otherwise omit. |
| `balance` | Int64 | optional | **Balance snapshot** in `currency` at event time: for an immutable transaction event, balance **after** the operation; for a balance-entity (wallet etc.), `new.balance` = after, `old.balance` = before. **Omit** if the mini-app doesn't track balance. **Not the same as `amount`:** `amount` is a delta, `balance` is absolute. |

Typical mappings ("—" = key omitted):

| Event | `amount` | `currency` | `balance` |
|---|---|---|---|
| Balance transaction (`balanceTransaction.created`) | `quantity`/`delta`, signed | balance currency | balance after, if known; else — |
| Purchase (`purchase.created`) | `localPrice` minor units, **negative** | `usd_minor` / `rub_minor` / ... | — (external currency) |
| Auction bid (`bid.created`) | bid amount, negative | `coin` | balance after debit, if known |
| Refund (`bid.refunded`, `purchase.refunded`) | refund amount, positive | same currency | balance after credit |
| Single-currency reward | reward amount, positive | reward currency | balance after credit, if known |
| Wallet entity (`wallet.updated`) | — (delta = `new.balance - old.balance`) | wallet currency | `new.balance` after, `old.balance` before |
| Non-economic create/update | — | — | — |

**Multi-currency rewards** (one event grants several currencies, e.g. `xp` + `coin` + `crystal`): omit top-level `amount`/`currency`/`balance`, use a fixed-shape `meta.amounts` array:

```json
"meta": {
  "amounts": [
    { "currency": "xp",      "amount": 6, "balance": 124 },
    { "currency": "crystal", "amount": 3, "balance": 18  },
    { "currency": "coin",    "amount": 0 }
  ]
}
```

The array name `meta.amounts` and the inner keys (`currency`/`amount`/`balance`) are **fixed**. `balance` per item is optional — **omit if untracked**, don't send `null`.

**Complex entity with multiple monetary attributes** (auction with `minBid`, `currentTopBid`, `finalPrice`): keep all of them in `meta` under semantic names; don't pick one for the top level.

`balance` is only meaningful with a `currency` — never send `balance` without `currency`.

### 5.6 `meta`

| Key | Type | Required? | Notes |
|---|---|---|---|
| `meta` | object | **required** | The only flexible region. Minimum `{}` — that's a valid empty object, not a null path. See §8. |

---

## 6. `action` rules

`payload.action` is the single source of truth for the CRUD type and dictates which sub-objects are present:

| `action`     | `payload.new` | `payload.old` | When |
|---|---|---|---|
| `created`    | present       | absent         | Entity just created. |
| `updated`    | present       | present        | Existing entity changed; `old` = before, `new` = after. |
| `deleted`    | absent        | present        | Entity removed (soft or hard). |
| `upserted`   | present       | optional       | When the mini-app backend can't distinguish create/update. |

- `payload.old` is a **full snapshot** of the previous state, not a diff. Same shape as `new`.
- "Absent" means **the key is not in the JSON**. **Never** write `"new": null` or `"old": null`.
- Sending `payload.old` with `action=created`, or `payload.new` with `action=deleted`, or omitting `payload.old` with `action=updated` — backend rejects.

---

## 7. `meta` rules

`payload.new.meta` / `payload.old.meta` is the **only** place where mini-app-specific fields live. ClickHouse stores this branch as JSON with subcolumns extracted by path, so the rules below are not optional.

### 7.1 Hard rules

1. **All keys are `camelCase`.** No `user_id`, `plant-id`, `Plant ID`, ` userId ` (whitespace).
2. **Keys are static** — they describe *what kind of field* it is, never *whose id* it is.
   - ❌ `meta.user_019dbe5d.score` · ❌ `meta.plant_4a031ea0` · ❌ `meta.tasks.task_001.done`
   - ✅ `meta.scores: [{ "userId": "...", "value": 10 }]`
   - ✅ `meta.tasks: [{ "id": "task_001", "done": true }]`
3. **Variable-size collections must be arrays of objects**, never object-as-dictionary. Object fields inside have predictable names.
4. **Max nesting depth = 4** below `payload.new.meta`. Deeper → split into a separate event/entity.
5. **No UUIDs, IDs, timestamps, usernames, or mini-app slugs as keys.**
6. **Do not duplicate top-level fields** (`id`, `userId`, `status`, `amount`, ...) into `meta`. Use the top level.
7. **Soft size limit: 8 KB per `meta` object.** No long text, base64, images.
8. **Don't send `null` as a value inside `meta`.** If a field has no value for this event, **omit the key**. Exception: `null` as an array element when the array models a sparse list.

> Value types do **not** need to match across mini-apps or event versions. ClickHouse JSON stores each `(path, type)` pair as a separate subcolumn — type mismatches don't break storage; analytics handles it on their side.

### 7.2 When an object-as-dictionary is allowed (rule 3 exception)

Only when the key set is **closed and known in advance** (enum-like) and never grows:

- ✅ `meta.shape: { "main": "shape-003", "secondary": "shape-008" }`
- ✅ `meta.genome: { "color": "ash", "flavor": "sweet", "rulesVersion": 3 }`
- ❌ `meta.phaseTimestamps: { "<random_phase_id>": "..." }` — must be an array.

When in doubt — use an array.

---

## 8. Examples

### 8.1 Single-user, non-economic — `garden.plant.created`

```ts
await app.kafka.producer.sendServerAnalytics(
  {
    entity: "plant",
    action: "created",
    eventVersion: 1,
    new: {
      // required
      actors: [{ role: "owner", userId }],
      createdAt: now,
      updatedAt: now,
      meta: {
        fertilizerLevel: 0,
        plantedAt: now,
        readyAt: ready,
        genome: { color: "ash", flavor: "sweet", rulesVersion: 3,
                  shape: { main: "shape-003", overlays: [] } },
      },
      // optional (parentId/externalId/idempotencyKey/deletedAt/amount/currency/balance omitted — N/A for plant)
      id: plantId,
      userId,
      status: "growing",
      type: "ashSweet",
      source: "manual",
    },
  },
  request.analyticsHeaders,
);
```

### 8.2 Single-currency immutable transaction — `auction.balanceTransaction.created`

```ts
await producer.sendServerAnalytics(
  {
    entity: "balanceTransaction",
    action: "created",
    eventVersion: 1,
    new: {
      actors: [{ role: "owner", userId }],
      createdAt: now,
      updatedAt: now,
      meta: { auctionEventId, bidId },
      // optional (status omitted — transaction has no status concept)
      id: txId,
      userId,
      type: "refund",
      source: "auction_bid_refund",
      idempotencyKey: `auction_bid_refund:${bidId}:${userId}`,
      amount: 1750,        // positive — credit (refund)
      currency: "coin",
      balance: 12500,      // user's coin balance after credit
    },
  },
  request.analyticsHeaders,
);
```

### 8.3 Multi-currency reward — `garden.cropHarvest.created`

```ts
await producer.sendServerAnalytics(
  {
    entity: "cropHarvest",
    action: "created",
    eventVersion: 1,
    new: {
      actors: [{ role: "harvester", userId }],
      createdAt: now,
      updatedAt: now,
      meta: {
        cropId: "wheat",
        newLevel: 4,
        amounts: [
          { currency: "xp",      amount: 6, balance: 124 },
          { currency: "crystal", amount: 3, balance: 18  },
          { currency: "coin",    amount: 0, balance: 750 },
        ],
      },
      // optional (id omitted — aggregate event with no entity id; status omitted; top-level amount/currency/balance omitted — multi-currency, all in meta.amounts[])
      userId,
      type: "wheat",
      source: "manual",
    },
  },
  request.analyticsHeaders,
);
```

### 8.4 Game round transition — `rolls.round.updated` (multi-user, value-appears-later)

The hardest pattern: a round transitions `betting → locked`. During `betting` the seed and winner are unknown; after `locked` they are revealed. Both `winner` and bettors are participants — they go into `actors[]`, with role-specific data in `meta.actorDetails[]`. Round-specific business fields (seed, sector boundaries, total pot) live in `meta`.

**`old` (state = `betting`, no winner yet):**

```ts
old: {
  actors: [
    { role: "bettor", userId: bettor1Id },
    { role: "bettor", userId: bettor2Id },
  ],
  createdAt: roundStartedAt,
  updatedAt: roundStartedAt,
  meta: {
    roomId: "high",
    startedAt: roundStartedAt,
    phaseEndsAt: bettingEndsAt,
    seedHash,
    // seed, winningTicket, winningAngle omitted — not yet known
    commissionRate: 0.05,
    total: 90,
    actorDetails: [
      { role: "bettor", userId: bettor1Id, amount: 40, sharePercent: 44.44, sectorFrom: 0,    sectorTo: 44.5 },
      { role: "bettor", userId: bettor2Id, amount: 50, sharePercent: 55.56, sectorFrom: 44.5, sectorTo: 100  },
    ],
  },
  id: String(roundId),                  // generated UUID/CUID for the round event — see §5.1
  status: "betting",
  type: "high",
  source: "auto",
}
```

**`new` (state = `locked`, winner known):**

```ts
new: {
  actors: [
    { role: "winner", userId: bettor2Id },
    { role: "bettor", userId: bettor1Id },
    { role: "bettor", userId: bettor2Id },
  ],
  createdAt: roundStartedAt,
  updatedAt: lockedAt,
  meta: {
    roomId: "high",
    startedAt: roundStartedAt,
    phaseEndsAt: lockedPhaseEndsAt,
    seedHash,
    seed,                               // appeared on lock
    winningTicket: 85,
    winningAngle: 340.02,
    commissionRate: 0.05,
    total: 90,
    actorDetails: [
      { role: "winner", userId: bettor2Id, amountWon: 88, sharePercent: 55.56 },
      { role: "bettor", userId: bettor1Id, amount: 40, sharePercent: 44.44, sectorFrom: 0,    sectorTo: 44.5 },
      { role: "bettor", userId: bettor2Id, amount: 50, sharePercent: 55.56, sectorFrom: 44.5, sectorTo: 100  },
    ],
  },
  id: String(roundId),
  status: "locked",
  type: "high",
  source: "auto",
}
```

Then:

```ts
await producer.sendServerAnalytics(
  { entity: "round", action: "updated", eventVersion: 1, new, old },
  {} // ← empty: this is a system event from the game loop, no incoming HTTP request
);
```

Key takeaways from this example:

- `winner` and `bets` are **not** top-level keys. Winner is a role in `actors`; bettors are roles in `actors`; per-participant data (amounts, sectors, won amount) lives in `meta.actorDetails[]`.
- `id: 41247` (auto-increment) is **not** valid. Generate a UUID/CUID at event-emit time, or stringify the integer if you must keep traceability — the field type is **string**, never number.
- Values that don't exist yet in `betting` (`seed`, `winningTicket`, `winningAngle`) are **omitted** in `old.meta`, not sent as `null`.
- No `userId` at top level — there is no single primary actor for a round transition; all participants are in `actors`.
- This event comes from the game loop, not an HTTP request → pass `{}` for analytics headers.

### 8.5 System event with no participants — `cron.maintenance.created`

```ts
await producer.sendServerAnalytics(
  {
    entity: "maintenance",
    action: "created",
    eventVersion: 1,
    new: {
      actors: [],                       // valid empty array — no users involved
      createdAt: now,
      updatedAt: now,
      meta: { reason: "weekly_cleanup", recordsRemoved: 1234 },
      type: "cleanup",
      source: "cron",
      // no userId, no id (or generate one if you want traceability)
    },
  },
  {} // no incoming HTTP request → no analyticsHeaders
);
```

### 8.6 Bad — typical AI-generated mistakes

```jsonc
{
  "payload": {
    "miniapp": "garden",                          // ❌ producer auto-fills miniappSlug; don't set it, don't rename
    "event_type": "plant_created",                // ❌ use entity + action (camelCase, separated)
    "new": {
      "id": 41247,                                // ❌ id must be a string (UUID/CUID), not a number
      "user_id": "019dbe5d-...",                  // ❌ snake_case
      "owner_user_id": "...",                     // ❌ role in key name → use actors[]
      "winner": { "player": { "id": "..." } },    // ❌ participant as top-level object → actors[] + meta.actorDetails
      "bets": [ { "player": {...}, "amount": 5 } ],// ❌ same — actors + meta.actorDetails
      "planted_at": "...",                        // ❌ snake_case + business timestamp belongs in meta
      "is_ready": false,                          // ❌ snake_case + meta field, not top-level
      "seed": null,                               // ❌ never send null — omit the key
      "winningTicket": null,                      // ❌ same
      "genome_4a031ea0": { },                     // ❌ ID inside key name
      "phaseTimestamps": {                        // ❌ phase IDs as keys
        "cmohaassp...": "2026-04-27T17:40:00Z"
      },
      "meta": {
        "user_019dbef6_score": 100,               // ❌ userId inside key name
        "lastBidAt": null                         // ❌ no nulls inside meta either
      }
    },
    "old": null                                   // ❌ never send "old": null — just omit it
  }
}
```

---

## 9. Pre-flight checklist

Before emitting a new event type:

- [ ] `entity` is camelCase; `(entity, action)` and the role list per `(entity, action)` are documented in the mini-app README.
- [ ] All **required** keys present with valid non-null values (`[]`/`{}` for empty collections).
- [ ] **Optional keys omitted when no value — no `null` anywhere**, including inside `meta`.
- [ ] No top-level keys outside the closed list in §3. All entity-specific fields are in `meta`.
- [ ] `id` is a string (UUID/CUID) or omitted. No numeric ids.
- [ ] Multiple participants → `actors: [{role, userId}]` + `meta.actorDetails: [{role, ...}]`. No `winner` / `bets` / `playerN` as top-level keys; no roles baked into key names.
- [ ] `updated` events ship a **full** `payload.old` snapshot, not a diff.
- [ ] No UUIDs / IDs / timestamps / usernames as keys; all keys camelCase.
- [ ] For economic events: top-level `amount` + `currency` (single-currency) **or** `meta.amounts[]` (multi-currency).
- [ ] `eventVersion` bumped only on breaking `meta` changes.
- [ ] System events (cron / game loop / Kafka handler): `actors: []`, `userId` omitted, pass `{}` as `analyticsHeaders`. Don't invent custom `X-*` headers.
- [ ] Test event passes the staging validator and appears in the analytics stg layer (no Sentry rejects).
