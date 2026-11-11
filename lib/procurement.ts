import { and, asc, desc, eq, gte, inArray, ne, or, sql, sum } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import type { Session } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { approvals, auditEvents, bids, orders, policies, rfqs, settlements, suppliers, users } from "@/lib/db/schema"
import {
  isPositiveAmount,
  listIncludes,
  missingDocuments,
  parseRfqDraft,
  regionAllowed,
  SETTLEMENT_ROUTE,
  usd,
  type ApprovalStatus,
  type ApprovalView,
  type BidView,
  type OrderDetailView,
  type OrderEventView,
  type OrderRow,
  type PolicyView,
  type RfqDraft,
  type SettlementSummary,
  type SupplierCandidate,
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
      supplierId: suppliers.id,
      supplier: suppliers.name,
      region: suppliers.region,
      nearAccountId: suppliers.nearAccountId,
      amountCents: bids.amountCents,
      leadTimeDays: bids.leadTimeDays,
      status: bids.status,
      documents: suppliers.documents,
    })
    .from(bids)
    .innerJoin(suppliers, eq(suppliers.id, bids.supplierId))
    .where(eq(bids.rfqId, id))
    .orderBy(bids.amountCents)
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.rfqId, id))
  const policy = await loadPolicy(orgId)
  const selected = bidRows.find((bid) => bid.status === "selected")
  let escrow: Awaited<ReturnType<typeof import("./settlement").getEscrowViewForOrder>> = null
  try {
    const mod = await import("./settlement")
    escrow = await mod.getEscrowViewForOrder(orgId, id)
  } catch (error) {
    console.error("Escrow view failed", error)
    escrow = null
  }
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
    supplier: selected?.supplier ?? null,
    bids: bidRows,
    requiredBidCount: policy.requiredBidCount,
    approvedRegions: policy.approvedRegions,
    requiredDocuments: policy.requiredDocuments,
    frozen: policy.frozenAt !== null,
    orderStatus: order?.status ?? null,
    awardedCents: selected?.amountCents ?? null,
    createdAt: row.createdAt,
    events: await orderEvents(orgId, id, bidRows),
    escrow,
  }
}

/**
 * The RFQ's history, read from the audit log: its creation (and the agent draft behind it), each bid,
 * each refused selection and the award. Labels are derived here; audit metadata holds no message text.
 */
async function orderEvents(orgId: string, rfqId: string, bidRows: BidView[]): Promise<OrderEventView[]> {
  const db = getDb()
  const select = { id: auditEvents.id, action: auditEvents.action, target: auditEvents.target, metadata: auditEvents.metadata, createdAt: auditEvents.createdAt, actor: users.name }
  const rows = await db.select(select).from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(and(eq(auditEvents.orgId, orgId), or(eq(auditEvents.target, rfqId), sql`json_extract(${auditEvents.metadata}, '$.rfqId') = ${rfqId}`)))
    .orderBy(asc(auditEvents.id))
  const approvalId = rows.find((row) => row.action === "rfq.created")?.metadata?.approvalId
  const drafted = typeof approvalId === "string"
    ? await db.select(select).from(auditEvents).leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.target, approvalId), eq(auditEvents.action, "approval.requested")))
    : []

  const bidLabel = (bidId: unknown) => {
    const bid = bidRows.find((entry) => entry.id === bidId)
    return bid ? `${bid.supplier} · ${usd(bid.amountCents)}` : null
  }
  const describe = (row: (typeof rows)[number]): Pick<OrderEventView, "label" | "detail"> => {
    const meta = row.metadata ?? {}
    switch (row.action) {
      case "approval.requested": return { label: "Head Agent drafted this RFQ", detail: "Sent for human approval" }
      case "rfq.created": return { label: "RFQ created", detail: meta.source === "approval" ? "Approved from the agent's draft" : "Entered with the purchase order form" }
      case "bid.recorded": return { label: "Bid recorded", detail: bidLabel(row.target) }
      case "order.blocked": return { label: "Selection refused by policy", detail: typeof meta.reason === "string" ? meta.reason : null }
      case "order.approved": return { label: "Supplier selected, order created", detail: bidLabel(meta.bidId) }
      case "order.funded": return { label: "Escrow funded on-chain", detail: typeof meta.txHash === "string" ? `Tx ${meta.txHash.slice(0, 10)}…` : null }
      case "milestone.released": return { label: "Milestone paid on-chain", detail: typeof meta.txHash === "string" ? `Tx ${meta.txHash.slice(0, 10)}…` : `Milestone ${(meta.position as number) + 1}` }
      case "milestone.release_failed": return { label: "Milestone release failed", detail: typeof meta.error === "string" ? meta.error : null }
      case "supplier.near_account_set": return { label: "Supplier NEAR account set", detail: typeof meta.nearAccountId === "string" ? meta.nearAccountId : null }
      default: return { label: row.action, detail: null }
    }
  }
  return [...drafted, ...rows].map((row) => ({ id: row.id, action: row.action, actor: row.actor, at: row.createdAt, ...describe(row) }))
}

