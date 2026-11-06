import type { AgentId } from "@/lib/agents"

export type WireMessage = { role: "user" | "assistant"; content: string }

/** Calls the server chat route. Throws with the provider's explicit error on failure. */
export async function requestAgentReply(input: {
  agent: AgentId
  context: string
  messages: WireMessage[]
  signal?: AbortSignal
}): Promise<string> {
  const response = await fetch("/api/agent-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({ agent: input.agent, context: input.context, messages: input.messages }),
  })
  const result = (await response.json().catch(() => ({}))) as { content?: string; error?: string }
  if (!response.ok || !result.content) throw new Error(result.error ?? "The agent did not respond.")
  return result.content
}

/** Gemini rejects histories that do not start with a user turn; merge adjacent same-role turns. */
export function normalizeHistory(messages: WireMessage[]): WireMessage[] {
  const merged: WireMessage[] = []
  for (const message of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === message.role) last.content += `\n\n${message.content}`
    else merged.push({ ...message })
  }
  while (merged.length > 0 && merged[0].role !== "user") merged.shift()
  return merged
}
