import { AGENTS, isAgentId, type AgentId } from "@/lib/agents"

export type WireMessage = { role: "user" | "assistant"; content: string }

/** Gemini rejects histories that do not start with a user turn; also merges adjacent same-role turns. */
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

/** An agent's own turns are "assistant"; other agents' turns reach it as prefixed "user" turns. */
export function historyForAgent(agent: AgentId, rows: Array<{ author: string; content: string }>): WireMessage[] {
  return normalizeHistory(rows.map((row) => {
    if (row.author === "user") return { role: "user" as const, content: row.content }
    if (row.author === agent) return { role: "assistant" as const, content: row.content }
    const label = isAgentId(row.author) ? AGENTS[row.author].label : row.author
    return { role: "user" as const, content: `[${label}]: ${row.content}` }
  }))
}
