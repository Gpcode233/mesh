import { and, desc, eq, lte } from "drizzle-orm"
import { NextRequest } from "next/server"
import { callAgentModel, ProviderError } from "@/lib/ai-provider"
import { isAgentId } from "@/lib/agents"
import { recordAudit } from "@/lib/audit"
import { canOperate, getSession } from "@/lib/auth"
import { historyForAgent } from "@/lib/chat-history"
import { getDb } from "@/lib/db"
import { conversations, messages } from "@/lib/db/schema"
import { consumeRateLimit, limitFromEnv } from "@/lib/rate-limit"

const MAX_CONTENT = 4000
const HISTORY_LIMIT = 12
const TURN_ID = /^[A-Za-z0-9_-]{8,64}$/

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

  const db = getDb()
  const channelKey = channel === "group" ? "group" : `direct:${agent}`
  await db.insert(conversations).values({ orgId: session.orgId, userId: session.userId, channel: channelKey }).onConflictDoNothing()
  const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(
    eq(conversations.orgId, session.orgId),
    eq(conversations.userId, session.userId),
    eq(conversations.channel, channelKey),
  ))

  // Group fan-out sends one turn per agent; the unique index stores the user's message once.
  await db.insert(messages).values({ conversationId: conversation.id, author: "user", content: content.trim(), clientTurnId }).onConflictDoNothing()
  const [userMessage] = await db.select().from(messages).where(and(
    eq(messages.conversationId, conversation.id),
    eq(messages.clientTurnId, clientTurnId),
    eq(messages.author, "user"),
  ))

  // A retried turn returns the stored reply instead of calling the model again.
  const [existing] = await db.select().from(messages).where(and(
    eq(messages.conversationId, conversation.id),
    eq(messages.clientTurnId, clientTurnId),
    eq(messages.author, agent),
  ))
  if (existing) return Response.json({ agent, content: existing.content })

  // Cut at this turn so agents answering in parallel do not see each other's replies to it.
  const recent = await db.select({ author: messages.author, content: messages.content }).from(messages)
    .where(and(eq(messages.conversationId, conversation.id), lte(messages.id, userMessage.id)))
    .orderBy(desc(messages.id))
    .limit(HISTORY_LIMIT)
  const history = historyForAgent(agent, recent.reverse())

  const audit = { orgId: session.orgId, actorUserId: session.userId, target: agent }
  try {
    const reply = await callAgentModel({ agent, context, messages: history })
    await db.insert(messages).values({ conversationId: conversation.id, author: agent, content: reply.content, clientTurnId }).onConflictDoNothing()
    await recordAudit({ ...audit, action: "agent_chat.replied", metadata: { channel, provider: reply.provider, model: reply.model, messageId: userMessage.id } })
    return Response.json({ agent, content: reply.content })
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 500
    const message = error instanceof ProviderError ? error.message : "The agent could not respond."
    if (!(error instanceof ProviderError)) console.error("Mesh agent chat failed", error)
    await recordAudit({ ...audit, action: "agent_chat.failed", metadata: { channel, status, messageId: userMessage.id } })
    return Response.json({ error: message }, { status })
  }
}
