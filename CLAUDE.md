# Mesh project handoff

## Product

Mesh is a NEAR-focused autonomous procurement platform for companies. The intended experience is an AI-first command center where an operator chats with a Head Agent while specialized agents discover suppliers, verify compliance, negotiate terms, monitor spending, and route stablecoin settlement.

The product thesis is:

> Chat is where procurement intent begins, the agent swarm is where execution becomes visible, approvals keep humans in control, and NEAR provides programmable authority and cross-chain settlement.

## Current stack

- Next.js 16.4.3 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui primitives
- Tabler Icons
- GSAP and `@gsap/react`
- Lenis smooth scrolling
- Google AI Studio Gemini API for agent chat
- NEAR wallet and settlement abstractions

## What has been implemented

### Frontend

The app is route-based (App Router). Shared client state lives in [components/mesh/mesh-provider.tsx](./components/mesh/mesh-provider.tsx); views are in `components/mesh/*`; routes are thin wrappers in `app/(console)/*/page.tsx`, and `app/(console)/layout.tsx` redirects to `/login` without a valid session. `/` is the Head Agent chat (direct chat with any of the six agents, each with its own thread, plus a group channel that fans one message out to all agents). Agent definitions are in [lib/agents.ts](./lib/agents.ts).

Implemented UI and interactions:

- Light-only editorial command-console design
- Responsive desktop sidebar and mobile header
- Overview dashboard
- Procurement pipeline table
- Purchase-order/RFQ creation modal
- Guard Watcher safety panel
- Emergency revoke-all-keys and freeze action
- Wallet connect action
- Simulated live telemetry terminal/activity stream
- Network economics and settlement panels
- Supplier Network workspace
- Settlements workspace
- Head Agent chat workspace
- Specialized agent selector:
  - Head Agent
  - Scout
  - Compliance
  - Negotiator
  - Settlement
  - Guard
- Per-agent operator context textarea
- Chat loading and provider error states
- Quick actions for settlement and operational checks
- GSAP entrance choreography with cleanup through `useGSAP`
- Lenis smooth scrolling in [components/smooth-scroll-provider.tsx](./components/smooth-scroll-provider.tsx)

### AI integration

The server-side chat endpoint is [app/api/agent-chat/route.ts](./app/api/agent-chat/route.ts).

It currently:

- Keeps API keys on the server
- Requires a session and an owner or operator role, and is rate limited per user
- Accepts an agent ID, channel, one new message, a `clientTurnId` (makes retries and group fan-out idempotent), and operator context
- Owns chat history: messages are stored server-side and history is read from the database, never taken from the client
- Writes an audit event for every reply and failure, without message content
- Applies a role-specific system instruction
- Calls Google Gemini through the Google AI Studio REST API
- Uses `gemini-flash-lite-latest` by default (`gemini-2.5-flash` is retired for new keys and `gemini-flash-latest` returned 503 under load). Retries 429/503 with backoff. Do not send `thinkingBudget` — some models reject it.
- Returns a structured JSON assistant response
- Tells agents they must not claim work was done (a prompt instruction, not a guarantee)
- Offers one tool, `propose_rfq`, to the Head Agent in its direct thread only, on the Google adapter only. It stores a pending approval and never creates an RFQ. Tool arguments are re-validated with `parseRfqDraft` in [lib/rfq.ts](./lib/rfq.ts); invalid ones produce an explanation and no card.
- Has bounded message/context lengths
- Does not invent suppliers, quotes, transactions, attestations, or tool results
- Reports provider failures explicitly

The local environment is configured in [.env](./.env). Never commit or expose the Gemini API key.

The template is [.env.example](./.env.example). Current provider settings:

```env
MESH_AI_PROVIDER=google
MESH_AI_MODEL=gemini-flash-lite-latest
GEMINI_API_KEY=...
```

OpenRouter and Groq remain possible future adapters, but Google AI Studio is the current provider.

### NEAR and procurement domain

[lib/near.ts](./lib/near.ts) contains:

- Mainnet/testnet RPC configuration
- Mock wallet provider
- Simplified injected browser wallet provider
- Wallet connection abstraction
- Mandate issue/revoke/freeze helper payloads
- Daily allowance and allow-listed method types
- NEAR Intents settlement route wrapper
- Chain Signature payload builder

[lib/agent-engine.ts](./lib/agent-engine.ts) contains:

