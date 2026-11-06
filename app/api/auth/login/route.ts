import { eq } from "drizzle-orm"
import { NextRequest, NextResponse } from "next/server"
import { recordAudit } from "@/lib/audit"
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { memberships, users } from "@/lib/db/schema"
import { verifyDecoy, verifyPassword } from "@/lib/password"
import { consumeRateLimit, limitFromEnv } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 })
  }

  const limit = await consumeRateLimit(`login:${email}`, limitFromEnv("MESH_LOGIN_RATE_LIMIT", 10), 15 * 60_000)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    )
  }

  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.email, email))
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyDecoy(password)
  const [membership] = user && valid ? await db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1) : []
  if (!user || !valid || !membership) {
    await recordAudit({ orgId: membership?.orgId, actorUserId: user?.id, action: "auth.login_failed" })
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 })
  }

  const { token, expiresAt } = await createSession(user.id)
  await recordAudit({ orgId: membership.orgId, actorUserId: user.id, action: "auth.login" })
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt, request.nextUrl.hostname))
  return response
}
