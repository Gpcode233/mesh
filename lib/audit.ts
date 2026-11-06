import { getDb } from "@/lib/db"
import { auditEvents } from "@/lib/db/schema"

/** Never pass prompts, replies, passwords or tokens in metadata. */
export async function recordAudit(event: {
  orgId?: string | null
  actorUserId?: string | null
  action: string
  target?: string
  metadata?: Record<string, unknown>
}) {
  await getDb().insert(auditEvents).values({
    orgId: event.orgId ?? null,
    actorUserId: event.actorUserId ?? null,
    action: event.action,
    target: event.target,
    metadata: event.metadata,
    createdAt: Date.now(),
  })
}