- RFQ validation and parsing
- Bid creation
- Milestone verification primitives
- Procurement execution flow
- Guard Watcher telemetry and threshold logic
- Key revocation helper

### Persistence and auth

- Database: Drizzle ORM on libSQL. Local SQLite file at `data/mesh.db` (gitignored); a hosted libSQL URL also works through `DATABASE_URL`.
- Schema: [lib/db/schema.ts](./lib/db/schema.ts) has every P0 table. Migrations are in `drizzle/`. Money is integer cents.
- Wired to the app: users, memberships, sessions, conversations, messages, approvals, RFQs, suppliers, bids, orders, policies, audit events, rate limits. Created but unused: agents, mandates, milestones, evidence, settlements.
- Procurement logic lives in [lib/procurement.ts](./lib/procurement.ts). Routes stay thin via `asOperator` in [lib/api.ts](./lib/api.ts).
- Approving a draft and selecting a supplier each run as one atomic `db.batch`, so racing clicks cannot create two RFQs or two orders (tested).
- Supplier selection enforces policy server-side: required bid count (distinct suppliers), RFQ budget, per-order limit, owner approval threshold, daily limit. Regions, documents, assets, chains, key expiry and freeze behavior are saved but not enforced yet. The daily-limit check is not atomic with the insert, so two concurrent selections could exceed it slightly.
- Migration gotcha: when drizzle-kit rebuilds a table it emits `PRAGMA foreign_keys=OFF`, which SQLite ignores inside the migration transaction. Dropping a parent table then cascades deletes to its children. Before running such a migration on real data, back up the database and check the generated SQL.
- Auth: email and password (scrypt) with hashed, server-side sessions in an httpOnly cookie. No public sign-up. See [lib/auth.ts](./lib/auth.ts).
- Setup: set `MESH_OPERATOR_EMAIL` and `MESH_OPERATOR_PASSWORD`, then `npm run db:setup`. After a schema change run `npm run db:generate`, then `npm run db:setup`.
- Login rate limiting is per email, so an attacker can lock an operator out for 15 minutes. Add per-IP limits before exposing this publicly.

## Important prototype limitations

This is not production-ready yet:

- The agent registry, overview metrics, guard watcher, settlement mix and activity stream are still in-memory simulations.
- Gemini responses are not streamed.
- The Head Agent's only tool drafts an RFQ. No agent can search suppliers, request bids, or move money.
- Specialized agents are prompt-routed personas, not independent durable workers.
- Bids are entered by operators. There is no supplier discovery, verification, compliance check, or evidence handling.
- NEAR wallet support is a simplified abstraction.
- Transaction hashes and Intent routes may be mock/local unless a real endpoint is supplied.
- There is no deployed procurement contract.
- There is no contract event indexer.
- One organization and one operator are seeded; there is no invitation, password reset, or multi-org switching.
- Guard Watcher is an in-memory browser/service primitive, not a persistent server monitor.
- Orders, policies, registry and audit pages are in-memory/simulated and labelled as such.
- Only a Playwright e2e suite exists. `npm run test:e2e` uses a throwaway database and a fake provider (`tests/fake-provider.mjs`). `MESH_LIVE=1 npx playwright test tests/live-chat.spec.ts` calls the real provider. Set `MESH_SKIP_BUILD=1` to reuse an existing build. No unit or contract tests.

Never describe a locally generated hash as a confirmed blockchain transaction.

## Highest-priority work

### P0: Make one real vertical slice work

Done so far: natural-language request -> RFQ draft -> approval inside chat -> RFQ -> operator-entered bids -> policy-checked supplier selection -> order -> audit events. Next: NEAR Intent quote onward.

Implement and test:

```text
Natural-language request
-> RFQ creation
-> supplier bids
-> approval inside chat
-> NEAR Intent quote
-> settlement confirmation
-> milestone evidence
-> payout
-> audit event
```

Start with one organization, one operator, one procurement workflow, and NEAR testnet.

### P0: Add persistence

RFQs, bids, orders, suppliers, policies and approvals are done. Still needed for:

- Organizations
- Users and memberships
- Agents
- Agent mandates
- Policies
- Suppliers
- RFQs
- Bids
- Orders
- Milestones
- Evidence
- Settlements
- Agent conversations/messages
- Audit events

### P0: Secure the AI endpoint

