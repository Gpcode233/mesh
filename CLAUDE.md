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
- Vercel AI SDK v7 (`ai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`) for agent chat, on Google AI Studio Gemini
- zod 4 for tool input schemas
- NEAR wallet and settlement abstractions

## What has been implemented

### Frontend

The app is route-based (App Router). Shared client state lives in [components/mesh/mesh-provider.tsx](./components/mesh/mesh-provider.tsx); views are in `components/mesh/*`; routes are thin wrappers in `app/(console)/*/page.tsx`, and `app/(console)/layout.tsx` redirects to `/login` without a valid session. `/` is the Head Agent chat (direct chat with any of the six agents, each with its own thread, plus a group channel that fans one message out to all agents). Agent definitions are in [lib/agents.ts](./lib/agents.ts).

The chat page ([components/mesh/head-agent.tsx](./components/mesh/head-agent.tsx)) uses a full-height layout modelled on the Modus project: a conversation column listing the six agent threads and the group channel ([chat-thread-list.tsx](./components/mesh/chat-thread-list.tsx); a drawer on mobile), a header with a status pill and copy/export actions, an error banner with Retry, a scroll pane that follows new messages unless the reader has scrolled up, and a bottom-pinned composer ([chat-composer.tsx](./components/mesh/chat-composer.tsx); Enter sends, Shift+Enter adds a line, per-agent context behind a toggle). [app-shell.tsx](./components/mesh/app-shell.tsx) switches to a viewport-height layout on `/` only. There is one thread per agent: "new conversation" would need several conversations per channel, which the schema does not allow yet. Thread previews show the operator's last message, not the reply, so reply text appears once on the page (the e2e tests rely on that).

Implemented UI and interactions:

- Light-only editorial command-console design
- Responsive desktop sidebar and mobile header
- Overview dashboard
- Procurement pipeline table
- Purchase-order/RFQ creation modal
- Guard Watcher safety panel
- Procurement freeze (Overview → Guard Watcher), stored server-side; owners or operators freeze, only owners unfreeze. Freezing also calls the escrow's `freeze` with the operator key; unfreezing the contract is the owner's (wallet or CLI)
- Wallet connect action
- Simulated live telemetry terminal/activity stream
- Network economics and settlement panels
- Supplier Network workspace
- Settlements workspace: real totals (committed today vs daily limit, approved orders, awaiting settlement); "settled on-chain" counts only `settlements` rows with status `confirmed`
- Order detail: summary cards, a five-phase stepper (RFQ, bids, supplier selected, escrow funded, milestones paid), an Escrow settlement panel, and an activity timeline read from the audit log, refusals included
- Head Agent chat workspace
- Specialized agent selector:
  - Head Agent
  - Scout
  - Compliance
  - Negotiator
  - Settlement
  - Guard
- Per-agent operator context (composer toggle)
- Chat streaming, status pill, and provider error banner with Retry
- Copy and Markdown export of a thread
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
- Calls the model through AI SDK `streamText` ([lib/ai-provider.ts](./lib/ai-provider.ts)) with a multi-step tool loop (at most 5 model calls per turn)
- Streams NDJSON events (`text`, `step`, `done`, `error`; see [lib/chat-events.ts](./lib/chat-events.ts)) when the client sends `Accept: application/x-ndjson`, and plain JSON otherwise. The UI streams; the API tests use JSON. A turn is not cancelled when the client disconnects, so a retry returns the stored reply.
- Uses `gemini-flash-lite-latest` by default (`gemini-2.5-flash` is retired for new keys and `gemini-flash-latest` returned 503 under load). The SDK retries 429/5xx with backoff (`MESH_AI_MAX_RETRIES`, default 3; tests use 0). Do not send `thinkingBudget` — some models reject it. `MESH_AI_BASE_URL` is a base URL (for example `https://generativelanguage.googleapis.com/v1beta`), not a full endpoint.
- Returns `{ agent, content, approval, steps }`. Tool steps are stored on the message (`messages.steps`) and shown in the chat as a collapsible list.
- Tells agents they must not claim work was done (a prompt instruction, not a guarantee)
- Tools are defined in [lib/agent-tools.ts](./lib/agent-tools.ts), scoped to the session's organization, and every call is audited (`agent_tool.called` / `failed` / `rejected`). In direct threads every agent gets read-only tools: `list_orders`, `get_order`, `get_policy`, `list_suppliers`. Group turns get no tools.
- Scout, in its direct thread only, also gets `search_web` (Tavily API via [lib/web-search.ts](./lib/web-search.ts); `MESH_SEARCH_API_KEY`, or `TAVILY_API_KEY`) and `propose_supplier`. Results are untrusted: non-http(s) URLs are dropped, text is cleaned and capped, and the prompt says to treat them as data. `propose_supplier` stores an `add_supplier` approval; its `sourceUrl` must be one of the URLs the server's search returned in this thread: this turn, or stored in `messages.sources` on Scout's replies in the history window (`ToolTurnState.searchResults`). So suppliers cannot be invented, and "add the first one" works without searching again. Approving inserts the supplier, unverified, with `source_url`, atomically like RFQ approval. Without a key the tool returns an explicit "not configured" error.
- `propose_rfq` is offered only to the Head Agent in its direct thread. It stores a pending approval and never creates an RFQ, and it ends the turn. The route, not the model, writes the reply text for a draft. Arguments are validated only by `parseRfqDraft` in [lib/rfq.ts](./lib/rfq.ts); invalid ones produce an explanation and no card. At most one draft per message.
- Has bounded message/context lengths
- Does not invent suppliers, quotes, transactions, attestations, or tool results
- Reports provider failures explicitly

