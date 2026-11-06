import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/**
 * Money columns are integer minor units (USD/USDC cents) to avoid float rounding.
 * Timestamps are integer milliseconds since epoch.
 */
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID())
const createdAt = () => integer("created_at").notNull().$defaultFn(() => Date.now())
const orgId = () => text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" })

// --- Tenancy and identity ---

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
})

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
})

export const memberships = sqliteTable("memberships", {
  id: id(),
  orgId: orgId(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "operator", "viewer"] }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)])

export const sessions = sqliteTable("sessions", {
  id: id(),
  // SHA-256 of the cookie token; the raw token is never stored.
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user").on(t.userId)])

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
})

// --- Agents and control plane ---

export const agents = sqliteTable("agents", {
  id: id(),
  orgId: orgId(),
  // Matches AgentId in lib/agents.ts.
  role: text("role").notNull(),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("agents_org_role").on(t.orgId, t.role)])

export const agentMandates = sqliteTable("agent_mandates", {
  id: id(),
  orgId: orgId(),
  agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  allowedMethods: text("allowed_methods", { mode: "json" }).$type<string[]>().notNull(),
  dailyCapCents: integer("daily_cap_cents").notNull().default(0),
  spentCents: integer("spent_cents").notNull().default(0),
  nearAccountId: text("near_account_id"),
  nearPublicKey: text("near_public_key"),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  createdAt: createdAt(),
}, (t) => [index("agent_mandates_agent").on(t.agentId)])

export const policies = sqliteTable("policies", {
  id: id(),
  orgId: orgId(),
  dailySpendLimitCents: integer("daily_spend_limit_cents").notNull(),
  perOrderLimitCents: integer("per_order_limit_cents").notNull(),
  approvalThresholdCents: integer("approval_threshold_cents").notNull(),
  requiredBidCount: integer("required_bid_count").notNull(),
  approvedRegions: text("approved_regions", { mode: "json" }).$type<string[]>().notNull(),
  requiredDocuments: text("required_documents", { mode: "json" }).$type<string[]>().notNull(),
  approvedAssets: text("approved_assets", { mode: "json" }).$type<string[]>().notNull(),
  approvedChains: text("approved_chains", { mode: "json" }).$type<string[]>().notNull(),
  agentKeyExpiryHours: integer("agent_key_expiry_hours").notNull(),
  freezeBehavior: text("freeze_behavior").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
}, (t) => [uniqueIndex("policies_org").on(t.orgId)])

// --- Procurement ---

export const suppliers = sqliteTable("suppliers", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  region: text("region"),
  nearAccountId: text("near_account_id"),
  verificationStatus: text("verification_status", { enum: ["unverified", "verified", "rejected"] }).notNull().default("unverified"),
  createdAt: createdAt(),
}, (t) => [index("suppliers_org").on(t.orgId)])

export const rfqs = sqliteTable("rfqs", {
  id: id(),
  orgId: orgId(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  resource: text("resource").notNull(),
  quantity: integer("quantity").notNull(),
  unit: text("unit").notNull(),
  maxBudgetCents: integer("max_budget_cents").notNull(),
  deadline: text("deadline").notNull(),
  destination: text("destination").notNull(),
  status: text("status", { enum: ["draft", "sourcing", "bidding", "awarded", "cancelled"] }).notNull().default("draft"),
  createdAt: createdAt(),
}, (t) => [index("rfqs_org").on(t.orgId)])

export const bids = sqliteTable("bids", {
  id: id(),
  orgId: orgId(),
  rfqId: text("rfq_id").notNull().references(() => rfqs.id, { onDelete: "cascade" }),
  supplierId: text("supplier_id").notNull().references(() => suppliers.id, { onDelete: "restrict" }),
  amountCents: integer("amount_cents").notNull(),
  leadTimeDays: integer("lead_time_days"),
  status: text("status", { enum: ["submitted", "selected", "rejected"] }).notNull().default("submitted"),
  createdAt: createdAt(),
}, (t) => [index("bids_rfq").on(t.rfqId)])

export const orders = sqliteTable("orders", {
  id: id(),
  orgId: orgId(),
  rfqId: text("rfq_id").notNull().references(() => rfqs.id, { onDelete: "restrict" }),
  bidId: text("bid_id").notNull().references(() => bids.id, { onDelete: "restrict" }),
  approvedByUserId: text("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
  status: text("status", { enum: ["pending_approval", "approved", "in_progress", "completed", "cancelled"] }).notNull().default("pending_approval"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("orders_rfq").on(t.rfqId)])

export const milestones = sqliteTable("milestones", {
  id: id(),
  orgId: orgId(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status", { enum: ["pending", "evidence_submitted", "verified", "paid"] }).notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [index("milestones_order").on(t.orderId)])

export const evidence = sqliteTable("evidence", {
  id: id(),
  orgId: orgId(),
  milestoneId: text("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  uri: text("uri").notNull(),
  contentHash: text("content_hash"),
  verifiedAt: integer("verified_at"),
  createdAt: createdAt(),
}, (t) => [index("evidence_milestone").on(t.milestoneId)])

export const settlements = sqliteTable("settlements", {
  id: id(),
  orgId: orgId(),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "restrict" }),
  milestoneId: text("milestone_id").references(() => milestones.id, { onDelete: "restrict" }),
  // Unique per org so a retried payment or payout cannot execute twice.
  idempotencyKey: text("idempotency_key").notNull(),
  amountCents: integer("amount_cents").notNull(),
  asset: text("asset").notNull(),
  chain: text("chain").notNull(),
  // Null until a chain query has confirmed finality; never store a local placeholder here.
  confirmedTxHash: text("confirmed_tx_hash"),
  status: text("status", { enum: ["pending", "submitted", "confirmed", "failed"] }).notNull().default("pending"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("settlements_org_idempotency").on(t.orgId, t.idempotencyKey)])

// --- Conversations and audit ---

export const conversations = sqliteTable("conversations", {
  id: id(),
  orgId: orgId(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // "group", or "direct:<agentId>".
  channel: text("channel").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("conversations_owner_channel").on(t.orgId, t.userId, t.channel)])

export const messages = sqliteTable("messages", {
  // Autoincrement gives a total order, used to cut history at the current turn.
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  // "user", or an AgentId.
  author: text("author").notNull(),
  content: text("content").notNull(),
  // Client-generated turn id: makes retries and group fan-out idempotent.
  clientTurnId: text("client_turn_id").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("messages_turn_author").on(t.conversationId, t.clientTurnId, t.author)])

/** Append-only at the application layer: there is no update or delete path. */
export const auditEvents = sqliteTable("audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  target: text("target"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
}, (t) => [index("audit_events_org").on(t.orgId, t.id)])
