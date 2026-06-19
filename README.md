# kiss2-miniapp-durak

Full-stack miniapp template for building features that run inside the Flutter host app's WebView. React frontend + Fastify backend in an npm workspaces monorepo.

## How it works

```
Flutter host app
  └── WebView
        └── Your miniapp (this template)
              ├── Frontend (React)  ← renders the UI, talks to Flutter via JS bridge
              └── Backend (Fastify) ← API server, database, cache, events
```

The Flutter app opens a WebView pointing at your frontend. The frontend communicates with Flutter via `@playneta/flutter-js-bridge` (auth headers, safe area, in-app purchases, navigation) and with your backend via standard HTTP.

## Quick start

```bash
# 1. Start infrastructure (PostgreSQL, Redis, Redpanda)
docker compose up -d

# 2. Install all dependencies
npm install

# 3. Set up environment
cp .env.example packages/backend/.env
echo 'VITE_API_BASE_URL=http://localhost:3001' > packages/frontend/.env

# 4. Generate Prisma client & run initial migration
npm run db:generate
npm run db:migrate:dev

# 5. Start both frontend and backend
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001 |
| Swagger UI | http://localhost:3001/openapi |
| Redpanda Console | http://localhost:8080 |

In development, the frontend runs in **local mode** — it shows a login form instead of waiting for Flutter's `env_update`. Enter a user ID and impersonation token to authenticate.

## Project structure

```
kiss2-miniapp-durak/
├── packages/
│   ├── frontend/           React Router 7 SSR app (port 3000)
│   │   ├── app/
│   │   │   ├── root.tsx          HTML shell, error boundary
│   │   │   ├── routes.ts         Route config
│   │   │   └── routes/
│   │   │       └── home.tsx      Example page with Flutter bridge
│   │   ├── scripts/
│   │   │   └── fetch-api-docs.sh Fetch OpenAPI specs from stage/prod
│   │   ├── Dockerfile            Production container
│   │   └── vite.config.ts
│   │
│   └── backend/            Fastify 5 API server (port 3001)
│       ├── src/
│       │   ├── config/           Environment config (TypeBox-validated)
│       │   ├── domain/           Pure domain entities (no framework deps)
│       │   ├── infra/
│       │   │   ├── database/     Prisma plugin + base Repository interface
│       │   │   ├── redis/        Redis plugin
│       │   │   └── kafka/        KafkaJS plugin, producer & consumer
│       │   └── modules/
│       │       └── example/      Example CRUD module (repo → service → routes)
│       └── prisma/
│           └── schema.prisma     Database schema
│
├── docker-compose.yml      PostgreSQL 16, Redis 7, Redpanda
├── biome.json              Linter + formatter (tabs, double quotes, semicolons)
└── tsconfig.base.json      Base TypeScript config (strict, ES2022)
```

## Scripts

Run from the monorepo root:

| Command | Description |
|---|---|
| `npm run dev` | Start frontend + backend in parallel |
| `npm run dev:frontend` | Start frontend only |
| `npm run dev:backend` | Start backend only |
| `npm run build` | Build all packages |
| `npm run lint` | Lint everything (Biome) |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run typecheck` | Type-check all packages |
| `npm test` | Run tests across all packages |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate:dev` | Run database migrations (dev) |
| `npm run db:migrate:deploy` | Run database migrations (prod) |

---

## Frontend guide

### Flutter bridge setup

Every page that talks to Flutter needs to be wrapped in `FlutterBridgeProvider`:

```tsx
import {
  FlutterBridgeProvider,
  useFlutterBridge,
  useSendToFlutter,
  useBridgeFetch,
} from "@playneta/flutter-js-bridge";

export default function MyPage() {
  return (
    <FlutterBridgeProvider
      apiBaseUrl={import.meta.env.VITE_API_BASE_URL}
      localMode={import.meta.env.DEV}
      fallback={<div>Loading...</div>}
    >
      <MyContent />
    </FlutterBridgeProvider>
  );
}
```

Provider props:

| Prop | Type | Description |
|---|---|---|
| `apiBaseUrl` | `string` | Base URL for API calls and token refresh |
| `localMode` | `boolean` | Enable login form for local dev (no Flutter needed) |
| `fallback` | `ReactNode` | Shown while waiting for Flutter's `env_update` |

### Making API calls

Use `useBridgeFetch()` — it automatically injects auth headers and handles 401 token refresh:

```tsx
function MyContent() {
  const bridgeFetch = useBridgeFetch();

  const loadItems = async () => {
    const res = await bridgeFetch("/api/v1/items");
    const data = await res.json();
    // data.items, data.nextCursor
  };

  return <button onClick={loadItems}>Load items</button>;
}
```

`bridgeFetch` is a drop-in replacement for `fetch` — same API, but with Flutter headers and automatic token refresh built in.

### Reading bridge state

```tsx
function StatusBar() {
  const { isReady, state, transport } = useFlutterBridge();

  // isReady     — true after first env_update from Flutter
  // state       — { headers, screen, refreshToken }
  // transport   — "native" | "web" | "none"

  if (!isReady) return <Skeleton />;

  return (
    <div style={{ paddingTop: `var(--top-offset)` }}>
      {/* Safe area CSS vars are set automatically by the provider:
          --top-offset, --bottom-offset, --left-offset, --right-offset */}
    </div>
  );
}
```

### Sending events to Flutter

```tsx
function PurchaseButton({ bundleId }: { bundleId: string }) {
  const send = useSendToFlutter();

  return (
    <button onClick={() => send("request_purchase", { bundleId })}>
      Buy
    </button>
  );
}
```

Available actions: `close_webview`, `request_env_update`, `request_webview_reload`, `open_route`, `get_bundle_info`, `request_purchase`, `show_rewards_collected`, `show_rewards_preview`, `page_init_completed`.

### Listening for events from Flutter

```tsx
import { useFlutterEvent } from "@playneta/flutter-js-bridge";