function utcMidnight() {
  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  return midnight.getTime()
}

/** Cents committed by non-cancelled orders created since UTC midnight: what the daily limit counts. */
async function committedTodayCents(orgId: string) {
  const [{ spent }] = await getDb()
    .select({ spent: sum(bids.amountCents) })
    .from(orders)
    .innerJoin(bids, eq(bids.id, orders.bidId))
    .where(and(eq(orders.orgId, orgId), gte(orders.createdAt, utcMidnight()), ne(orders.status, "cancelled")))
  return Number(spent ?? 0)
}

export async function getSettlementSummary(orgId: string): Promise<SettlementSummary> {
  const db = getDb()
  const [policy, committed, awarded, confirmed] = await Promise.all([
    loadPolicy(orgId),
    committedTodayCents(orgId),
    db.select({ rfqId: rfqs.id, resource: rfqs.resource, supplier: suppliers.name, amountCents: bids.amountCents, approvedAt: orders.createdAt, orderId: orders.id })
      .from(orders)
      .innerJoin(rfqs, eq(rfqs.id, orders.rfqId))
      .innerJoin(bids, eq(bids.id, orders.bidId))
      .innerJoin(suppliers, eq(suppliers.id, bids.supplierId))
      .where(and(eq(orders.orgId, orgId), ne(orders.status, "cancelled")))
      .orderBy(desc(orders.createdAt)),
    db.select({ orderId: settlements.orderId, kind: settlements.kind, amountYocto: settlements.amountYocto })
      .from(settlements)
      .where(and(eq(settlements.orgId, orgId), eq(settlements.status, "confirmed"))),
  ])
  const payouts = confirmed.filter((row) => row.kind === "milestone_payout")
  const funded = confirmed.filter((row) => row.kind === "escrow_funding")
  const yocto = (rows: typeof confirmed) => rows.reduce((total, row) => total + BigInt(row.amountYocto ?? "0"), BigInt(0)).toString()
  const settled = new Set(funded.map((row) => row.orderId))
  return {
    committedTodayCents: committed,
    dailyLimitCents: policy.dailySpendLimit * 100,
    awardedCents: awarded.reduce((total, row) => total + row.amountCents, 0),
    awardedCount: awarded.length,
    paidYocto: yocto(payouts),
    paidCount: payouts.length,
    escrowedYocto: yocto(funded),
    escrowedCount: funded.length,
    awaiting: awarded.filter((row) => !settled.has(row.orderId)).map((row) => ({ rfqId: row.rfqId, resource: row.resource, supplier: row.supplier, amountCents: row.amountCents, approvedAt: row.approvedAt })),
  }
}

