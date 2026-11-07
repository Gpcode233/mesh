import { and, desc, eq, gte, inArray, ne, sql, sum } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import type { Session } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { approvals, bids, orders, policies, rfqs, suppliers } from "@/lib/db/schema"
import {
  isPositiveAmount,
  parseRfqDraft,
  usd,
  type ApprovalStatus,
  type ApprovalView,
  type BidView,
  type OrderDetailView,
  type OrderRow,
  type PolicyView,
  type RfqDraft,
  type SupplierView,
} from "@/lib/rfq"

/** A refusal the caller can show as-is; `status` is the HTTP status to return. */
export class DomainError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function isUniqueViolation(error: unknown) {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    if (String((current as { message?: unknown }).message ?? current).includes("UNIQUE constraint failed")) return true
  }
  return false
}

const auditFor = (session: Session) => ({ orgId: session.orgId, actorUserId: session.userId })

// --- Reads ---

export async function listOrders(orgId: string): Promise<OrderRow[]> {
  const db = getDb()
  const rows = await db.select().from(rfqs).where(eq(rfqs.orgId, orgId)).orderBy(desc(rfqs.createdAt))
  if (rows.length === 0) return []
  const bidRows = await db
    .select({ rfqId: bids.rfqId, status: bids.status, supplier: suppliers.name })
    .from(bids)
    .innerJoin(suppliers, eq(suppliers.id, bids.supplierId))
    .where(eq(bids.orgId, orgId))
  return rows.map((row) => {
    const own = bidRows.filter((bid) => bid.rfqId === row.id)
    return {
      id: row.id,
      resource: row.resource,
      quantity: row.quantity,
      unit: row.unit,
      maxBudgetCents: row.maxBudgetCents,
      deadline: row.deadline,
      destination: row.destination,
      status: row.status,
      bidCount: own.length,
      supplier: own.find((bid) => bid.status === "selected")?.supplier ?? null,
    }
  })
}

export async function getOrderDetail(orgId: string, id: string): Promise<OrderDetailView | null> {
  const db = getDb()
  const [row] = await db.select().from(rfqs).where(and(eq(rfqs.orgId, orgId), eq(rfqs.id, id)))
  if (!row) return null
  const bidRows: BidView[] = await db
    .select({
      id: bids.id,
      supplier: suppliers.name,
      region: suppliers.region,
      amountCents: bids.amountCents,
      leadTimeDays: bids.leadTimeDays,
      status: bids.status,
    })
    .from(bids)
    .innerJoin(suppliers, eq(suppliers.id, bids.supplierId))
    .where(eq(bids.rfqId, id))
    .orderBy(bids.amountCents)
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.rfqId, id))
  const policy = await loadPolicy(orgId)
  return {
    id: row.id,
    resource: row.resource,
    quantity: row.quantity,
    unit: row.unit,
    maxBudgetCents: row.maxBudgetCents,
    deadline: row.deadline,
    destination: row.destination,
    status: row.status,
    bidCount: bidRows.length,
    supplier: bidRows.find((bid) => bid.status === "selected")?.supplier ?? null,
    bids: bidRows,
    requiredBidCount: policy.requiredBidCount,
    orderStatus: order?.status ?? null,
  }
}

export async function listSuppliers(orgId: string): Promise<SupplierView[]> {
  return getDb()
    .select({
      id: suppliers.id,
      name: suppliers.name,
      region: suppliers.region,
      verificationStatus: suppliers.verificationStatus,
      bidCount: sql<number>`(SELECT count(*) FROM ${bids} WHERE ${bids.supplierId} = ${suppliers.id})`,
    })
    .from(suppliers)
    .where(eq(suppliers.orgId, orgId))
    .orderBy(suppliers.name)
}

// --- RFQs ---

function rfqValues(session: Session, draft: RfqDraft) {
  return {
    orgId: session.orgId,
    createdByUserId: session.userId,
    resource: draft.resource,
    quantity: draft.quantity,
    unit: draft.unit,
    maxBudgetCents: Math.round(draft.maxBudget * 100),
    deadline: draft.deadline,
    destination: draft.destination,
    status: "sourcing" as const,
  }
}

