import { NextResponse } from "next/server"
import { recordAudit } from "@/lib/audit"
import { destroySession, getSession, SESSION_COOKIE } from "@/lib/auth"

export async function POST() {
  const session = await getSession()
  if (session) {
    await destroySession(session.sessionId)
    await recordAudit({ orgId: session.orgId, actorUserId: session.userId, action: "auth.logout" })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.delete(SESSION_COOKIE)
  return response
}
