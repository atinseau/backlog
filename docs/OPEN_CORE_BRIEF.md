# Backlog — Open-Core & Messaging Brief

> Audience: Jimmy. Pragmatic, ship-first. Citations point at concrete files in `/Users/jimmy/Dev/backlog/backlog-cli`.

## 1. Open-Core boundary

Anchor rule from `AGENTS.md` and `docs/ROADMAP.md`: **default mode is fully local; remote is opt-in.** That principle is the open-core boundary. If a feature needs *your* infrastructure to deliver it, it's Cloud. Everything else stays Apache-2.0 forever.

Open-source forever (`packages/cli`, `packages/sdk`, `packages/desktop`, `packages/server`, `packages/board-ui`, all `@backlog/*` monorepo packages):

- CLI core: `init`, `doctor`, `task`, `claim`, `runs`, `worktree`, `schedule`, `agents`, `sources`, `release`, `hooks`.
- SDK (`packages/sdk`) — published standalone so anyone can embed the orchestrator. Currently bundled into the CLI tarball per `AGENTS.md`; lift it.
- Desktop app (`packages/desktop`) — full kanban, agent management, repo management, run activity, **local invitations as today (link-only, no SMTP)**, local Users page.
- Embedded Hono server (`packages/server`) running on `localhost`, single-machine, single-user.
- All connectors that the user runs against their own credentials: GitHub, GitLab, Linear, Jira, Notion, Trello, Asana (Phase 2/3 of roadmap). Bring-your-own-token = open source.
- Local executors: Claude Code, Codex, custom command. SSH-to-your-own-box executors. Your own Coder/Gitpod/Codespaces sandbox.
- Local run history, local audit trail in `.backlog/`, file-based.

Cloud / paid only:

- **SMTP email delivery** for invitations, digests, run notifications. Hard gate — running an SMTP relay is a real cost and a real abuse surface.
- **Hosted auth**: password reset flows, magic links, Google/GitHub OAuth as a *managed* identity layer, SAML/OIDC SSO, SCIM provisioning. (OAuth *as a connector token* stays free; OAuth *as a login mechanism into a hosted tenant* is paid.)
- **Multi-tenant collaboration**: shared project state across machines, presence, real-time board sync, cross-device claim resolution.
- **Hosted run executors**: Anthropic Managed Agents, hosted ephemeral sandboxes, hosted Codex over our infra. The plumbing (Phase 5 in `ROADMAP.md`) ships open; the *hosted endpoint* is paid.
- **Run history retention beyond local disk**, cross-device search, replay, artifacts blob storage.
- **Audit log export** (SOC2-flavored: tamper-evident, retained, exportable to S3/SIEM). Local audit stays free.
- **Telemetry**: opt-in product analytics. Free tier sends nothing by default; Cloud has built-in usage analytics for the team.
- **Support SLAs, priority response, custom contracts.**

This boundary is defensible because it maps to *infrastructure we run*, not features we artificially gate.

## 2. Pricing tiers

Reference: Linear (per-seat with generous free), Sentry (usage + seats), GitHub Copilot (per-seat flat), Postman (per-seat with collaboration gates). The right analog is **Linear**: seat-priced, free tier is genuinely usable forever for individuals.

| Tier | Who | Includes | Price | Upgrade trigger |
|---|---|---|---|---|
| **Free / OSS** | Solo devs, OSS maintainers, anyone running locally | CLI + SDK + Desktop, all features, unlimited local repos, unlimited local runs, all connectors with BYO token | $0 | When you need a second human in the loop with email invites |
| **Pro** | Power individuals who want hosted backup + multi-machine sync | Free + hosted project sync (1 user, N devices), 30-day run history retention, email digests | **$8/mo** | When you add a teammate |
| **Team** | 2–25 person dev teams running agent fleets together | Pro + multi-user collaboration, SMTP invites, SSO via Google/GitHub OAuth, shared run history (90d), basic audit log, hosted ephemeral sandboxes (metered) | **$16/user/mo** | When procurement asks for SAML or SOC2 |
| **Enterprise** | 25+, regulated industries | Team + SAML/OIDC SSO, SCIM, audit log export, custom retention, on-prem / VPC option, support SLA, DPA | Custom (~$40/user/mo floor) | Sales call |

Hosted compute (sandboxes, managed agents) is **metered on top of all paid tiers** — Sentry-style — so the seat price doesn't blow up if a customer doesn't use them.

Free is the load-bearing tier. No asterisks: every feature in the desktop app today works on Free forever.

## 3. Website structure

The site currently sells the CLI. Recast as a product family.