/** Direct creation by a signed-in human through the form. */
export async function createRfq(session: Session, input: unknown) {
  const parsed = parseRfqDraft(input)
  if (!parsed.ok) throw new DomainError(parsed.error, 400)
  const [row] = await getDb().insert(rfqs).values(rfqValues(session, parsed.draft)).returning({ id: rfqs.id })
  await recordAudit({ ...auditFor(session), action: "rfq.created", target: row.id, metadata: { source: "form" } })
  return row.id
}

// --- Approvals ---

function toApprovalView(row: { id: string; status: ApprovalStatus; payload: unknown; resultId: string | null }): ApprovalView {
  return { id: row.id, status: row.status, draft: row.payload as RfqDraft, resultId: row.resultId }
}

export async function getApprovalViews(orgId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, ApprovalView>()
  const rows = await getDb().select().from(approvals).where(and(eq(approvals.orgId, orgId), inArray(approvals.id, ids)))
  return new Map(rows.map((row) => [row.id, toApprovalView(row)]))
}

/**
 * The only thing an agent can do: store a draft for a human to decide on.
 * It deliberately writes no RFQ, so model output cannot create one.
 */
export async function proposeRfq(session: Session, agent: string, draft: RfqDraft) {
  const [row] = await getDb().insert(approvals).values({
    orgId: session.orgId,
    kind: "create_rfq",
    requestedByAgent: agent,
    requestedByUserId: session.userId,
    payload: draft,
  }).returning()
  await recordAudit({ ...auditFor(session), action: "approval.requested", target: row.id, metadata: { kind: "create_rfq", agent } })
  return toApprovalView(row)
}

export async function decideApproval(session: Session, id: string, decision: "approve" | "reject"): Promise<ApprovalView> {
  const db = getDb()
  const [approval] = await db.select().from(approvals).where(and(eq(approvals.orgId, session.orgId), eq(approvals.id, id)))
  if (!approval) throw new DomainError("Approval not found.", 404)
  if (approval.status !== "pending") throw new DomainError(`This request was already ${approval.status}.`, 409)
  const stillPending = and(eq(approvals.id, id), eq(approvals.status, "pending"))
  const decided = { decidedByUserId: session.userId, decidedAt: Date.now() }

  if (decision === "reject") {
    const [row] = await db.update(approvals).set({ ...decided, status: "rejected" }).where(stillPending).returning()
    if (!row) throw new DomainError("This request was already decided.", 409)
    await recordAudit({ ...auditFor(session), action: "approval.rejected", target: id })
    return toApprovalView(row)
  }

  // Re-validate at decision time: the deadline may have passed since the draft was made.
  const parsed = parseRfqDraft(approval.payload)
  if (!parsed.ok) throw new DomainError(`This draft can no longer be approved: ${parsed.error}`, 422)

  // One atomic batch, with the insert conditional on the approval still being pending,
  // so concurrent approve/approve or approve/reject cannot create an RFQ twice or after a rejection.
  const rfqId = crypto.randomUUID()
  const values = rfqValues(session, parsed.draft)
  const [, updated] = await db.batch([
    db.run(sql`
      INSERT INTO rfqs (id, org_id, created_by_user_id, resource, quantity, unit, max_budget_cents, deadline, destination, status, created_at)
      SELECT ${rfqId}, ${values.orgId}, ${values.createdByUserId}, ${values.resource}, ${values.quantity}, ${values.unit},
             ${values.maxBudgetCents}, ${values.deadline}, ${values.destination}, ${values.status}, ${Date.now()}
      WHERE EXISTS (SELECT 1 FROM approvals WHERE id = ${id} AND status = 'pending')
    `),
    db.update(approvals).set({ ...decided, status: "approved", resultId: rfqId }).where(stillPending).returning(),
  ])
  const [row] = updated
  if (!row) throw new DomainError("This request was already decided.", 409)
  await recordAudit({ ...auditFor(session), action: "rfq.created", target: rfqId, metadata: { source: "approval", approvalId: id, agent: approval.requestedByAgent } })
  return toApprovalView(row)
}

// --- Bids ---