The local environment is configured in [.env](./.env). Never commit or expose the Gemini API key.

`.env.example` is gitignored, so a fresh clone has no template. Create `.env` with these variables:

```env
# Required: agent chat (Google AI Studio)
MESH_AI_PROVIDER=google
MESH_AI_MODEL=gemini-flash-lite-latest
GEMINI_API_KEY=...

# Optional: Scout's web search (Tavily)
# MESH_SEARCH_API_KEY=
# MESH_SEARCH_BASE_URL=https://api.tavily.com

# Required: first operator, created by `npm run db:setup` (password at least 12 characters)
MESH_OPERATOR_EMAIL=...
MESH_OPERATOR_PASSWORD=...

# Optional
# MESH_OPERATOR_NAME=Operator
# MESH_ORG_NAME=Mesh
# MESH_APP_URL=http://localhost:3000
# MESH_AI_BASE_URL=          # base URL, not a full endpoint; defaults per provider
# MESH_AI_MAX_RETRIES=3      # retries for 429/5xx
# DATABASE_URL=file:./data/mesh.db
# DATABASE_AUTH_TOKEN=       # hosted libSQL only
# MESH_CHAT_RATE_LIMIT=30    # chat requests per user per minute
# MESH_LOGIN_RATE_LIMIT=10   # sign-in attempts per email per 15 minutes
# MESH_NEAR_OPERATOR_PRIVATE_KEY=  # written by scripts/near-operator-key.mjs; never set by hand or commit
```

Other providers: set `MESH_AI_PROVIDER` to `openrouter` or `groq` (or any OpenAI-compatible API with `MESH_AI_BASE_URL`) and put the key in `MESH_AI_API_KEY`. `OPENROUTER_API_KEY` and `GROQ_API_KEY` are also read. Google AI Studio is the current provider.

### NEAR escrow contract

[contracts/mesh-escrow](./contracts/mesh-escrow) is a Rust (near-sdk 5.30, Rust 1.97.1) escrow for testnet, settling in native NEAR. NEAR Intents has no testnet, so Intents is deferred to mainnet.

