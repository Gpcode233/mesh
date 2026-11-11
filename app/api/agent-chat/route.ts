import { and, desc, eq, lte } from "drizzle-orm"
import { NextRequest } from "next/server"
import { buildAgentTools, type ToolTurnState } from "@/lib/agent-tools"
import { ProviderError, streamAgentModel } from "@/lib/ai-provider"
import { isAgentId, type AgentId } from "@/lib/agents"
import { recordAudit } from "@/lib/audit"
import { canOperate, getSession, type Session } from "@/lib/auth"
import { NDJSON, type ChatReply, type ChatStreamEvent, type ToolStep } from "@/lib/chat-events"
import { historyForAgent } from "@/lib/chat-history"
import { getDb } from "@/lib/db"
import { conversations, messages } from "@/lib/db/schema"
import { getApprovalViews } from "@/lib/procurement"
import { consumeRateLimit, limitFromEnv } from "@/lib/rate-limit"
import type { ApprovalView } from "@/lib/rfq"

const MAX_CONTENT = 4000
const HISTORY_LIMIT = 12
const TURN_ID = /^[A-Za-z0-9_-]{8,64}$/

type Turn = {
  session: Session
  agent: AgentId
  channel: "direct" | "group"
  content: string
  clientTurnId: string
  context: string
}

