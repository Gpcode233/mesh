import type { AgentId } from "@/lib/agents"
import { NDJSON, type ChatReply, type ChatStreamEvent, type ToolStep } from "@/lib/chat-events"

export type ChatChannel = "direct" | "group"

/**
 * Calls the server chat route, which owns history, and streams the reply. `onText` receives text
 * as it arrives and `onStep` each tool step. Resolves with the stored reply; throws with the
 * explicit error on failure. The final content can differ from the streamed text (the server
 * writes the reply for drafts), so callers should replace streamed text with it.
 */
export async function requestAgentReply(
  input: { agent: AgentId; channel: ChatChannel; content: string; clientTurnId: string; context: string },
  handlers: { onText?: (delta: string) => void; onStep?: (step: ToolStep) => void } = {},
): Promise<ChatReply> {
  const response = await fetch("/api/agent-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: NDJSON },
    body: JSON.stringify(input),
  })
  if (response.status === 401) {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load resets all client state
    window.location.assign("/login")
    throw new Error("Your session expired. Sign in again.")
  }
  if (!response.ok || !response.body) {
    const result = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(result.error ?? "The agent did not respond.")
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    const lines = buffer.split("\n")
    buffer = done ? "" : lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as ChatStreamEvent
      if (event.type === "text") handlers.onText?.(event.delta)
      else if (event.type === "step") handlers.onStep?.(event.step)
      else if (event.type === "error") throw new Error(event.error)
      else if (event.type === "done") return { agent: event.agent, content: event.content, approval: event.approval, steps: event.steps }
    }
    if (done) break
  }
  throw new Error("The connection closed before the agent finished. Your message was saved; reload to see the reply.")
}

export function newTurnId() {
  return crypto.randomUUID()
}