- Owner (`vitalant5887.testnet`) funds orders with an exact attached deposit, sets or revokes the operator mandate, refunds, freezes and unfreezes.
- Operator (the Mesh server, via a function-call key limited to `release_milestone` and `freeze`) releases milestones only to the supplier fixed at funding, within a daily cap and before expiry.
- Failed transfers roll back the milestone and the operator's daily spend in the callback. Events follow NEP-297 (`mesh_escrow`).
- 19 unit tests: `CARGO_TARGET_DIR=~/.cache/mesh-escrow-target cargo test` in WSL. Build in WSL; `cargo-near` and `near` CLI are needed for deployment.
- Deployed on testnet at `mesh.vitalant5887.testnet` (2026-11-10). Owner `vitalant5887.testnet`. Operator key `ed25519:6FxixTDiFETtFfP3m29zdJgrdhg6RR9EJy7Pq7meWvwY` is a function-call key on the contract account (release_milestone, freeze; 1 NEAR gas allowance); its private key is `MESH_NEAR_OPERATOR_PRIVATE_KEY` in `.env`. Mandate: operator `mesh.vitalant5887.testnet`, 10 NEAR per day, expires 2026-12-10 15:31 UTC (`expires_at` 1796916670000000000); renew it with `set_mandate` before then. Steps are in the contract README. `scripts/near-operator-key.mjs` creates the operator key and writes only to `.env`.
- The app calls it. [lib/escrow.ts](./lib/escrow.ts) (server only, `@near-js/*` 2.5.1) reads `get_config`/`get_order`/`get_mandate`, verifies the owner's funding transaction at FINAL, and signs `release_milestone` and `freeze` with the operator key. [lib/settlement.ts](./lib/settlement.ts) holds the flow: supplier NEAR account (`POST /api/suppliers/[id]/near`), funding plan (`GET /api/rfqs/[id]/escrow`, owners only), funding confirmation (`POST .../escrow/fund` with a tx hash), payout (`POST .../escrow/release` with an evidence link). The on-chain order id is the RFQ id. Payout rows are claimed atomically (`pending|failed -> submitted`), the hash is stored before sending, an unknown outcome stays `submitted` and is reconciled from `get_order` on retry, and a milestone is paid only when `get_order` shows `Released`. The milestone plan is fixed at 2 × 0.05 testnet NEAR.
- Browser wallet: [lib/near.ts](./lib/near.ts) uses wallet-selector 10.1.4 with Meteor (MyNearWallet is retired). `near-api-js` stays at 6.5.1 because the Meteor SDK needs its `utils` export; server code imports `@near-js/*` directly.
- Env: `MESH_ESCROW_CONTRACT_ID`, `MESH_NEAR_OPERATOR_ACCOUNT_ID` (defaults to the contract), `MESH_NEAR_NETWORK`, `MESH_NEAR_RPC_URL` (default `https://test.rpc.fastnear.com`), `NEXT_PUBLIC_ESCROW_CONTRACT_ID`. e2e sets the contract and key to empty, so tests never touch the chain.
- `scripts/escrow-smoke.ts` runs the real flow on testnet against `data/escrow-smoke.db`. Verified 2026-11-10: funding verified, a wrong hash refused, both milestones paid to `supplier-demo.vitalant5887.testnet`, a payout refused on-chain while frozen, retried after the owner unfroze.

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
- Supplier selection enforces policy server-side (`policyRefusal` in lib/procurement.ts): freeze, required bid count (distinct suppliers), RFQ budget, supplier region (empty list = any), required documents, settlement route, per-order limit, owner approval threshold, daily limit. The settlement route is `SETTLEMENT_ROUTE` in lib/rfq.ts (NEAR on NEAR, the escrow's asset); an empty asset or chain list approves nothing. Freeze, limits and the daily total are re-checked inside a conditional `INSERT … SELECT`, so concurrent selections cannot exceed the daily limit (tested).
- Supplier documents (`suppliers.documents`) and regions are operator-attested: a bid can mark documents on file, which merge into the supplier record; a recorded region is never overwritten.
- Freeze is `policies.frozen_at`, set through `POST /api/freeze`. While frozen, supplier selection, RFQ draft approval and agent drafts are refused with 423. Key expiry and the freeze behavior text are saved but not enforced: key expiry belongs to the on-chain mandate, which the app does not issue yet.
- Migration gotcha: when drizzle-kit rebuilds a table it emits `PRAGMA foreign_keys=OFF`, which SQLite ignores inside the migration transaction. Dropping a parent table then cascades deletes to its children. Before running such a migration on real data, back up the database and check the generated SQL.
- Auth: email and password (scrypt) with hashed, server-side sessions in an httpOnly cookie. No public sign-up. See [lib/auth.ts](./lib/auth.ts).
- Setup: set `MESH_OPERATOR_EMAIL` and `MESH_OPERATOR_PASSWORD`, then `npm run db:setup`. After a schema change run `npm run db:generate`, then `npm run db:setup`.
- Login rate limiting is per email, so an attacker can lock an operator out for 15 minutes. Add per-IP limits before exposing this publicly.

## Important prototype limitations

This is not production-ready yet:

- The agent registry, overview metrics, guard watcher, settlement mix and activity stream are still in-memory simulations.
- Agents can read the organization's records, the Head Agent can draft an RFQ, and Scout can search the web and propose suppliers for approval. No agent can contact suppliers, request bids, post anywhere, or move money.
- Specialized agents are prompt-routed personas, not independent durable workers.
- Bids are entered by operators. Supplier discovery is web search plus human approval; there is no verification, compliance check, or evidence handling.
- NEAR wallet support is a simplified abstraction.
- Transaction hashes and Intent routes may be mock/local unless a real endpoint is supplied.
- Escrow settles in testnet NEAR with a fixed milestone plan, not the USD bid amount. There is no event indexer: Mesh reads the contract on demand. No e2e test exercises the chain path (it was verified live with scripts/escrow-smoke.ts).
- There is no contract event indexer.
- One organization and one operator are seeded; there is no invitation, password reset, or multi-org switching.
- Guard Watcher is an in-memory browser/service primitive, not a persistent server monitor.
- Orders, policies, registry and audit pages are in-memory/simulated and labelled as such.
- Only a Playwright e2e suite exists. `npm run test:e2e` uses a throwaway database and a fake provider (`tests/fake-provider.mjs`). The fake provider serves both `:generateContent` and `:streamGenerateContent` (SSE) and triggers tool calls on `PROPOSE_RFQ`, `PROPOSE_BAD`, `LIST_ORDERS` and, for Scout, `FIND_SUPPLIERS` (plus `PROPOSE_FOUND` or `PROPOSE_INVENTED`). It also serves a Tavily-shaped `POST /search` that requires `Bearer test-key`. `MESH_LIVE=1 npx playwright test tests/live-chat.spec.ts` calls the real provider. Set `MESH_SKIP_BUILD=1` to reuse an existing build. No unit or contract tests.

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

Done: authentication, role authorization, request validation, rate limiting, conversation persistence, audit events for chat and for every tool call, org-scoped read tools, human approval for the only write tool.

Still needed as write tools are added:

- Per-tool authorization by role
- Human confirmation for every irreversible action

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

Done: Head Agent and specialist tokens stream, and tool calls show as steps. Still to show:

- Specialized agent status
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