/**
 * Accepts one new message and returns the agent's reply. Clients that send `Accept: application/x-ndjson`
 * receive text and tool steps as they happen, ending in a `done` or `error` event; others receive JSON.
 */
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (!canOperate(session)) return Response.json({ error: "Your role cannot message agents." }, { status: 403 })

  let body: { agent?: unknown; channel?: unknown; content?: unknown; clientTurnId?: unknown; context?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }

  const { agent, channel, content, clientTurnId } = body
  if (!isAgentId(agent)) return Response.json({ error: "Unknown agent." }, { status: 400 })
  if (channel !== "direct" && channel !== "group") return Response.json({ error: "Channel must be direct or group." }, { status: 400 })
  if (typeof content !== "string" || !content.trim() || content.length > MAX_CONTENT) {
    return Response.json({ error: `Message must be 1-${MAX_CONTENT} characters.` }, { status: 400 })
  }
  if (typeof clientTurnId !== "string" || !TURN_ID.test(clientTurnId)) {
    return Response.json({ error: "Invalid clientTurnId." }, { status: 400 })
  }
  const context = typeof body.context === "string" ? body.context.trim().slice(0, MAX_CONTENT) : ""

  const limit = await consumeRateLimit(`chat:${session.userId}`, limitFromEnv("MESH_CHAT_RATE_LIMIT", 30), 60_000)
  if (!limit.allowed) {
    return Response.json(
      { error: `Rate limit reached. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  const turn: Turn = { session, agent, channel, content: content.trim(), clientTurnId, context }

  if (!request.headers.get("accept")?.includes(NDJSON)) {
    try {
      return Response.json(await runTurn(turn, () => {}))
    } catch (error) {
      const { error: message, status } = describeError(error)
      return Response.json({ error: message }, { status })
    }
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // The client went away; the turn still finishes and is stored.
        }
      }
      try {
        send({ type: "done", ...(await runTurn(turn, send)) })
      } catch (error) {
        send({ type: "error", ...describeError(error) })
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(stream, { headers: { "Content-Type": `${NDJSON}; charset=utf-8`, "Cache-Control": "no-store" } })
}

function describeError(error: unknown) {
  if (error instanceof ProviderError) return { error: error.message, status: error.status }
  console.error("Mesh agent chat failed", error)
  return { error: "The agent could not respond.", status: 500 }
}

// Not tied to the request signal: a turn finishes and is stored even if the client leaves, so a retry gets it.
async function runTurn(turn: Turn, send: (event: ChatStreamEvent) => void): Promise<ChatReply> {
  const { session, agent, channel, clientTurnId } = turn
  const db = getDb()
  const channelKey = channel === "group" ? "group" : `direct:${agent}`
  await db.insert(conversations).values({ orgId: session.orgId, userId: session.userId, channel: channelKey }).onConflictDoNothing()
  const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(
    eq(conversations.orgId, session.orgId),
    eq(conversations.userId, session.userId),
    eq(conversations.channel, channelKey),
  ))

  // Group fan-out sends one turn per agent; the unique index stores the user's message once.
  await db.insert(messages).values({ conversationId: conversation.id, author: "user", content: turn.content, clientTurnId }).onConflictDoNothing()
  const [userMessage] = await db.select().from(messages).where(and(
    eq(messages.conversationId, conversation.id),
    eq(messages.clientTurnId, clientTurnId),
    eq(messages.author, "user"),
  ))

  // A retried turn returns the stored reply instead of calling the model or drafting again.
  const [existing] = await db.select().from(messages).where(and(
    eq(messages.conversationId, conversation.id),
    eq(messages.clientTurnId, clientTurnId),
    eq(messages.author, agent),
  ))
  if (existing) {
    const stored = existing.approvalId ? await getApprovalViews(session.orgId, [existing.approvalId]) : undefined
    return { agent, content: existing.content, approval: (existing.approvalId && stored?.get(existing.approvalId)) || null, steps: existing.steps ?? [] }
  }

  // Cut at this turn so agents answering in parallel do not see each other's replies to it.
  const recent = await db.select({ author: messages.author, content: messages.content, sources: messages.sources }).from(messages)
    .where(and(eq(messages.conversationId, conversation.id), lte(messages.id, userMessage.id)))
    .orderBy(desc(messages.id))
    .limit(HISTORY_LIMIT)
  const history = historyForAgent(agent, recent.reverse())

  // Group turns get no tools: six agents reading records for one message multiplies cost and noise.
  // Only the Head Agent drafts, and only in its private thread, so one message makes at most one card.
  // Only Scout searches the web and proposes suppliers, also only in its private thread.
  // Search results stored on this agent's earlier replies in the history window can be proposed from too.
  const state: ToolTurnState = { approval: null, refusal: null, searchResults: new Map() }
  for (const row of recent) {
    if (row.author !== agent) continue
    for (const source of row.sources ?? []) if (!state.searchResults.has(source.url)) state.searchResults.set(source.url, source.title)
  }
  const earlierSources = state.searchResults.size
  const tools = channel === "direct"
    ? buildAgentTools({ session, agent, messageId: userMessage.id, allowDraft: agent === "head", allowDiscovery: agent === "scout", state })
    : undefined

  const audit = { orgId: session.orgId, actorUserId: session.userId, target: agent }
  try {
    const reply = await streamAgentModel({
      agent,
      context: turn.context,
      messages: history,
      tools,
      onText: (delta) => send({ type: "text", delta }),
      onStep: (step) => send({ type: "step", step }),
    })

    // The route, not the model, describes the outcome of a proposal.
    let content = reply.content
    if (state.approval) content = proposalText(state.approval)
    else if (state.refusal?.kind === "create_rfq") content = `I couldn't draft that RFQ: ${state.refusal.reason} Nothing was created.`
    else if (state.refusal?.kind === "add_supplier") content = `I couldn't propose that supplier: ${state.refusal.reason} Nothing was saved.`
    else if (!content) throw new ProviderError("The agent read records but gave no answer. Try again.", 502)

    const steps: ToolStep[] = reply.steps
    await db.insert(messages).values({
      conversationId: conversation.id,
      author: agent,
      content,
      clientTurnId,
      approvalId: state.approval?.id,
      steps: steps.length ? steps : null,
      sources: newSources(state, earlierSources),
    }).onConflictDoNothing()
    await recordAudit({ ...audit, action: "agent_chat.replied", metadata: { channel, provider: reply.provider, model: reply.model, messageId: userMessage.id, toolCalls: steps.length } })
    return { agent, content, approval: state.approval, steps }
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500
    await recordAudit({ ...audit, action: "agent_chat.failed", metadata: { channel, status, messageId: userMessage.id } })
    // A draft stored before the failure still needs a decision; surface it rather than lose it.
    if (state.approval) {
      const content = `${proposalText(state.approval)} (My reply failed after this.)`
      await db.insert(messages).values({ conversationId: conversation.id, author: agent, content, clientTurnId, approvalId: state.approval.id }).onConflictDoNothing()
      return { agent, content, approval: state.approval, steps: [] }
    }
    throw error
  }
}

function proposalText(approval: ApprovalView) {
  return approval.kind === "add_supplier"
    ? `I found ${approval.supplier.name} on the web and proposed adding it to the supplier network. Nothing has been saved yet, and it is not verified: check the source, then approve it below to add it, or reject it.`
    : "I drafted this RFQ. Nothing has been created yet: approve it below to create it, or reject it."
}

/** Results first returned during this turn (the map lists earlier ones first), or null. */
function newSources(state: ToolTurnState, earlier: number) {
  const fresh = [...state.searchResults].slice(earlier).map(([url, title]) => ({ url, title }))
  return fresh.length ? fresh : null
}
