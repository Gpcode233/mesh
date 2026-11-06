import type { AgentId } from "@/lib/agents"

export type ChatChannel = "direct" | "group"

/** Calls the server chat route, which owns history. Throws with the explicit error on failure. */
export async function requestAgentReply(input: {
  agent: AgentId
  channel: ChatChannel
  content: string
  clientTurnId: string
  context: string
}): Promise<string> {
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
  const result = (await response.json().catch(() => ({}))) as { content?: string; error?: string }
  if (!response.ok || !result.content) throw new Error(result.error ?? "The agent did not respond.")
  return result.content
}

export function newTurnId() {
  return crypto.randomUUID()
}
