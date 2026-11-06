import type { AgentEvent, RfqRequirement } from "@/lib/agent-engine"
import type { AgentId } from "@/lib/agents"

/**
 * SIMULATED seed data. Nothing here comes from a live network, database or chain.
 */

export type OrderStatus = "Sourcing" | "Bidding" | "Settled"

export type PipelineItem = RfqRequirement & {
  id: string
  status: OrderStatus
  supplier: string
  spend: number
}

export const initialPipeline: PipelineItem[] = [
  { id: "RFQ-1042", resource: "Lithium carbonate", quantity: 240, unit: "kg", maxBudget: 18400, deadline: "Nov 08", destination: "Rotterdam hub", status: "Bidding", supplier: "3 active bids", spend: 0 },
  { id: "RFQ-1041", resource: "Solar micro-inverters", quantity: 80, unit: "units", maxBudget: 9600, deadline: "Nov 12", destination: "Austin hub", status: "Sourcing", supplier: "Awaiting agents", spend: 0 },
  { id: "RFQ-1039", resource: "Recycled copper wire", quantity: 1200, unit: "m", maxBudget: 7200, deadline: "Nov 06", destination: "Osaka hub", status: "Settled", supplier: "Mori Metals", spend: 6980 },
]

export const starterEvents: AgentEvent[] = [
  { id: "seed-1", timestamp: Date.now() - 180000, level: "success", message: "Intent settled on destination chain (simulated)", metadata: "simulated" },
  { id: "seed-2", timestamp: Date.now() - 420000, level: "info", message: "Scout found 3 matching suppliers (simulated)", metadata: "RFQ-1042" },
  { id: "seed-3", timestamp: Date.now() - 800000, level: "info", message: "TEE attestation verified (simulated)", metadata: "quote-engine-v2" },
]

export const TIMELINE_STEPS = [
  "RFQ created",
  "Suppliers discovered",
  "Bids received",
  "Supplier selected",
  "Mandate approved",
  "Intent submitted",
  "Payment routed",
  "Evidence verified",
  "Milestone paid",
  "Order completed",
] as const

/** How many timeline steps are complete for an order status (simulated progress). */
export function completedSteps(status: OrderStatus) {
  if (status === "Sourcing") return 1
  if (status === "Bidding") return 3
  return TIMELINE_STEPS.length
}

export const suppliers = [
  { name: "Mori Metals", region: "Japan", score: "98.4%", metric: "On-time delivery", docs: "ISO 9001, REACH" },
  { name: "Helio Components", region: "Germany", score: "96.1%", metric: "Quote accuracy", docs: "ISO 9001, CE" },
  { name: "Nordic Materials", region: "Norway", score: "94.8%", metric: "Quality pass rate", docs: "ISO 14001" },
  { name: "Aster Logistics", region: "Netherlands", score: "92.7%", metric: "Response rate", docs: "AEO certified" },
]

export type RegistryAgent = {
  id: AgentId
  online: boolean
  mandate: string
  methods: string[]
  cap: number
  spend: number
  expires: string
  lastAction: string
}

export const registrySeed: RegistryAgent[] = [
  { id: "head", online: true, mandate: "Orchestrate RFQs, request approvals", methods: ["create_rfq", "request_approval"], cap: 0, spend: 0, expires: "7d", lastAction: "Summarised RFQ-1042 bids" },
  { id: "scout", online: true, mandate: "Discover and shortlist suppliers", methods: ["search_suppliers", "submit_bid_request"], cap: 0, spend: 0, expires: "7d", lastAction: "Shortlisted 3 suppliers" },
  { id: "compliance", online: true, mandate: "Verify supplier documents", methods: ["verify_document", "flag_risk"], cap: 0, spend: 0, expires: "7d", lastAction: "Flagged 1 missing certificate" },
  { id: "negotiator", online: true, mandate: "Counter quotes within budget", methods: ["counter_offer", "select_supplier"], cap: 10000, spend: 0, expires: "3d", lastAction: "Countered Helio at -6%" },
  { id: "settlement", online: false, mandate: "Route stablecoin payouts", methods: ["submit_intent", "release_payout"], cap: 50000, spend: 6980, expires: "24h", lastAction: "Payout for RFQ-1039" },
  { id: "guard", online: true, mandate: "Monitor velocity, revoke keys", methods: ["freeze", "revoke_key"], cap: 0, spend: 0, expires: "24h", lastAction: "Velocity check nominal" },
]