export async function listSuppliers(orgId: string): Promise<SupplierView[]> {
  return getDb()
    .select({
      id: suppliers.id,
      name: suppliers.name,
      region: suppliers.region,
      nearAccountId: suppliers.nearAccountId,
      sourceUrl: suppliers.sourceUrl,
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

function toApprovalView(row: { id: string; kind: "create_rfq" | "add_supplier"; status: ApprovalStatus; payload: unknown; resultId: string | null }): ApprovalView {
  const base = { id: row.id, status: row.status, resultId: row.resultId }
  return row.kind === "add_supplier"
    ? { ...base, kind: "add_supplier", supplier: row.payload as SupplierCandidate }
    : { ...base, kind: "create_rfq", draft: row.payload as RfqDraft }
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
  if ((await loadPolicy(session.orgId)).frozenAt !== null) throw new DomainError(FROZEN, 423)
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

/**
 * Scout's only write: store a supplier it found on the web for a human to decide on.
 * It deliberately writes no supplier, so model output cannot add one.
 */
export async function proposeSupplier(session: Session, agent: string, candidate: SupplierCandidate) {
  const db = getDb()
  const [existing] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.orgId, session.orgId), sql`lower(${suppliers.name}) = lower(${candidate.name})`))
  if (existing) throw new DomainError(`${candidate.name} is already in the supplier network.`, 409)
  const [row] = await db.insert(approvals).values({
    orgId: session.orgId,
    kind: "add_supplier",
    requestedByAgent: agent,
    requestedByUserId: session.userId,
    payload: candidate,
  }).returning()
  await recordAudit({ ...auditFor(session), action: "approval.requested", target: row.id, metadata: { kind: "add_supplier", agent } })
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

  if (approval.kind === "add_supplier") {
    const candidate = approval.payload as SupplierCandidate
    const supplierId = crypto.randomUUID()
    let updated
    try {
      // Same pattern as RFQs: the insert happens only while the approval is still pending, in one batch.
      ;[, updated] = await db.batch([
        db.run(sql`
          INSERT INTO suppliers (id, org_id, name, region, source_url, verification_status, documents, created_at)
          SELECT ${supplierId}, ${session.orgId}, ${candidate.name}, ${candidate.region}, ${candidate.sourceUrl}, 'unverified', '[]', ${Date.now()}
          WHERE EXISTS (SELECT 1 FROM approvals WHERE id = ${id} AND status = 'pending')
        `),
        db.update(approvals).set({ ...decided, status: "approved", resultId: supplierId }).where(stillPending).returning(),
      ])
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError(`${candidate.name} is already in the supplier network. Reject this card.`, 409)
      throw error
    }
    const [row] = updated
    if (!row) throw new DomainError("This request was already decided.", 409)
    await recordAudit({ ...auditFor(session), action: "supplier.added", target: supplierId, metadata: { source: "discovery", approvalId: id, agent: approval.requestedByAgent } })
    return toApprovalView(row)
  }

  // Re-validate at decision time: the deadline may have passed since the draft was made.
  const parsed = parseRfqDraft(approval.payload)
  if (!parsed.ok) throw new DomainError(`This draft can no longer be approved: ${parsed.error}`, 422)
  if ((await loadPolicy(session.orgId)).frozenAt !== null) throw new DomainError(FROZEN, 423)

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
        AND ${notFrozen(session.orgId)}
    `),
    db.update(approvals).set({ ...decided, status: "approved", resultId: rfqId }).where(and(stillPending, notFrozen(session.orgId))).returning(),
  ])
  const [row] = updated
  if (!row) {
    // A freeze that landed between the check and the batch leaves the approval pending.
    if ((await loadPolicy(session.orgId)).frozenAt !== null) throw new DomainError(FROZEN, 423)
    throw new DomainError("This request was already decided.", 409)
  }
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
  const documents = value.documents === undefined || value.documents === null ? [] : stringList(value.documents, "Documents")

  const db = getDb()
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.orgId, session.orgId), eq(rfqs.id, rfqId)))
  if (!rfq) throw new DomainError("RFQ not found.", 404)
  if (rfq.status === "awarded" || rfq.status === "cancelled") throw new DomainError(`This RFQ is ${rfq.status} and no longer accepts bids.`, 409)

  await db.insert(suppliers).values({ orgId: session.orgId, name: supplierName, region }).onConflictDoNothing()
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.orgId, session.orgId), eq(suppliers.name, supplierName)))
  // Fill in what the supplier record lacks; never overwrite a recorded region or drop a document.
  const added: string[] = []
  for (const document of documents) if (!listIncludes([...supplier.documents, ...added], document)) added.push(document)
  if (added.length || (region && !supplier.region)) {
    await db.update(suppliers).set({ documents: [...supplier.documents, ...added], region: supplier.region ?? region }).where(eq(suppliers.id, supplier.id))
  }

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
    await recordAudit({ ...auditFor(session), action: "bid.recorded", target: bidId, metadata: { rfqId, source: "operator", ...(added.length ? { documentsMarkedOnFile: added } : {}) } })
    return bidId
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError(`${supplierName} already has a bid on this RFQ.`, 409)
    throw error
  }
}

const FROZEN = "Procurement is frozen. An owner must unfreeze it first."

/** SQL condition: the organization's procurement is not frozen. */
const notFrozen = (orgId: string) => sql`NOT EXISTS (SELECT 1 FROM policies WHERE org_id = ${orgId} AND frozen_at IS NOT NULL)`

type Refusal = { reason: string; status: number }

/** Every policy rule for a selection, in the order they are reported. Null means the selection is allowed. */
function policyRefusal(input: {
  policy: PolicyView
  role: string
  budgetCents: number
  bidCount: number
  amountCents: number
  supplier: { name: string; region: string | null; documents: string[] }
  committedCents: number
}): Refusal | null {
  const { policy, amountCents, supplier } = input
  const list = (values: string[]) => values.join(", ") || "none"
  if (policy.frozenAt !== null) return { reason: FROZEN, status: 423 }
  if (input.bidCount < policy.requiredBidCount) return { reason: `Policy requires ${policy.requiredBidCount} bids; this RFQ has ${input.bidCount}.`, status: 422 }
  if (amountCents > input.budgetCents) return { reason: `This bid (${usd(amountCents)}) is over the RFQ budget (${usd(input.budgetCents)}).`, status: 422 }
  if (!regionAllowed(policy.approvedRegions, supplier.region)) {
    return {
      reason: supplier.region
        ? `${supplier.name} is in ${supplier.region}, which is not an approved region (${list(policy.approvedRegions)}).`
        : `${supplier.name} has no region on record; policy allows only ${list(policy.approvedRegions)}.`,
      status: 422,
    }
  }
  const missing = missingDocuments(policy.requiredDocuments, supplier.documents)
  if (missing.length) return { reason: `${supplier.name} is missing required documents: ${missing.join(", ")}.`, status: 422 }
  if (!listIncludes(policy.approvedAssets, SETTLEMENT_ROUTE.asset) || !listIncludes(policy.approvedChains, SETTLEMENT_ROUTE.chain)) {
    return {
      reason: `Mesh settles in ${SETTLEMENT_ROUTE.asset} on ${SETTLEMENT_ROUTE.chain}, which policy does not approve (assets: ${list(policy.approvedAssets)}; chains: ${list(policy.approvedChains)}).`,
      status: 422,
    }
  }
  if (amountCents > policy.perOrderLimit * 100) return { reason: `This bid (${usd(amountCents)}) is over the per-order limit (${usd(policy.perOrderLimit * 100)}).`, status: 422 }
  if (amountCents > policy.approvalThreshold * 100 && input.role !== "owner") {
    return { reason: `Bids over ${usd(policy.approvalThreshold * 100)} need an owner to approve.`, status: 403 }
  }
  if (input.committedCents + amountCents > policy.dailySpendLimit * 100) {
    return { reason: `This would commit ${usd(input.committedCents + amountCents)} today, over the daily limit (${usd(policy.dailySpendLimit * 100)}).`, status: 422 }
  }
  return null
}

/**
 * Selecting a supplier is the human approval step. Policy is enforced here, not in the UI.
 * The freeze, spend limits and daily total are checked again inside the insert itself, so concurrent
 * selections or a concurrent freeze or policy change cannot push an order past them.
 */
export async function selectBid(session: Session, rfqId: string, bidId: string) {
  const db = getDb()
  const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.orgId, session.orgId), eq(rfqs.id, rfqId)))
  if (!rfq) throw new DomainError("RFQ not found.", 404)
  if (rfq.status === "awarded") throw new DomainError("A supplier was already selected for this RFQ.", 409)
  if (rfq.status === "cancelled") throw new DomainError("This RFQ was cancelled.", 409)
  const rfqBids = await db.select().from(bids).where(and(eq(bids.orgId, session.orgId), eq(bids.rfqId, rfqId)))
  const bid = rfqBids.find((entry) => entry.id === bidId)
  if (!bid) throw new DomainError("Bid not found on this RFQ.", 404)
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, bid.supplierId))

  const check = async () => policyRefusal({
    policy: await loadPolicy(session.orgId),
    role: session.role,
    budgetCents: rfq.maxBudgetCents,
    bidCount: rfqBids.length,
    amountCents: bid.amountCents,
    supplier,
    committedCents: await committedTodayCents(session.orgId),
  })
  const refuse = async ({ reason, status }: Refusal): Promise<never> => {
    await recordAudit({ ...auditFor(session), action: "order.blocked", target: rfqId, metadata: { bidId, reason } })
    throw new DomainError(reason, status)
  }
  const refusal = await check()
  if (refusal) await refuse(refusal)

  try {
    const orderId = crypto.randomUUID()
    const created = sql`EXISTS (SELECT 1 FROM orders WHERE id = ${orderId})`
    // One transaction. The insert happens only if the limits still hold at write time, counting every order
    // committed today; the updates happen only if the insert did. The unique index on orders.rfq_id
    // rolls everything back if another selection for this RFQ won.
    const [, , , awarded] = await db.batch([
      db.run(sql`
        INSERT INTO orders (id, org_id, rfq_id, bid_id, approved_by_user_id, status, created_at)
        SELECT ${orderId}, ${session.orgId}, ${rfqId}, ${bidId}, ${session.userId}, 'approved', ${Date.now()}
        FROM policies p
        WHERE p.org_id = ${session.orgId}
          AND p.frozen_at IS NULL
          AND ${bid.amountCents} <= p.per_order_limit_cents
          AND (${session.role} = 'owner' OR ${bid.amountCents} <= p.approval_threshold_cents)
          AND ${bid.amountCents} + (
            SELECT coalesce(sum(b.amount_cents), 0) FROM orders o JOIN bids b ON b.id = o.bid_id
            WHERE o.org_id = ${session.orgId} AND o.created_at >= ${utcMidnight()} AND o.status != 'cancelled'
          ) <= p.daily_spend_limit_cents
      `),
      db.update(bids).set({ status: "selected" }).where(and(eq(bids.id, bidId), created)),
      db.update(bids).set({ status: "rejected" }).where(and(eq(bids.rfqId, rfqId), ne(bids.id, bidId), created)),
      db.update(rfqs).set({ status: "awarded" }).where(and(eq(rfqs.id, rfqId), created)).returning({ id: rfqs.id }),
    ])
    if (awarded.length === 0) {
      // Something changed between the check and the write: report the rule that now refuses it.
      await refuse((await check()) ?? { reason: "Policy changed during selection; nothing was created. Try again.", status: 409 })
    }
    await recordAudit({ ...auditFor(session), action: "order.approved", target: orderId, metadata: { rfqId, bidId, amountCents: bid.amountCents } })
    return orderId
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError("A supplier was already selected for this RFQ.", 409)
    throw error
  }
}

// --- Freeze ---

/**
 * Freezing blocks supplier selection, draft approval and agent drafts until an owner unfreezes.
 * Owners and operators can freeze; only owners can unfreeze. It does not touch any on-chain key yet.
 */
export async function setFrozen(session: Session, frozen: boolean) {
  if (!frozen && session.role !== "owner") throw new DomainError("Only an owner can unfreeze procurement.", 403)
  const [row] = await getDb()
    .update(policies)
    .set(frozen ? { frozenAt: Date.now(), frozenByUserId: session.userId } : { frozenAt: null, frozenByUserId: null })
    .where(and(eq(policies.orgId, session.orgId), frozen ? sql`${policies.frozenAt} IS NULL` : sql`${policies.frozenAt} IS NOT NULL`))
    .returning({ id: policies.id })
  // Already in the requested state: nothing changed, so nothing to audit.
  if (row) await recordAudit({ ...auditFor(session), action: frozen ? "procurement.frozen" : "procurement.unfrozen", target: row.id })
  return (await loadPolicy(session.orgId)).frozenAt
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
    frozenAt: row.frozenAt,
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
