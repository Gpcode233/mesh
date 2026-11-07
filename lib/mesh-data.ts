import type { AgentEvent } from "@/lib/agent-engine"
import type { AgentId } from "@/lib/agents"

/**
 * SIMULATED seed data. Nothing here comes from a live network, database or chain.
 */

export const starterEvents: AgentEvent[] = [
  { id: "seed-1", timestamp: Date.now() - 180000, level: "success", message: "Intent settled on destination chain (simulated)", metadata: "simulated" },
  { id: "seed-2", timestamp: Date.now() - 420000, level: "info", message: "Scout found 3 matching suppliers (simulated)", metadata: "simulated" },
  { id: "seed-3", timestamp: Date.now() - 800000, level: "info", message: "TEE attestation verified (simulated)", metadata: "quote-engine-v2" },
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
  { id: "head", online: true, mandate: "Orchestrate RFQs, request approvals", methods: ["create_rfq", "request_approval"], cap: 0, spend: 0, expires: "7d", lastAction: "Summarised bids" },
  { id: "scout", online: true, mandate: "Discover and shortlist suppliers", methods: ["search_suppliers", "submit_bid_request"], cap: 0, spend: 0, expires: "7d", lastAction: "Shortlisted 3 suppliers" },
  { id: "compliance", online: true, mandate: "Verify supplier documents", methods: ["verify_document", "flag_risk"], cap: 0, spend: 0, expires: "7d", lastAction: "Flagged 1 missing certificate" },
  { id: "negotiator", online: true, mandate: "Counter quotes within budget", methods: ["counter_offer", "select_supplier"], cap: 10000, spend: 0, expires: "3d", lastAction: "Countered Helio at -6%" },
  { id: "settlement", online: false, mandate: "Route stablecoin payouts", methods: ["submit_intent", "release_payout"], cap: 50000, spend: 6980, expires: "24h", lastAction: "Simulated payout" },
  { id: "guard", online: true, mandate: "Monitor velocity, revoke keys", methods: ["freeze", "revoke_key"], cap: 0, spend: 0, expires: "24h", lastAction: "Velocity check nominal" },
]
