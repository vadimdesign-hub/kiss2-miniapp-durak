# Miniapp Template

## Stack

- **Monorepo**: npm workspaces (`packages/*`)
- **Frontend**: React 19 + React Router 7 (SSR) + Tailwind CSS 4 + Vite 7 + TanStack Query 5 (server-state cache)
- **Backend**: Fastify 5 + TypeBox (validation) + Prisma (ORM) + `@playneta/node-kiss2-lib` (auth, Kafka, Redis, analytics, health probes)
- **Bridge SDK**: `@playneta/flutter-js-bridge` — auth-aware fetch, Flutter WebView communication
- **Code style**: Biome (tabs, double quotes, semicolons, 100-char lines)
- **Observability**: Sentry + OpenTelemetry + Pino logging

## API Naming Conventions

All miniapp-specific endpoints MUST follow these rules:

- **REST style**: design around resources, use HTTP methods for actions
- **Versioned paths**: always prefix with `/api/v1/`
- **camelCase resource names**: NOT kebab-case, NOT snake_case
- **Singular resource names**: NOT plural

| Bad | Good | Why |
|---|---|---|
| `GET /some-entities` | `GET /api/v1/someEntity` | missing version, kebab-case, plural |
| `GET /api/v1/lucky-coins` | `GET /api/v1/luckyCoin` | kebab-case, plural |
| `POST /api/v1/lucky_coin/claim` | `POST /api/v1/luckyCoin/claim` | snake_case |

Full path pattern: `/api/v1/{resourceName}` or `/api/v1/{resourceName}/{action|:id}`

## Architecture

### Frontend → Backend communication

The frontend calls the **miniapp's own backend** only for miniapp-specific logic (e.g. lucky coin).
For general platform data (user profile, balance, etc.), the frontend calls the **global backend directly** using `useBridgeFetch()` from the Flutter JS Bridge SDK, which auto-injects auth headers.

### Frontend: config, hooks, and `app/utils`

How frontend code talks to backends is split on purpose:

- **`~/config`**: Import `API_BASE_URL` (miniapp Fastify) and `GLOBAL_BACKEND_BASE_URL` (platform) from here only. Those values already switch to Vite dev proxies (`/proxy/api`, `/proxy/global`) in `import.meta.env.DEV`. Do not reimplement host or proxy logic in other modules.

- **`useBridgeFetch()`**: Use it in hooks or route components for HTTP that must carry WebView auth (both miniapp and global backends). Do not use raw `fetch` for those calls from the miniapp UI.

- **`app/utils`**: Pure, hook-free helpers — URL builders, parsing or normalizing API payloads, small functions shared by hooks. If a util needs HTTP, take `bridgeFetch` (or `typeof fetch`) as an argument from the caller; do not import `useBridgeFetch` inside `app/utils`.

- **`app/hooks`**: Own effects, loading/error state, and orchestration: call `useBridgeFetch()`, compose `API_BASE_URL` / `GLOBAL_BACKEND_BASE_URL`, and delegate reusable logic to `app/utils` where it fits. **Default to TanStack Query** (`useQuery` / `useMutation`) for any HTTP that fetches or mutates server state — see "Server State with TanStack Query" below. Hand-rolled `useEffect` + `useState` is reserved for non-HTTP concerns (timers, subscriptions, etc.).

### Server State with TanStack Query

`@tanstack/react-query` is the default for fetching, caching, and mutating server state. The `QueryClientProvider` is wired up in `root.tsx` (one client per browser tab, kept stable across re-renders via `useState`).

**Defaults set on the client** (`root.tsx`):

- `retry: 1` — retry failed queries once.
- `refetchOnWindowFocus: false` — Flutter WebView focus events are flaky, and freshness is driven by explicit invalidations (e.g. after a mutation) or by WebSocket-triggered invalidations.

**Conventions:**