export async function recordBid(session: Session, rfqId: string, input: unknown) {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const supplierName = typeof value.supplier === "string" ? value.supplier.trim() : ""
  if (!supplierName || supplierName.length > 200) throw new DomainError("A supplier name is required.", 400)
  if (!isPositiveAmount(value.amount)) throw new DomainError("Bid amount must be a number greater than zero.", 400)
  const leadTimeDays = value.leadTimeDays === undefined || value.leadTimeDays === null ? null : value.leadTimeDays
  if (leadTimeDays !== null && (typeof leadTimeDays !== "number" || !Number.isInteger(leadTimeDays) || leadTimeDays < 0 || leadTimeDays > 3650)) {
    throw new DomainError("Lead time must be a whole number of days.", 400)
  }
  const region = typeof value.region === "string" && value.region.trim() ? value.region.trim().slice(0, 100) : null

  const db = getDb()
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.orgId, session.orgId), eq(rfqs.id, rfqId)))
  if (!rfq) throw new DomainError("RFQ not found.", 404)
  if (rfq.status === "awarded" || rfq.status === "cancelled") throw new DomainError(`This RFQ is ${rfq.status} and no longer accepts bids.`, 409)

  await db.insert(suppliers).values({ orgId: session.orgId, name: supplierName, region }).onConflictDoNothing()
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.orgId, session.orgId), eq(suppliers.name, supplierName)))

  try {
    const bidId = crypto.randomUUID()
    await db.batch([
      db.insert(bids).values({
        id: bidId,
        orgId: session.orgId,
        rfqId,
        supplierId: supplier.id,
        amountCents: Math.round(value.amount * 100),
        leadTimeDays: leadTimeDays as number | null,
      }),
      db.update(rfqs).set({ status: "bidding" }).where(and(eq(rfqs.id, rfqId), eq(rfqs.status, "sourcing"))),
    ])
    await recordAudit({ ...auditFor(session), action: "bid.recorded", target: bidId, metadata: { rfqId, source: "operator" } })
    return bidId
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError(`${supplierName} already has a bid on this RFQ.`, 409)
    throw error
  }
}

/** Selecting a supplier is the human approval step. Policy is enforced here, not in the UI. */
export async function selectBid(session: Session, rfqId: string, bidId: string) {
  const db = getDb()
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.orgId, session.orgId), eq(rfqs.id, rfqId)))
  if (!rfq) throw new DomainError("RFQ not found.", 404)
  if (rfq.status === "awarded") throw new DomainError("A supplier was already selected for this RFQ.", 409)
  if (rfq.status === "cancelled") throw new DomainError("This RFQ was cancelled.", 409)
  const rfqBids = await db.select().from(bids).where(and(eq(bids.orgId, session.orgId), eq(bids.rfqId, rfqId)))
  const bid = rfqBids.find((entry) => entry.id === bidId)
  if (!bid) throw new DomainError("Bid not found on this RFQ.", 404)

  const policy = await loadPolicy(session.orgId)
  const refuse = async (reason: string, status = 422): Promise<never> => {
    await recordAudit({ ...auditFor(session), action: "order.blocked", target: rfqId, metadata: { bidId, reason } })
    throw new DomainError(reason, status)
  }
  if (rfqBids.length < policy.requiredBidCount) await refuse(`Policy requires ${policy.requiredBidCount} bids; this RFQ has ${rfqBids.length}.`)
  if (bid.amountCents > rfq.maxBudgetCents) await refuse(`This bid (${usd(bid.amountCents)}) is over the RFQ budget (${usd(rfq.maxBudgetCents)}).`)
  if (bid.amountCents > policy.perOrderLimit * 100) await refuse(`This bid (${usd(bid.amountCents)}) is over the per-order limit (${usd(policy.perOrderLimit * 100)}).`)
  if (bid.amountCents > policy.approvalThreshold * 100 && session.role !== "owner") {
    await refuse(`Bids over ${usd(policy.approvalThreshold * 100)} need an owner to approve.`, 403)
  }

  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  const [{ spent }] = await db
    .select({ spent: sum(bids.amountCents) })
    .from(orders)
    .innerJoin(bids, eq(bids.id, orders.bidId))
    .where(and(eq(orders.orgId, session.orgId), gte(orders.createdAt, midnight.getTime()), ne(orders.status, "cancelled")))
  const committed = Number(spent ?? 0)
  if (committed + bid.amountCents > policy.dailySpendLimit * 100) {
    await refuse(`This would commit ${usd(committed + bid.amountCents)} today, over the daily limit (${usd(policy.dailySpendLimit * 100)}).`)
  }

  try {
    const orderId = crypto.randomUUID()
    // Atomic: the unique index on orders.rfq_id rolls everything back if another selection won.
    await db.batch([
      db.insert(orders).values({ id: orderId, orgId: session.orgId, rfqId, bidId, approvedByUserId: session.userId, status: "approved" }),
      db.update(bids).set({ status: "selected" }).where(eq(bids.id, bidId)),
      db.update(bids).set({ status: "rejected" }).where(and(eq(bids.rfqId, rfqId), ne(bids.id, bidId))),
      db.update(rfqs).set({ status: "awarded" }).where(eq(rfqs.id, rfqId)),
    ])
    await recordAudit({ ...auditFor(session), action: "order.approved", target: orderId, metadata: { rfqId, bidId, amountCents: bid.amountCents } })
    return orderId
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("A supplier was already selected for this RFQ.", 409)
    throw error
  }
}

