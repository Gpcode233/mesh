/** Shared by client and server: the streamed chat protocol. No server imports. */
import type { ApprovalView } from "@/lib/rfq"

export type ToolName = "list_orders" | "get_order" | "get_policy" | "list_suppliers" | "propose_rfq" | "search_web" | "propose_supplier"

export const TOOL_LABEL: Record<ToolName, string> = {
  list_orders: "Read RFQs and orders",
  get_order: "Read order detail",
  get_policy: "Read spending policy",
  list_suppliers: "Read supplier network",
  propose_rfq: "Draft RFQ for approval",
  search_web: "Search the web",
  propose_supplier: "Propose supplier for approval",
}

export type ToolStep = {
  id: string
  tool: ToolName
  status: "running" | "done" | "error"
  /** Short, content-free summary such as "3 orders" or an error reason. */
  detail?: string
}

export type ChatReply = {
  agent: string
  content: string
  approval: ApprovalView | null
  steps: ToolStep[]
}

/** One JSON object per line when the client sends `Accept: application/x-ndjson`. */
export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "step"; step: ToolStep }
  | ({ type: "done" } & ChatReply)
  | { type: "error"; error: string; status: number }

export const NDJSON = "application/x-ndjson"

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value in TOOL_LABEL
}
