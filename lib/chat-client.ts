import type { AgentId } from "@/lib/agents"
import type { ApprovalView } from "@/lib/rfq"

export type ChatChannel = "direct" | "group"

/** Calls the server chat route, which owns history. Throws with the explicit error on failure. */
export async function requestAgentReply(input: {
  agent: AgentId
  channel: ChatChannel
  content: string
  clientTurnId: string
  context: string
}): Promise<{ content: string; approval: ApprovalView | null }> {
  const response = await fetch("/api/agent-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (response.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load resets all client state
    window.location.assign("/login")
    throw new Error("Your session expired. Sign in again.")
  }
  const result = (await response.json().catch(() => ({}))) as { content?: string; approval?: ApprovalView | null; error?: string }
  if (!response.ok || !result.content) throw new Error(result.error ?? "The agent did not respond.")
  return { content: result.content, approval: result.approval ?? null }
}

export function newTurnId() {
  return crypto.randomUUID()
}