**Hero (3 lines):**
> **Backlog** — the task orchestrator for humans and AI coding agents.
> Run Claude Code, Codex, and your own CLIs across isolated git worktrees, with claims, retries, and review.
> Free and open-source for personal use. Desktop, CLI, and SDK — no account required.

**Three product cards** below the hero:

1. **Backlog CLI** — `npm i -g backlog`. Headless, scriptable, the one you put in CI. Apache-2.0.
2. **Backlog Desktop** — Mac, Windows, Linux. Kanban board, run inspector, agent fleet. Same engine as the CLI. Free.
3. **Backlog SDK** — `@backlog/sdk` on npm. Embed the orchestrator in your own tool. TypeScript-first, OpenAPI spec in `packages/sdk/openapi/`.

**Feature sections** (in order): Worktree isolation → Claims & locking → Multi-agent scheduling → Review flows → Connectors (GitHub/Linear/Jira). One screenshot per section, all from Desktop.

**Pricing page**: 4 columns matching §2. Free column gets a green "no credit card, no signup, runs offline" badge. Cloud columns clearly say "managed by us, opt-in."

**Product pages**: `/cli`, `/desktop`, `/sdk`, `/cloud`. Each links to its `README.md`. `/cloud` is allowed to be a waitlist page until the private repo ships.

**CTA strategy**: primary CTA in hero is **"Download Desktop"** (DMG). Secondary is **`npm i -g backlog`** as a copyable code block. Tertiary, in the nav, is "Join Cloud waitlist." Don't lead with the paid product on a project that's 95% open-source.

## 4. Naming + positioning risks

"Backlog" is a generic noun, already used by Basecamp ("Basecamp Backlog" feature), Atlassian Jira ("Backlog view"), Azure DevOps ("Product Backlog"), and Nulab's standalone product *Backlog* (backlog.com — project management SaaS, Japanese-origin, real trademark, real SEO presence). **Nulab Backlog is the actual collision** — they own the .com and the search term.

SEO check: searching "backlog" today returns Nulab first. You will not rank. The npm name `backlog` is yours, but the brand isn't.

Recommendation: **rename before the marketing site goes live**. Three candidates:

1. **Worktree** — literal, descriptive, the core mental model. Domain availability needs checking; possibly `worktree.dev`.
2. **Claimflow** — leans on the unique primitive (claims/locking across agents); no collision; ownable.
3. **Roost** — short, memorable, "where your agents perch and work". Clean SEO, easy to trademark.

If you keep "Backlog", at minimum brand it as **Backlog.dev** or **Backlog Agents** in all marketing, and accept you'll spend money on SEM to outbid Nulab.

## 5. Desktop distribution

Today: signed DMG, no notarization → Gatekeeper shows the "unidentified developer / right-click open" friction. That's a conversion killer for a homepage CTA.

Launch sequence:

1. **Week 1** — pay the $99 Apple Developer fee, notarize and staple. Same DMG, same `electron-builder.yml`, just enable `notarize: true` and add an app-specific password via env. This is the single highest-ROI improvement.
2. **Week 1** — ship Windows build (code-signed via Azure Trusted Signing, ~$10/mo, much cheaper than EV cert) and Linux AppImage. `electron-builder` already handles all three from the same config.
3. **Week 2** — wire **electron-updater against GitHub Releases**. Don't stand up S3 yet — GitHub Releases is free, has `latest.yml` support, and `electron-updater` reads it natively. Move to S3/CloudFront only when bandwidth bites (>50GB/mo).
4. **Week 3** — submit **Homebrew cask** (`brew install --cask backlog`). Trivial PR to homebrew-cask once the DMG is notarized and has a stable URL.
5. **Week 4** — **winget** manifest (Windows) and **Snap** (Ubuntu Software). AppImage is already the Linux fallback.
6. **Later** — Mac App Store and Microsoft Store only if you want them; both are tax + sandbox pain for marginal reach.

Channels: `latest` (stable), `beta` (opt-in via Settings → Updates). Both flow through GitHub Releases with a prerelease flag.

## 6. What the homepage must NOT do

1. **Don't promise Cloud features that aren't built.** Today the desktop app has link-only invitations and no SMTP. The site must say so plainly. Listing "email invites" without "(Cloud, coming soon)" will burn trust the first time someone tries it.
2. **Don't bury the free story.** The current risk, given Cloud is the monetization play, is to let pricing sneak into every CTA. Resist. The hero, the install command, the Download Desktop button — none of them should require an email. Linear got this right; Postman got it wrong for years and is still digging out.

Avoid jargon in the hero ("orchestrator" is borderline — keep it because the audience is devs, but "claim resolution" and "scope-based scheduling" belong on `/features`, not the hero).
