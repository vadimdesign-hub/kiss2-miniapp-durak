# kiss2-template

Miniapp backend template — Fastify + Prisma + Redis + Redpanda.

## Stack

- **Fastify 5** with TypeBox type provider
- **Prisma** ORM (PostgreSQL)
- **ioredis** (Redis)
- **KafkaJS** (Redpanda / Kafka consumers & producers)
- **Biome** linter + formatter
- **tsx** for dev, **tsc** for production builds

## Quick start

```bash
# 1. Start infrastructure
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy env and adjust if needed
cp .env.example .env

# 4. Generate Prisma client & run migrations
npm run db:generate
npm run db:migrate:dev

# 5. Start dev server
npm run dev
```

Swagger UI: http://localhost:3000/openapi

## Project structure

```
src/
  config/         # Environment config (TypeBox-validated)
  infra/
    database/     # Prisma plugin + base repository interface
    redis/        # ioredis plugin
    kafka/        # KafkaJS plugin, producer & consumer services
  domain/
    example/      # Domain entities (pure types, no framework deps)
  modules/
    example/
      repo/       # Repository implementations (Prisma-backed)
      service/    # Business logic
      routes/     # Fastify route handlers + TypeBox schemas
prisma/
  schema.prisma   # Database schema
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with hot-reload (tsx) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run lint` | Biome check + tsc --noEmit |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate:dev` | Run migrations (dev) |
| `npm run db:migrate:deploy` | Run migrations (prod) |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run tests (vitest) |

## Adding a new module

1. Define domain entities in `src/domain/<name>/entity.ts`
2. Create repo in `src/modules/<name>/repo/`
3. Create service in `src/modules/<name>/service/`
4. Create routes + schemas in `src/modules/<name>/routes/`
5. Register routes in `src/app.ts`
