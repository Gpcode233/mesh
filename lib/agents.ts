export const AGENT_IDS = ["head", "scout", "compliance", "negotiator", "settlement", "guard"] as const

export type AgentId = (typeof AGENT_IDS)[number]

export type AgentProfile = {
  id: AgentId
  label: string
  detail: string
  instruction: string
  starters: string[]
}

export const AGENTS: Record<AgentId, AgentProfile> = {
  head: {
    id: "head",
    label: "Head agent",
    detail: "Orchestration",
    instruction:
      "You are Mesh Head Agent. Orchestrate procurement work, summarize what specialized agents should do, and ask for approval before irreversible actions.",
    starters: ["Review open RFQs", "What needs my approval?", "Plan a lithium sourcing run"],
  },
  scout: {
    id: "scout",
    label: "Scout",
    detail: "Supplier discovery",
    instruction:
      "You are Mesh Scout Agent. Focus on supplier discovery, sourcing constraints, lead times, regions, and comparable bids. Never claim to have searched a live network unless evidence is provided.",
    starters: ["What should I look for in a supplier?", "Draft sourcing criteria for copper wire"],
  },
  compliance: {
    id: "compliance",
    label: "Compliance",
    detail: "Risk & evidence",
    instruction:
      "You are Mesh Compliance Agent. Focus on supplier verification, certifications, sanctions risk, delivery evidence, and missing documentation. Identify uncertainty explicitly.",
    starters: ["Which documents should a chemical supplier provide?", "List sanctions-screening steps"],
  },
  negotiator: {
    id: "negotiator",
    label: "Negotiator",
    detail: "Quotes & terms",
    instruction:
      "You are Mesh Negotiator Agent. Focus on quote comparison, commercial terms, counteroffers, savings, and negotiation strategy. Never commit a purchase.",
    starters: ["How should I counter a quote 8% over budget?", "Suggest milestone payment terms"],
  },
  settlement: {
    id: "settlement",
    label: "Settlement",
    detail: "NEAR Intents",
    instruction:
      "You are Mesh Settlement Agent. Focus on NEAR Intents, supported assets, route status, fees, confirmations, and payout readiness. Never claim a transaction settled without a verified hash.",
    starters: ["Explain how a stablecoin payout is routed", "What confirms a settlement?"],
  },
  guard: {
    id: "guard",
    label: "Guard",
    detail: "Policy & safety",
    instruction:
      "You are Mesh Guard Agent. Focus on mandate scope, spend velocity, policy violations, anomaly detection, key revocation, and human approval gates.",
    starters: ["Which actions require human approval?", "When should keys be revoked?"],
  },
}

export const AGENT_LIST: AgentProfile[] = AGENT_IDS.map((id) => AGENTS[id])

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === "string" && (AGENT_IDS as readonly string[]).includes(value)
}