- Co-locate the `queryKey` constant with the hook that owns the query (e.g. `MY_USER_QUERY_KEY`, `userBalanceQueryKey(userId)` in `use-user-profile.ts`). Export it so other hooks can invalidate it.
- Use `staleTime` aggressively for data that doesn't change often (profile, league config, etc.) — `5 * 60_000` is a sensible default for "session-stable" data.
- Use parameterised query keys (`["userBalance", userId]`) so multiple components asking for different ids dedupe per-id.
- Mutations call `queryClient.invalidateQueries({ queryKey: ... })` in `onSuccess` to refresh dependent reads. When the mutation response already contains the fresh value, prefer `queryClient.setQueryData(...)` over an invalidation to skip a network round-trip.
- The hook's public API stays thin — return only `{ data, loading, error, ... }`-style fields the caller needs, not the full TanStack Query result. This keeps callers stable if you swap the implementation.

### Current User on Frontend

ALWAYS use `GET {GLOBAL_BACKEND_BASE_URL}/user/api/v1/myUser` to get the current user's profile. Do NOT decode the JWT token to extract user info — the token is an opaque auth credential, not a data source. Only use JWT internals if explicitly required.

### Page Readiness Signal (Flutter Bridge)

The app MUST explicitly tell Flutter when the page is ready using `useSignalReady()` from the SDK. Call `signalReady()` only after initial data has loaded — NOT on mount.

```tsx
import { useSignalReady } from "@playneta/flutter-js-bridge";

function MyPage() {
  const signalReady = useSignalReady();
  const { data, loading } = useMyInitialData();

  useEffect(() => {
    if (!loading && data) signalReady();
  }, [loading, data, signalReady]);
}
```

The `FlutterBridgeProvider` in `root.tsx` handles the bridge setup, but it does NOT auto-signal readiness. Each page is responsible for signaling when its content is ready to display.

### Global Backend API (Frontend)

The frontend uses `GLOBAL_BACKEND_BASE_URL` to call platform services directly. Each service is prefixed with its name.

**Pattern**: `{GLOBAL_BACKEND_BASE_URL}/{serviceName}{pathFromSwagger}`

Examples:
- Wallet balance: `GET {GLOBAL_BACKEND_BASE_URL}/wallet/api/v1/userBalance/{id}`
- User profile: `GET {GLOBAL_BACKEND_BASE_URL}/user/api/v1/user/{id}`

### Backend-to-Service API URLs

The backend does NOT use `GLOBAL_BACKEND_BASE_URL`. Instead, each external service gets its own env var pointing directly to that service's URL. In k8s, these are internal cluster URLs; for local dev, use the external stage URL with the service prefix.

**Naming convention**: `{SERVICE_NAME}_API_URL` (e.g. `WALLET_API_URL`, `USER_API_URL`)

**Pattern**: `{SERVICE_API_URL}{pathFromSwagger}` — no service prefix in the path, the URL already points to the right service.

| Environment | Example `WALLET_API_URL` |
|---|---|
| k8s deploy | `http://wallet-api-service.kiss.svc.cluster.local` |
| local dev | `https://api-stage.kisskissplay.com/wallet` |

When adding a new backend-to-service call, add a new `*_API_URL` env var in `env.ts`, pass it through `app.ts` → route plugin → service constructor.

### Global Backend API Docs

Fetch OpenAPI specs for all platform services:

```bash
npm run fetch-api-docs          # stage (default)
npm run fetch-api-docs -- prod  # production
```

Downloaded YAML files are saved to `docs/api/{service}.yaml`. Each doc contains route descriptions, request/response models, and Kafka event definitions with payloads produced by that service.

**Important**: If `docs/api/` is empty or missing, run the fetch command before working with global backend APIs. These docs are essential for understanding available endpoints, request/response shapes, and event payloads.

### Known Platform Services