// --- Policy ---

async function loadPolicy(orgId: string): Promise<PolicyView> {
  const [row] = await getDb().select().from(policies).where(eq(policies.orgId, orgId))
  // Fail closed: without a policy nothing can be approved against limits nobody set.
  if (!row) throw new DomainError("This organization has no policy. Run db:setup.", 500)
  return {
    dailySpendLimit: row.dailySpendLimitCents / 100,
    perOrderLimit: row.perOrderLimitCents / 100,
    approvalThreshold: row.approvalThresholdCents / 100,
    requiredBidCount: row.requiredBidCount,
    approvedRegions: row.approvedRegions,
    requiredDocuments: row.requiredDocuments,
    approvedAssets: row.approvedAssets,
    approvedChains: row.approvedChains,
    agentKeyExpiryHours: row.agentKeyExpiryHours,
    freezeBehavior: row.freezeBehavior,
  }
}

export const getPolicy = loadPolicy

function stringList(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length > 50 || !value.every((entry) => typeof entry === "string" && entry.trim() && entry.length <= 100)) {
    throw new DomainError(`${label} must be a list of short names.`, 400)
  }
  return (value as string[]).map((entry) => entry.trim())
}

export async function updatePolicy(session: Session, input: unknown) {
  if (session.role !== "owner") throw new DomainError("Only an owner can change policy.", 403)
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const { dailySpendLimit, perOrderLimit, approvalThreshold, requiredBidCount, agentKeyExpiryHours, freezeBehavior } = value
  if (!isPositiveAmount(dailySpendLimit) || !isPositiveAmount(perOrderLimit) || !isPositiveAmount(approvalThreshold)) {
    throw new DomainError("Spend limits must be numbers greater than zero.", 400)
  }
  if (approvalThreshold > perOrderLimit || perOrderLimit > dailySpendLimit) {
    throw new DomainError("Limits must satisfy approval threshold ≤ per-order limit ≤ daily limit.", 400)
  }
  if (typeof requiredBidCount !== "number" || !Number.isInteger(requiredBidCount) || requiredBidCount < 1 || requiredBidCount > 20) {
    throw new DomainError("Required bid count must be a whole number from 1 to 20.", 400)
  }
  if (typeof agentKeyExpiryHours !== "number" || !Number.isInteger(agentKeyExpiryHours) || agentKeyExpiryHours < 1 || agentKeyExpiryHours > 8760) {
    throw new DomainError("Agent key expiration must be a whole number of hours.", 400)
  }
  if (typeof freezeBehavior !== "string" || !freezeBehavior.trim() || freezeBehavior.length > 200) {
    throw new DomainError("Freeze behavior is required.", 400)
  }
  const [row] = await getDb().update(policies).set({
    dailySpendLimitCents: Math.round(dailySpendLimit * 100),
    perOrderLimitCents: Math.round(perOrderLimit * 100),
    approvalThresholdCents: Math.round(approvalThreshold * 100),
    requiredBidCount,
    approvedRegions: stringList(value.approvedRegions, "Approved regions"),
    requiredDocuments: stringList(value.requiredDocuments, "Required documents"),
    approvedAssets: stringList(value.approvedAssets, "Approved assets"),
    approvedChains: stringList(value.approvedChains, "Approved chains"),
    agentKeyExpiryHours,
    freezeBehavior: freezeBehavior.trim(),
    updatedAt: Date.now(),
  }).where(eq(policies.orgId, session.orgId)).returning({ id: policies.id })
  if (!row) throw new DomainError("This organization has no policy. Run db:setup.", 500)
  await recordAudit({ ...auditFor(session), action: "policy.updated", target: row.id })
}
