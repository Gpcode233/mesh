/** Shared by client and server: validation, display helpers and view types. No server imports. */

export type RfqDraft = {
  resource: string
  quantity: number
  unit: string
  /** Whole USD amount as entered; stored as cents once approved. */
  maxBudget: number
  /** YYYY-MM-DD */
  deadline: string
  destination: string
}

export type ApprovalStatus = "pending" | "approved" | "rejected"

/** A supplier Scout found on the web and proposed. Nothing is saved unless the operator approves it. */
export type SupplierCandidate = {
  name: string
  region: string | null
  /** A page returned by web search in the same turn, where the operator can check the supplier. */
  sourceUrl: string
  /** That page's title, as the search returned it. */
  sourceTitle: string
  /** Why Scout suggests this supplier. */
  reason: string
}

type ApprovalBase = {
  id: string
  status: ApprovalStatus
  /** The record created on approval: an RFQ id or a supplier id. */
  resultId: string | null
}

export type ApprovalView =
  | (ApprovalBase & { kind: "create_rfq"; draft: RfqDraft })
  | (ApprovalBase & { kind: "add_supplier"; supplier: SupplierCandidate })

export type RfqStatus = "draft" | "sourcing" | "bidding" | "awarded" | "cancelled"

export type OrderRow = {
  id: string
  resource: string
  quantity: number
  unit: string
  maxBudgetCents: number
  deadline: string
  destination: string
  status: RfqStatus
  bidCount: number
  supplier: string | null
}

export type BidView = {
  id: string
  supplierId: string
  supplier: string
  region: string | null
  nearAccountId: string | null
  amountCents: number
  leadTimeDays: number | null
  status: "submitted" | "selected" | "rejected"
  /** The supplier's documents marked as on file by an operator. */
  documents: string[]
}

/** One audit event about an RFQ, for its timeline. `detail` never holds message content. */
export type OrderEventView = {
  id: number
  action: string
  label: string
  detail: string | null
  actor: string | null
  at: number
}

export type SettlementStatus = "pending" | "submitted" | "confirmed" | "failed"

/** One escrow transaction's state. `txHash` is set only once the chain confirmed it at FINAL. */
export type ChainTxView = { status: SettlementStatus; txHash: string | null; submittedTxHash: string | null; error: string | null }

export type EscrowMilestoneView = {
  id: string
  position: number
  title: string
  amountYocto: string
  amountCents: number
  status: "pending" | "evidence_submitted" | "verified" | "paid"
  /** The contract's own status for this milestone, read live; null if the order is not on-chain. */
  onChainStatus: "Pending" | "Releasing" | "Released" | "Refunded" | null
  payout: ChainTxView | null
  evidenceUri: string | null
}

/** The order's escrow on NEAR, from Mesh's records of chain-confirmed transactions. */
export type EscrowView = {
  network: string
  contractId: string
  explorerUrl: string
  supplierId: string
  supplierAccountId: string | null
  /** True if get_order returned this order just now. */
  onChain: boolean
  /** Set when the contract could not be read; the view then shows Mesh's records only. */
  chainError: string | null
  /** Pending until the owner's fund_order transaction is verified on-chain. */
  funding: (ChainTxView & { amountYocto: string | null }) | null
  milestones: EscrowMilestoneView[]
}

export type OrderDetailView = OrderRow & {
  bids: BidView[]
  requiredBidCount: number
  approvedRegions: string[]
  requiredDocuments: string[]
  frozen: boolean
  orderStatus: string | null
  /** The selected bid's amount, once a supplier is selected. */
  awardedCents: number | null
  createdAt: number
  events: OrderEventView[]
  /** Null when no escrow contract is configured on the server. */
  escrow: EscrowView | null
}

export type AwaitingSettlement = {
  rfqId: string
  resource: string
  supplier: string
  amountCents: number
  approvedAt: number
}

/** Real totals from the database. Settled amounts come only from chain-confirmed settlement records. */
export type SettlementSummary = {
  committedTodayCents: number
  dailyLimitCents: number
  awardedCents: number
  awardedCount: number
  /** yoctoNEAR paid to suppliers by chain-confirmed milestone payouts. */
  paidYocto: string
  paidCount: number
  /** yoctoNEAR the owner put into escrow, from chain-verified funding transactions. */
  escrowedYocto: string
  escrowedCount: number
  awaiting: AwaitingSettlement[]
}