| Service | Description |
|---|---|
| `user` | User profiles, registration, myUser |
| `wallet` | Balances, coin transactions |
| `relationship` | Friends, followers, blocks |
| `chat` | Messaging, conversations |
| `room` | Live rooms, streaming |
| `collection` | User collections, items |
| `achievement` | Achievements, progress |
| `battlepass` | Battle pass seasons, rewards |
| `league` | Competitive leagues, rankings |
| `club` | User clubs, memberships |
| `task` | Daily/weekly tasks, quests |
| `gift` | Virtual gifts |
| `roulette` | Roulette game mechanics |
| `bottle` | Bottle game mechanics |
| `vip` | VIP status, privileges |
| `notification` | Push notifications, in-app alerts |
| `socialnetwork` | Social network integrations |
| `file` | File uploads, media storage |
| `version` | App version checks, force-update |
| `clievent` | Client analytics events |
| `bfr` | BFR (backend-for-frontend router) |

### Global backend files: `fileUrl` (`resource` + `path`)

Across global backend APIs, **files are not returned as full `https://` URLs**. They use the same descriptor shape everywhere:

- **`resource`**: `assets` | `public` | `private` — selects which CDN hostname family the object lives on.
- **`path`**: key path **relative to that CDN’s root** (no scheme, no host).

Turn a descriptor into a browser URL by:

1. Choosing **stage vs prod** CDN hosts consistently with `GLOBAL_BACKEND_BASE_URL` (treat as production when that base URL contains `-prod` or `.prod`; otherwise use stage hosts).
2. Looking up the **base URL** for the pair `(resource, stage|prod)`.
3. Concatenating: **`{base}/{path}`** with a single slash — if `path` might start with `/`, strip leading slashes before joining so you never produce `https://host//…`.

```ts
import { GLOBAL_BACKEND_BASE_URL } from "~/config";

type FileURLResource = "assets" | "public" | "private";

interface FileURL {
  readonly path: string;
  readonly resource: FileURLResource;
}

const RESOURCE_BASE: Record<FileURLResource, { prod: string; stage: string }> = {
  assets: {
    prod: "https://assets-prod.appdomain.com",
    stage: "https://assets-stage.appdomain.com",
  },
  public: {
    prod: "https://public-prod.appdomain.com",
    stage: "https://public-stage.appdomain.com",
  },
  private: {
    prod: "https://private-prod.appdomain.com",
    stage: "https://private-stage.appdomain.com",
  },
};

const isProd =
  GLOBAL_BACKEND_BASE_URL.includes("-prod") || GLOBAL_BACKEND_BASE_URL.includes(".prod");

export function buildFileUrl(fileUrl: FileURL): string {
  const base = isProd ? RESOURCE_BASE[fileUrl.resource].prod : RESOURCE_BASE[fileUrl.resource].stage;
  const path = fileUrl.path.replace(/^\/+/, "");
  return `${base}/${path}`;
}
```

Keep `{ resource, path }` in app state and DTOs; call `buildFileUrl` (or equivalent) only when the UI needs an actual string for `src`, `url()`, or similar.

### Backend-to-Backend Auth (Global Backend)

When the miniapp backend calls the global backend on behalf of the system (not forwarding a user request), it MUST use the following headers:

```
X-Forward-Role: admin
X-Forward-User-Id: {userId}
```

This is the service-to-service auth pattern. No JWT token is needed for these calls.

### Auth Middleware (Miniapp Backend)

Provided by `authPlugin` from `@playneta/node-kiss2-lib/plugins`. The plugin decodes JWT payloads from the `Authorization: Bearer <token>` header **without signature verification** — tokens are already validated at the API gateway level. Fallback chain: `X-Forward-*` headers (service-to-service) → Bearer JWT → 401.

Decorates every request with `request.auth: { userId, role }`.

Skips auth for health/infra paths: `/live`, `/ready`, `/startup`, `/metrics`, `/openapi`. Additional paths can be added via the `skipPaths` option (merged with defaults).

### Realtime Updates: when to use WebSockets

If a feature has to react to server-side state changes faster than the user can pull-to-refresh — leaderboards updating live, a round starting, another player placing a bet, a counter changing — use a **WebSocket**, not polling.

Rules of thumb:

- **HTTP + TanStack Query** is the default for everything: forms, status, history, profile. Don't reach for WS just because data is "live-ish"; cache + manual invalidation is enough for most flows.
- **WS** is for *push* — the backend tells subscribed clients "something changed", optionally with a tiny payload. The frontend then either updates UI directly from the event, or invalidates the relevant TanStack Query key and lets the next REST snapshot be the source of truth.
- Keep WS events **small** and let REST stay authoritative for auth/validation/business logic. A typical event is `{ "type": "round-settled" }` — the client invalidates `["round", id]` and re-renders from the refreshed query.
- One WS connection per tab is sufficient. Use a singleton client module (e.g. `app/realtime/ws-client.ts`) that holds the socket, supports refcounted channel subscriptions, and reconnects with exponential backoff. Hooks like `useRealtime(channels, onEvent)` plug components into it without each component opening its own socket.
- Server-side fan-out: use Redis pub/sub. The Fastify pod that handles the WS upgrade subscribes to a Redis channel (`{SERVICE_NAME}:ws:<channel>`) and forwards messages to local sockets — this lets multiple miniapp pods share state without a sticky-session requirement. Keep one Redis subscriber connection per pod, refcounted per channel.
- Validate channel names server-side. Only allow the shapes you actually publish to (e.g. `general` or `group:<uuid>`); reject everything else so a malicious client can't subscribe to arbitrary Redis keys.
- Heartbeats: rely on native WS ping (server sends `ping` every ~30s, browser auto-replies with `pong`) — no client-side timer is needed.

### WebSocket Auth (First-Message Pattern)

The browser `WebSocket` API does not support custom headers on the upgrade request. **Never pass tokens as query parameters** — they leak through server logs, browser history, and referrer headers.

Instead, use the **first-message auth** pattern:

1. **Backend**: Add the WS route path to `authPlugin`'s `skipPaths` so the upgrade request is not rejected. Inside the WS handler, wait for the first message containing `{ "token": "<jwt>" }`, validate it with `decodeJwtPayload` (exported from `@playneta/node-kiss2-lib/plugins` — if the lib version doesn't have it yet, inline the helper), and close the socket if invalid. Start the real logic only after successful auth.
2. **Frontend**: Connect without auth, then immediately send `{ "token": "<jwt>" }` as the first message in `onopen`. Get the token from the bridge SDK via `useFlutterBridge()` → `state.headers.authorization`. Handle `{ "error": "..." }` responses from the server.

## Kafka Event Conventions

All Kafka infrastructure is provided by `@playneta/node-kiss2-lib`. Use `KafkaProducerService` and `KafkaConsumerService` from `@playneta/node-kiss2-lib/services`. Register the `kafkaPlugin` from `@playneta/node-kiss2-lib/plugins` to set up the producer on the Fastify instance.

### Topic Naming

Topics follow the pattern: `miniapp.{serviceName}.{object}.{action}`

The service name (`kiss2-miniapp-durak`) is defined as a local constant `SERVICE_NAME` in `app.ts` and `service.ts`.

Example: `miniapp.kiss2-miniapp-durak.luckyCoin.created`

### Publishing Events

Use the `KafkaProducerService` methods — they handle topic naming and envelope wrapping automatically:

- `producer.sendCreated(object, data, analyticsHeaders)`
- `producer.sendUpdated(object, newData, oldData, analyticsHeaders)`
- `producer.sendUpserted(object, data, analyticsHeaders)`
- `producer.sendDeleted(object, data, analyticsHeaders)`

### Event Envelope

All events use `EventEnvelope<T>` from `@playneta/node-kiss2-lib/types`. The envelope wraps one of four payload forms:

| Action | Payload shape | When to use |
|-----------|--------------------------------------|--------------------------------------|
| `created` | `{ new: T }` | New entity created |
| `updated` | `{ new: T, old: T }` | Entity modified (tracking changes) |
| `upserted`| `{ new: T }` | Entity created or updated (no change tracking) |
| `deleted` | `{ old: T }` | Entity removed |