function PurchaseFlow() {
  useFlutterEvent("purchase_result", (payload) => {
    // payload.bundleId, payload.status
    if (payload.status === "purchased") {
      // refresh UI
    }
  });

  useFlutterEvent("bundle_info", (payload) => {
    // payload.bundles — array of BundleInfo
  });
}
```

### Adding a new route

1. Create `app/routes/my-feature.tsx`
2. Register it in `app/routes.ts`:
   ```ts
   import { type RouteConfig, index, route } from "@react-router/dev/routes";

   export default [
     index("routes/home.tsx"),
     route("my-feature", "routes/my-feature.tsx"),
   ] satisfies RouteConfig;
   ```
3. Open it from Flutter via `open_route` with path `/my-feature`

### Adding custom bridge events

If your miniapp needs events beyond the built-in ones, define a custom payload map:

```tsx
interface MyCustomEvents {
  my_custom_action: { someData: string };
}

const send = useSendToFlutter<MyCustomEvents>();
send("my_custom_action", { someData: "hello" }); // fully typed
```

---

## Backend guide

### Architecture

Each feature follows the module pattern:

```
src/modules/<name>/
  ├── repo/         Repository (Prisma data access)
  ├── service/      Business logic (caching, validation)
  └── routes/       Fastify route handlers + TypeBox schemas
```

Domain entities live in `src/domain/<name>/entity.ts` — pure types, no framework deps.

### Adding a new module

**1. Define domain entity** — `src/domain/product/entity.ts`:

```typescript
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProductDTO {
  readonly name: string;
  readonly price: number;
}
```

**2. Add Prisma model** — `prisma/schema.prisma`:

```prisma
model Product {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  price     Int
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("products")
}
```

Then run:

```bash
npm run db:migrate:dev -- --name add_product
npm run db:generate
```

**3. Create repository** — `src/modules/product/repo/product.repo.ts`:

```typescript
import type { PrismaClient } from "../../../generated/prisma/client.js";
import type { Repository } from "../../../infra/database/repository.js";
import type { Product, CreateProductDTO } from "../../../domain/product/entity.js";

export class ProductRepository implements Repository<Product, CreateProductDTO, Partial<CreateProductDTO>> {
  constructor(private readonly prisma: PrismaClient) {}
  // implement findById, findMany, create, update, delete
}
```

**4. Create service** — `src/modules/product/service/product.service.ts`

**5. Create route schemas** — `src/modules/product/routes/schemas.ts` (TypeBox):

```typescript
import { Type } from "typebox";

export const CreateProductBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  price: Type.Integer({ minimum: 0 }),
});
```

**6. Create routes** — `src/modules/product/routes/index.ts`

**7. Register in app.ts**:

```typescript
import { productRoutes } from "./modules/product/routes/index.js";

// inside buildApp():
await app.register(productRoutes, { prefix: "/api/v1" });
```

### Publishing Kafka events

```typescript
import { KafkaProducerService } from "../../../infra/kafka/producer.js";
const producer = new KafkaProducerService(app.kafka.producer);

const event = {
  type: "product.created",
  payload: { productId: product.id },
  timestamp: new Date().toISOString(),
};

await producer.sendOne("product-events", event);
```

### Consuming Kafka events

```typescript
import { KafkaConsumerService } from "../../../infra/kafka/consumer.js";

const consumer = new KafkaConsumerService(app.kafka.consumer, app.log);

await consumer.subscribe([
  {
    topic: "product-events",
    handler: async ({ message }) => {
      const event = JSON.parse(message.value!.toString());
      // process event
    },
  },
]);
```

---

## Environment variables

### Backend (`packages/backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `API_PORT` | `3001` | Server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `NODE_ENV` | `development` | Environment |
| `SENTRY_DSN` | — | Sentry DSN (optional) |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `KAFKA_BROKERS` | `localhost:19092` | Comma-separated broker list |
| `KAFKA_CLIENT_ID` | `kiss2-miniapp` | Kafka client ID (consumer group: `miniapp.{id}`) |

### Frontend (`packages/frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | — | Backend URL (e.g. `http://localhost:3001`) |

---

## Linting and formatting

The monorepo uses [Biome](https://biomejs.dev/) with a single config at the root:

- **Indent**: tabs
- **Quotes**: double
- **Semicolons**: always
- **Line width**: 100

```bash
npm run lint       # check
npm run lint:fix   # auto-fix
```

---

## Deployment

### Frontend (Docker)

The frontend includes a Dockerfile for production:

```bash
cd packages/frontend
docker build -t miniapp-frontend .
docker run -p 3000:3000 miniapp-frontend
```

### Backend

```bash
cd packages/backend
cp ../.env.example .env   # edit with production values
npm run build
npm start                 # runs with Sentry instrumentation
```

### Infrastructure

The `docker-compose.yml` runs PostgreSQL 16, Redis 7, and Redpanda (Kafka-compatible). For production, replace with managed services.
