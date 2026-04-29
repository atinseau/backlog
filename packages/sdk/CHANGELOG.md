# Changelog

All notable changes to `@backlog/sdk` are documented here.

## [1.3.0] - 2026-04-29

### Changed

- **Renamed npm package** from `backlog-sdk` to **`@backlog/sdk`**. The scoped form matches the workspace internal naming pattern (`@backlog/core`, `@backlog/server`, `@backlog/desktop`) and locks the `@backlog` scope from squatters. The unscoped `backlog-sdk` will be deprecated on npm with a pointer to the new name. Update your imports: `import { ... } from "@backlog/sdk"`.
- **Aligned version with the rest of the 1.3.0 ecosystem** (CLI + Desktop + SDK all on 1.3.0). The previous 0.x line on the unscoped name continues to exist on npm as `backlog-sdk@0.2.0` but won't receive updates.

### Added

- Documented compatibility: the SDK works against `backlog serve`, the Desktop app, and the hosted Backlog Cloud — all three speak the same OpenAPI 3.0.3 contract.

## [0.2.0] - 2026-04-25

### Added

- Billing: `getBillingConfig`, `getBilling`, `createCheckoutSession`, `createPortalSession`.
- Usage: `getUsage` — month-to-date token spend and remaining quota.
- AI proxy: `aiMessages` — Anthropic Messages passthrough, billed against the workspace quota.
- New exported types: `Subscription`, `BillingConfig`, `CheckoutSession`, `PortalSession`, `UsageReport`, `AiMessage`, `AiMessageRequest`, `AiMessageResponse`.

## [0.1.0] - 2026-04-25

### Added

- Initial release of the TypeScript SDK for Backlog Cloud.
- `BacklogClient` class with bearer-token auth.
- Auth: `signup`, `login`, `logout`, `me`.
- Workspaces: `listWorkspaces`, `createWorkspace`, `getWorkspace`.
- Work items: `listWorkItems`, `createWorkItem`.
- Tasks: `listTasks`, `createTask`.
- Runs: `listRuns`, `createRun`.
- Types auto-generated from the OpenAPI 3.0.3 spec at <https://backlog.so/openapi/v1.yaml>.
- Built on [openapi-fetch](https://www.npmjs.com/package/openapi-fetch) with type generation by [openapi-typescript](https://www.npmjs.com/package/openapi-typescript).
- Apache-2.0 licensed.