### Analytics Headers (Meta)

The `analyticsPlugin` from `@playneta/node-kiss2-lib/plugins` extracts analytics headers from incoming HTTP requests and decorates `request.analyticsHeaders`. Pass this to the producer methods so events carry the originating client context.

Analytics headers list:
- `X-Platform`, `X-App`, `X-App-Version`, `X-Session-Id`
- `X-OS-Family`, `X-OS-Version`, `X-Device-Id`, `X-Device-Model`
- `X-Country`, `X-IP-Country`, `X-IP-Country-Name`
- `X-IP-Region`, `X-IP-Region-Name`, `X-IP-City-Name`
- `X-Calculated-Country`, `Accept-Language`, `X-Ru-Proxy`
- `X-Login-Method`, `X-Migration-Related`

## Server Analytics Events (`sendServerAnalytics`)

> **Hard contract.** All miniapps emit server-side analytics into a single shared Kafka topic. The platform backend validates every event and **rejects** anything that violates the contract (Sentry alert, no Kafka, no ClickHouse). Full schema, field tables, multi-user / game-round / system-event examples, and the pre-flight checklist live in [`.claude/rules/server-analytics-events.md`](.claude/rules/server-analytics-events.md). **Read that file before writing any new event or modifying an existing one — do not reconstruct the schema from memory.**

What this rule means at a glance — the things that get most events rejected:

- **Top-level keys in `new` / `old` are a CLOSED LIST.** Allowed: `id`, `userId`, `actors`, `parentId`, `externalId`, `idempotencyKey`, `createdAt`, `updatedAt`, `deletedAt`, `status`, `type`, `source`, `amount`, `currency`, `balance`, `meta`. Anything else (game state, business attributes, prices that aren't `amount`, anything entity-specific) goes into `meta`.
- **`null` is never a value** — anywhere. If a field has no value, **omit the key**. No `"foo": null`, no `"old": null`, no `null` inside `meta`.
- **`id` is a string** (UUID or CUID). Auto-increment integers from your DB are forbidden — generate a UUID/CUID at event-emit time.
- **Multi-user events use `actors: [{role, userId}]`** — never put participants as top-level objects (`winner: {...}` ❌, `bets: [{player: {...}}]` ❌). Role-specific data goes into `meta.actorDetails: [{role, ...}]`, joined by `role`.
- **camelCase everywhere.** No snake_case keys, no IDs/UUIDs/timestamps/usernames as keys (`meta.user_019dbe5d.score` ❌).
- **`updated` events ship a full `old` snapshot**, not a diff.
- **Required keys in `new` / `old`**: `actors`, `createdAt`, `updatedAt`, `meta`. Empty `[]` / `{}` are valid; `null` is not.
- **The producer auto-fills `ts`, `miniappSlug`, and `meta.clientHeaders`** from `analyticsHeaders` — never set them yourself.
- **System events** (cron / game loop / Kafka consumer handler — no incoming HTTP request): `actors: []`, `userId` omitted, pass `{}` as `analyticsHeaders`. Don't invent custom `X-*` headers.

```ts
// Minimal example. See the rule file for multi-user, multi-currency, game-round, and system-event patterns.
await app.kafka.producer.sendServerAnalytics(
  {
    entity: "plant",
    action: "created",
    eventVersion: 1,
    new: {
      actors: [{ role: "owner", userId }],
      createdAt: now,
      updatedAt: now,
      meta: { fertilizerLevel: 0, genome: { color: "ash", flavor: "sweet" } },
      id: plantId,            // UUID / CUID string
      userId,
      status: "growing",
      type: "ashSweet",
      source: "manual",
    },
  },
  request.analyticsHeaders,
);
```

For the full schema, all field tables, action rules, the multi-currency reward pattern, the game-round (multi-user, betting → locked, value-appears-later) example, the system-event example, and the pre-flight checklist — see [`.claude/rules/server-analytics-events.md`](.claude/rules/server-analytics-events.md).

## Wiring a Kafka Consumer in a Miniapp Backend

How to wire up a Kafka event consumer in a new (or existing) miniapp service. Examples and types come from `@playneta/node-kiss2-lib`.

### 1. Dependencies

In the backend `package.json`:

```json
{
  "dependencies": {
    "@playneta/node-kiss2-lib": "^0.1.0",
    "kafkajs": "^2.2.4"
  }
}
```

That's all you need. **Do not** install `@kafkajs/zstd`, `@kafkajs/snappy`, or other codec packages — they pull in native C++ modules (`cppzst`) that won't compile on a `node:alpine` image without `python3 make g++`.

### 2. Env

| Variable | Purpose |
|---|---|
| `KAFKA_SEED_BROKERS` | CSV list of brokers, e.g. `kafka-0.kafka.svc.cluster.local:9092,kafka-1...` |
| `KAFKA_USERNAME` / `KAFKA_PASSWORD` | SASL (SCRAM-SHA-512). Empty values = no SASL (local dev) |
| `SERVICE_NAME` | `kiss2-miniapp-<name>` — used both in `groupId` and in outgoing topic names |

### 3. ZSTD Codec (required)

Out of the box, `kafkajs` only decompresses **gzip**. Platform topics (`purchase.created`, `giftTransaction.created`, etc.) arrive **ZSTD**-compressed — without a registered codec the consumer crashes with `KafkaJSNotImplemented: ZSTD compression not implemented`.

The fix is to register a codec backed by Node's built-in `node:zlib` (Node 22+). No native dependencies required.

`src/infra/kafka-codecs.ts`:

```ts
import { promisify } from "node:util";
import { zstdCompress, zstdDecompress } from "node:zlib";

import kafkajs from "kafkajs";

// CompressionCodecs / CompressionTypes are not detected as named exports
// by Node's cjs-module-lexer (kafkajs assembles them via member access),
// so pull them off the default import.
const { CompressionCodecs, CompressionTypes } = kafkajs;

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

CompressionCodecs[CompressionTypes.ZSTD] = () => ({
  async compress(encoder: { buffer: Buffer }): Promise<Buffer> {
    return compress(encoder.buffer);
  },
  async decompress(buffer: Buffer): Promise<Buffer> {
    return decompress(buffer);
  },
});
```

Register it as a **side-effect import** in the same file that constructs `KafkaConsumerService`, on a line **above** `consumer.run()`:

```ts
import "./infra/kafka-codecs.js";
```

A single import per process is enough — `CompressionCodecs` is a global map inside kafkajs.

### 4. kafkajs Config: SSL, SASL, Retries

When using `KafkaConsumerService` / `KafkaProducerService` from the lib:

- SASL is enabled automatically when `KAFKA_USERNAME` **and** `KAFKA_PASSWORD` are non-empty (`mechanism: scram-sha-512`).
- `ssl: true` is **not** set. Stage/prod K8s brokers accept plaintext + SASL over the internal cluster network — that's sufficient.
- Retries: `initialRetryTime: 100ms`, `retries: 8`, `logLevel: WARN`.

If you build your own `new Kafka({...})` directly (bypassing the lib), **do not** turn on `ssl: true` without checking — TLS against a plaintext port produces exactly this error: `KafkaJSConnectionError: Client network socket disconnected before secure TLS connection was established`.

### 5. Starting the Consumer

The consumer lives in the same Node process as the HTTP server. One Deployment, one pod, shared logger. If the consumer fails to start, Fastify still comes up so health probes don't tank the pod.

`src/index.ts`:

```ts
import { buildApp } from "./app.js";
import { loadEnv } from "./config/index.js";
import { type ConsumerHandle, startConsumer } from "./consumer.js";

async function main() {
  const env = loadEnv();
  const app = await buildApp({ env });

  let consumerHandle: ConsumerHandle | null = null;
  try {
    consumerHandle = await startConsumer(app.log, env);
  } catch (err) {
    app.log.error({ err }, "Consumer failed to start — HTTP server keeps running");
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "Shutting down…");
    if (consumerHandle) await consumerHandle.stop();
    await app.close();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdown(signal));
  }

  await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
```

`src/consumer.ts` (skeleton):

```ts
import { KafkaConsumerService, KafkaProducerService } from "@playneta/node-kiss2-lib/services";
import type { FastifyBaseLogger } from "fastify";
import { createClient } from "redis";

import "./infra/kafka-codecs.js"; // ← register ZSTD before consumer.run()
import { loadEnv } from "./config/index.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { buildPurchaseCreatedHandler } from "./modules/eventConsumer/purchase-created-handler.js";

export interface ConsumerHandle {
  stop(): Promise<void>;
}

export async function startConsumer(
  logger: FastifyBaseLogger,
  env = loadEnv(),
): Promise<ConsumerHandle> {
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  await prisma.$connect();
  logger.info("Consumer: Prisma connected");

  const redis = createClient({ url: env.REDIS_URL });
  redis.on("error", (err) => logger.error({ err }, "Consumer: Redis error"));
  await redis.connect();
  logger.info("Consumer: Redis connected");

  const producer = new KafkaProducerService({
    serviceName: env.SERVICE_NAME,
    brokers: env.KAFKA_SEED_BROKERS.split(","),
    username: env.KAFKA_USERNAME,
    password: env.KAFKA_PASSWORD,
  });
  await producer.connect();
  logger.info("Consumer: Kafka producer connected");

  const consumer = new KafkaConsumerService(
    {
      serviceName: env.SERVICE_NAME,
      brokers: env.KAFKA_SEED_BROKERS.split(","),
      username: env.KAFKA_USERNAME,
      password: env.KAFKA_PASSWORD,
    },
    logger,
  );
  await consumer.connect();
  logger.info("Consumer: Kafka consumer connected");

  await consumer.subscribe([
    buildPurchaseCreatedHandler({ /* deps */ }),
    // ...other handlers
  ]);

  logger.info("Consumer is running. Waiting for messages…");

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      logger.info("Consumer: stopping…");
      try {
        await consumer.disconnect();
        await producer.disconnect();
        await redis.quit();
        await prisma.$disconnect();
      } catch (err) {
        logger.error({ err }, "Consumer: stop error");
      }
    },
  };
}
```

Key points:

- `groupId` is **not set manually** — `KafkaConsumerService` derives it as `miniapp.{serviceName}` (stable across restarts, partitions retain their offsets).
- `connect()` → `subscribe([...])` → `subscribe` internally calls `consumer.run({ eachMessage })`. Once per process.
- Shutdown disconnect order: consumer → producer → redis → prisma. Otherwise kafkajs may wait for a heartbeat on an already-closed socket.

### 6. Subscribing to a Topic and Writing a Handler

Each handler is a function that returns a `TopicSubscription` (a "topic → handler" pair).

```ts
import type { MessageHandler, TopicSubscription } from "@playneta/node-kiss2-lib/services";
import type { CreatedPayload, EventEnvelope } from "@playneta/node-kiss2-lib/types";
import type { EachMessagePayload } from "kafkajs";

function topicSubscription(topic: string, handler: MessageHandler): TopicSubscription {
  return { getTopic: () => topic, getHandler: () => handler };
}

interface PurchaseResponseDTO {
  readonly id: string;
  readonly userId: string;
  readonly bundleId: string;
  readonly status: string;
  readonly createdAt: string;
  // ...
}

type PurchaseCreatedEnvelope = EventEnvelope<CreatedPayload<PurchaseResponseDTO>>;

export function buildPurchaseCreatedHandler(deps: {
  logger: FastifyBaseLogger;
  // ...required services/clients
}): TopicSubscription {
  const { logger /* , ... */ } = deps;

  const handler: MessageHandler = async ({ message, topic, partition }: EachMessagePayload) => {
    const raw = message.value?.toString() ?? null;
    if (!raw) {
      logger.warn({ topic, partition }, "purchase.created: empty — skip");
      return;
    }

    let envelope: PurchaseCreatedEnvelope;
    try {
      envelope = JSON.parse(raw) as PurchaseCreatedEnvelope;
    } catch (err) {
      logger.error({ err, topic, partition }, "purchase.created: JSON parse failed — skip");
      return;
    }

    const payload = envelope.payload?.new;
    if (!payload) {
      logger.warn({ topic, partition }, "purchase.created: missing `payload.new` — skip");
      return;
    }

    // ...business logic
  };

  return topicSubscription("purchase.created", handler);
}
```

#### Topic Names

| Kind | Pattern | Example |
|---|---|---|
| Inbound (platform, outside our convention) | `{object}.{action}` | `purchase.created`, `giftTransaction.created` |
| Outbound (our miniapp) | `miniapp.{serviceName}.{object}.{action}` | `miniapp.kiss2-miniapp-wishlist.wish.created` |

Outbound messages are published via `KafkaProducerService.sendCreated/Updated/Upserted/Deleted` — **don't assemble the name by hand**, the method joins it from `serviceName` in the config.

#### Inbound Message Format (envelope)

Events always arrive in the shared wire format from node-kiss2-lib (`EventEnvelope<T>`):

```json
{
  "payload": { "new": { /* DTO */ } },
  "meta":    { "clientHeaders": { "X-Platform": "...", "..." } },
  "ts":      1777021124518
}
```

The inner `payload` is one of four shapes:

| Action | `payload` shape |
|---|---|
| `created` | `{ new: T }` |
| `updated` | `{ new: T, old: T }` |
| `upserted` | `{ new: T }` |
| `deleted` | `{ old: T }` |

**Important:** OpenAPI docs for platform services (wallet, etc.) show only the **inner** `payload` (`{new: *FooDTO}`) under the "event" entry — but the actual message is always wrapped in an `EventEnvelope`. Read `envelope.payload.new` / `envelope.payload.old`, not `envelope.new`. Use the types from `@playneta/node-kiss2-lib/types` (`EventEnvelope`, `CreatedPayload`, `UpdatedPayload`, `UpsertedPayload`, `DeletedPayload`).

## Redis

Redis connection is provided by `redisPlugin` from `@playneta/node-kiss2-lib/plugins`. It decorates the Fastify instance with `fastify.redis`.

**Key prefixing rule**: ALWAYS prefix all Redis keys with `SERVICE_NAME` to avoid collisions with other miniapps sharing the same Redis instance. Example: `kiss2-miniapp-durak:luckyCoin:{userId}`.

## Health Probes

Kubernetes health checks are provided by `probesPlugin` from `@playneta/node-kiss2-lib/plugins`:
- `GET /live` — liveness probe
- `GET /ready` — readiness probe
- `GET /startup` — startup probe

These routes are hidden from Swagger and excluded from auth.

## Environment Variables

### Backend

| Variable | Description |
|---|---|
| `WALLET_API_URL` | Wallet service URL (k8s: `http://wallet-api-service.kiss.svc.cluster.local`, local: `https://api-stage.kisskissplay.com/wallet`) |
| `AUTH_SECRET_KEY` | Passed to authPlugin (JWT signature is NOT verified — gateway validates upstream) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `KAFKA_BROKERS` | Comma-separated Kafka/Redpanda broker addresses |
| `KAFKA_CLIENT_ID` | Kafka client identifier (also used as consumer group: `miniapp.{KAFKA_CLIENT_ID}`) |

### Frontend

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Miniapp backend URL (default: `http://localhost:3001`) |
| `VITE_GLOBAL_BACKEND_BASE_URL` | Global backend URL for direct frontend calls |

## Commands

```bash
npm run dev              # Start frontend + backend
npm run build            # Build all packages
npm run typecheck        # Type-check all packages
npm run lint             # Biome lint + format check
npm run db:migrate:dev   # Create/apply Prisma migrations
npm run db:generate      # Regenerate Prisma client
```
