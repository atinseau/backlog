# `@osmove/backlog-sdk`

TypeScript SDK for [Backlog Cloud](https://backlog.so) — a typed client for the backlog.so REST API.

[![npm version](https://img.shields.io/npm/v/@osmove/backlog-sdk.svg)](https://www.npmjs.com/package/@osmove/backlog-sdk)
[![license](https://img.shields.io/npm/l/@osmove/backlog-sdk.svg)](./LICENSE)

> **Scope.** This SDK targets the **Backlog Cloud** backend (the hosted SaaS). It is **not** a client for the local `backlog serve` server bundled in the [`backlog`](https://www.npmjs.com/package/backlog) CLI — that server has its own evolving API and does not expose Cloud's auth, billing, or AI-proxy endpoints. If you self-host the Backlog Cloud Rails backend at your own URL, point the SDK at it via `baseUrl`.

## Install

```sh
npm install @osmove/backlog-sdk
# or pnpm/yarn/bun
```

## Quickstart

```ts
import { BacklogClient } from "@osmove/backlog-sdk";

const backlog = new BacklogClient({
  baseUrl: "https://backlog.so/api/v1", // or your self-hosted URL
});

await backlog.signup("alice@example.com", "password123");
// the SDK now holds your token; subsequent calls are authenticated

const project = await backlog.createProject("My Team");
console.log(project.id, project.slug);

const task = await backlog.createTask(project.id, {
  external_id: "TASK-1",
  title: "Implement scheduler",
  priority: "P1",
});

const tasks = await backlog.listTasks(project.id);
console.log(tasks);

// Drive an agent through the proxy — tokens metered against your plan
const reply = await backlog.aiMessages(project.id, {
  model: "claude-haiku-4-5-20251001",
  max_tokens: 256,
  messages: [{ role: "user", content: "Summarize: " + tasks[0].title }],
});
console.log(reply.content);

const usage = await backlog.getUsage(project.id);
console.log(`${usage.usage.ai_tokens} / ${usage.limits.ai_tokens_per_month} tokens used`);
```

## API

### Auth
- `signup(email, password)` → `{ user, token, expires_at }`
- `login(email, password)` → idem
- `logout()` → void
- `me()` → `{ user }`

### Projects
- `listProjects()` → `Project[]`
- `createProject(name)` → `Project`
- `getProject(id)` → `Project`

### Tasks
- `listTasks(projectId)` → `Task[]`
- `createTask(projectId, input)` → `Task`

### Subtasks
- `listSubtasks(projectId)` → `Subtask[]`
- `createSubtask(projectId, input)` → `Subtask`

### Runs
- `listRuns(projectId, status?)` → `Run[]`
- `createRun(projectId, input)` → `Run`

### Billing
- `getBillingConfig()` → `{ publishable_key, prices }` — Stripe.js bootstrap data
- `getBilling(projectId)` → `Subscription` — current plan, status, limits
- `createCheckoutSession(projectId, { plan, interval, success_url, cancel_url })` → `{ url, session_id }`
- `createPortalSession(projectId, { return_url })` → `{ url }`

### Usage
- `getUsage(projectId)` → `UsageReport` — month-to-date AI tokens / calls / quota

### AI proxy
- `aiMessages(projectId, { model, messages, max_tokens, system, temperature })` → `AiMessageResponse` — Anthropic Messages passthrough, billed against the project quota

## Self-hosting the Backlog Cloud backend

If you run your own deployment of the Backlog Cloud Rails backend, point the SDK at it via `baseUrl` or the `BACKLOG_API_URL` env var:

```ts
const backlog = new BacklogClient({ baseUrl: "https://backlog.example.com/api/v1" });
```

```sh
export BACKLOG_API_URL=https://backlog.example.com/api/v1
```

Note: this is **not** the same thing as `backlog serve` (the local kanban server bundled with the CLI). `backlog serve` exposes its own `/api/v1/*` shape that does not match this SDK.

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
