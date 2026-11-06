import { desc, eq } from "drizzle-orm"
import { getSession } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { auditEvents, users } from "@/lib/db/schema"

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 })

  const events = await getDb()
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      target: auditEvents.target,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
      actor: users.email,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(eq(auditEvents.orgId, session.orgId))
    .orderBy(desc(auditEvents.id))
    .limit(200)
  return Response.json({ events })
}