export type SupplierView = {
  id: string
  name: string
  region: string | null
  nearAccountId: string | null
  sourceUrl: string | null
  verificationStatus: "unverified" | "verified" | "rejected"
  bidCount: number
}

export type PolicyView = {
  dailySpendLimit: number
  perOrderLimit: number
  approvalThreshold: number
  requiredBidCount: number
  approvedRegions: string[]
  requiredDocuments: string[]
  approvedAssets: string[]
  approvedChains: string[]
  agentKeyExpiryHours: number
  freezeBehavior: string
  /** When procurement was frozen, or null. */
  frozenAt: number | null
}

/**
 * The only settlement route Mesh has: the testnet escrow holds and pays out native NEAR.
 * A supplier can be selected only if policy approves this asset and chain.
 */
export const SETTLEMENT_ROUTE = { asset: "NEAR", chain: "NEAR" } as const

/** Case-insensitive membership, so "eu" matches "EU". */
export const listIncludes = (list: string[], value: string) => list.some((entry) => entry.trim().toLowerCase() === value.trim().toLowerCase())

/** An empty approved-region list allows any region; otherwise the supplier's region must be known and listed. */
export const regionAllowed = (approved: string[], region: string | null) => approved.length === 0 || (region !== null && listIncludes(approved, region))

export const missingDocuments = (required: string[], onFile: string[]) => required.filter((document) => !listIncludes(onFile, document))

export const rfqRef = (id: string) => `RFQ-${id.slice(0, 8).toUpperCase()}`

export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)

export const STATUS_LABEL: Record<RfqStatus, string> = {
  draft: "Draft",
  sourcing: "Sourcing",
  bidding: "Bidding",
  awarded: "Awarded",
  cancelled: "Cancelled",
}

export const todayUtc = () => new Date().toISOString().slice(0, 10)

const MAX_AMOUNT = 1_000_000_000

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null
}

export function isPositiveAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT
}

export function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * The one RFQ validator, used for operator forms and for model tool arguments.
 * Model output is untrusted: nothing is defaulted, so missing fields are reported rather than guessed.
 */
export function parseRfqDraft(input: unknown): { ok: true; draft: RfqDraft } | { ok: false; error: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const resource = text(value.resource, 200)
  if (!resource) return { ok: false, error: "A resource is required." }
  if (!isPositiveAmount(value.quantity)) return { ok: false, error: "Quantity must be a number greater than zero." }
  const unit = text(value.unit, 32)
  if (!unit) return { ok: false, error: "A unit is required." }
  if (!isPositiveAmount(value.maxBudget)) return { ok: false, error: "Max budget must be a number greater than zero." }
  if (typeof value.deadline !== "string" || !isValidDate(value.deadline)) return { ok: false, error: "Deadline must be a date in YYYY-MM-DD format." }
  if (value.deadline < todayUtc()) return { ok: false, error: "Deadline cannot be in the past." }
  const destination = text(value.destination, 200)
  if (!destination) return { ok: false, error: "A destination is required." }
  return { ok: true, draft: { resource, quantity: value.quantity, unit, maxBudget: value.maxBudget, deadline: value.deadline, destination } }
}

/** http(s) URLs only, so a stored link can never be javascript: or data:. */
export function isWebUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

/** Validates a supplier proposal from the model. The source title is filled in by the server, not the model. */
export function parseSupplierCandidate(input: unknown): { ok: true; candidate: Omit<SupplierCandidate, "sourceTitle"> } | { ok: false; error: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "")
  const name = text("name")
  if (!name || name.length > 200) return { ok: false, error: "A supplier name of at most 200 characters is required." }
  const region = text("region")
  if (region.length > 100) return { ok: false, error: "Region must be at most 100 characters." }
  const sourceUrl = text("sourceUrl")
  if (!sourceUrl || sourceUrl.length > 500 || !isWebUrl(sourceUrl)) return { ok: false, error: "A source URL from a search result is required." }
  const reason = text("reason")
  if (!reason || reason.length > 300) return { ok: false, error: "A short reason (at most 300 characters) is required." }
  return { ok: true, candidate: { name, region: region || null, sourceUrl, reason } }
}
