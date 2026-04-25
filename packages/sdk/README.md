# `backlog-sdk`

TypeScript SDK for [Backlog Cloud](https://backlog.so) and any self-hosted Backlog backend.

[![npm version](https://img.shields.io/npm/v/backlog-sdk.svg)](https://www.npmjs.com/package/backlog-sdk)
[![license](https://img.shields.io/npm/l/backlog-sdk.svg)](./LICENSE)

## Install

```sh
npm install backlog-sdk
# or pnpm/yarn/bun
```

## Quickstart

```ts
import { BacklogClient } from "backlog-sdk";

const backlog = new BacklogClient({
  baseUrl: "https://backlog.so/api/v1", // or your self-hosted URL
});

await backlog.signup("alice@example.com", "password123");
// the SDK now holds your token; subsequent calls are authenticated

const ws = await backlog.createWorkspace("My Team");
console.log(ws.id, ws.slug);

const item = await backlog.createWorkItem(ws.id, {
  external_id: "WI-1",
  title: "Implement scheduler",
  priority: "P1",
});

const items = await backlog.listWorkItems(ws.id);
console.log(items);

// Drive an agent through the proxy — tokens metered against your plan
const reply = await backlog.aiMessages(ws.id, {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 256,
  messages: [{ role: "user", content: "Summarize: " + items[0].title }],
});
console.log(reply.content);

const usage = await backlog.getUsage(ws.id);
console.log(`${usage.usage.ai_tokens} / ${usage.limits.ai_tokens_per_month} tokens used`);
```

## API

### Auth
- `signup(email, password)` → `{ user, token, expires_at }`
- `login(email, password)` → idem
- `logout()` → void
- `me()` → `{ user }`

### Workspaces
- `listWorkspaces()` → `Workspace[]`
- `createWorkspace(name)` → `Workspace`
- `getWorkspace(id)` → `Workspace`

### Work items
- `listWorkItems(workspaceId)` → `WorkItem[]`
- `createWorkItem(workspaceId, input)` → `WorkItem`

### Tasks
- `listTasks(workspaceId)` → `Task[]`
- `createTask(workspaceId, input)` → `Task`

### Runs
- `listRuns(workspaceId, status?)` → `Run[]`
- `createRun(workspaceId, input)` → `Run`

### Billing
- `getBillingConfig()` → `{ publishable_key, prices }` — Stripe.js bootstrap data
- `getBilling(workspaceId)` → `Subscription` — current plan, status, limits
- `createCheckoutSession(workspaceId, { plan, interval, success_url, cancel_url })` → `{ url, session_id }`
- `createPortalSession(workspaceId, { return_url })` → `{ url }`

### Usage
- `getUsage(workspaceId)` → `UsageReport` — month-to-date AI tokens / calls / quota

### AI proxy
- `aiMessages(workspaceId, { model, messages, max_tokens, system, temperature })` → `AiMessageResponse` — Anthropic Messages passthrough, billed against the workspace quota

## Custom backend

If you self-host the backlog backend, point at it via `baseUrl` or `BACKLOG_API_URL` env:

```ts
const backlog = new BacklogClient({ baseUrl: "http://localhost:3000/api/v1" });
```

```sh
export BACKLOG_API_URL=http://localhost:3000/api/v1
```

## Token storage

The SDK keeps the token in memory. Persist it yourself if you want it to survive restarts.

```ts
backlog.setToken(loadFromDisk());
const fresh = await backlog.login("alice@example.com", "pw");
saveToDisk(fresh.token);
```

## Type safety

Types are auto-generated from the [OpenAPI spec](https://backlog.so/openapi/v1.yaml). Every endpoint, parameter, and response shape is type-checked against the live API contract. Schema changes to the backend trigger compile errors on consumers.

## License

[Apache-2.0](./LICENSE)