Done: authentication, role authorization, request validation, rate limiting, conversation persistence, audit events for chat.

Still needed once tool calling exists:

- Tool-call authorization
- Human confirmation for irreversible actions
- Audit events for every tool call

### P0: Replace NEAR mocks

Implement or deploy a real testnet contract supporting:

- RFQ creation
- Bid submission
- Supplier selection
- Mandate registration
- Allow-listed methods
- Daily spending caps
- Expiration
- Milestone creation/completion
- Payout release
- Freeze/revoke
- Audit event emission

Confirm transaction finality through chain queries before showing success.

### P1: Stream AI responses and agent events

Use a streaming route response or AI SDK integration. The UI should show:

- Head Agent response tokens
- Specialized agent status
- Tool calls
- Evidence references
- Approval requests
- Settlement state changes
- Blocked or failed actions

Recommended event shape:

```ts
type AgentEvent = {
  runId: string
  agentId: string
  type:
    | "thought"
    | "tool_call"
    | "bid_found"
    | "approval_required"
    | "settlement_started"
    | "completed"
    | "blocked"
  payload: Record<string, unknown>
}
```

### P1: Refactor the frontend

Break [app/page.tsx](./app/page.tsx) into focused components:

- `components/mesh/app-shell.tsx`
- `components/mesh/sidebar.tsx`
- `components/mesh/head-agent.tsx`
- `components/mesh/agent-group-chat.tsx`
- `components/mesh/approval-card.tsx`
- `components/mesh/orders-view.tsx`
- `components/mesh/order-detail.tsx`
- `components/mesh/policies-view.tsx`
- `components/mesh/agent-registry.tsx`
- `components/mesh/settlements-view.tsx`
- `components/mesh/audit-log.tsx`

Move from client-side page toggles to App Router routes:

```text
app/page.tsx
app/overview/page.tsx
app/orders/page.tsx
app/orders/[id]/page.tsx
app/agents/page.tsx
app/policies/page.tsx
app/suppliers/page.tsx
app/settlements/page.tsx
app/audit/page.tsx
```

The default route should be the Head Agent chat. Dashboards are the control and evidence layer.

## Required control-plane features

Build a Policy Center with:

- Daily company spend limit
- Per-order limit
- Human approval threshold
- Required bid count
- Approved supplier regions
- Required compliance documents
- Approved assets and chains
- Agent key expiration
- Emergency freeze behavior

Build an Agent Registry showing:

- Agent role
- Online/offline state
- Mandate scope
- Allowed methods
- Spending cap
- Expiration
- Last action
- Spend
- Revocation control

Build order detail timelines:

```text
RFQ created
-> suppliers discovered
-> bids received
-> supplier selected
-> mandate approved
-> Intent submitted
-> payment routed
-> evidence verified
-> milestone paid
-> order completed
```

## Security requirements

- Never put provider secrets or private keys in browser code.
- Enforce policy limits server-side and contract-side.
- Do not allow the model to bypass approvals.
- Use idempotency keys for payments and payouts.
- Add replay protection and nonce handling.
- Make event processing idempotent.
- Add rate limits and abuse protection.
- Log all approvals, tool calls, mandate changes, and settlements.
- Add recovery paths for failed or timed-out jobs.
- Add contract and authorization tests before mainnet.

## Business model direction

Mesh should target procurement teams and operators who need autonomous sourcing with controlled financial authority.

Potential revenue:

- SaaS subscription per organization
- Small fee on settled procurement volume
- Supplier/agent marketplace fees later
- Premium compliance, analytics, and policy controls

Track:

- Buyer savings
- Procurement volume routed through Mesh
- Mesh fees
- NEAR-routed settlement volume
- Supplier conversion and repeat rate

The strongest NEAR positioning is not “AI that recommends purchases.” It is:

> Mesh is the permissioned settlement network for autonomous procurement agents.

## Development commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

If stale Turbopack chunks appear, stop old Next processes, remove `.next`, restart the dev server, and hard-refresh the browser.

## Working conventions

- Preserve the light-only visual direction.
- Use Tabler Icons for icons.
- Reuse existing shadcn/ui primitives.
- Keep secrets out of source control.
- Prefer precise, typed changes.
- Preserve explicit error states; do not silently fall back to fake success.
- Run typecheck, lint, and build after meaningful changes.
- Do not claim mocked behavior is live infrastructure.
