import { and, asc, eq } from "drizzle-orm"
import { getSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { conversations, messages } from "@/lib/db/schema"

/** The caller's own persisted threads, oldest message first. */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 })

  const rows = await getDb()
    .select({ id: messages.id, channel: conversations.channel, author: messages.author, content: messages.content, clientTurnId: messages.clientTurnId })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.orgId, session.orgId), eq(conversations.userId, session.userId)))
    .orderBy(asc(messages.id))
  return Response.json({ messages: rows })
}
