import { createHash, randomBytes } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getDb } from "@/lib/db"
import { memberships, organizations, sessions, users } from "@/lib/db/schema"

export const SESSION_COOKIE = "mesh_session"
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type Role = "owner" | "operator" | "viewer"

export type Session = {
  sessionId: string
  userId: string
  email: string
  name: string
  orgId: string
  orgName: string
  role: Role
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = Date.now() + SESSION_TTL_MS
  await getDb().insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt })
  return { token, expiresAt }
}

export function sessionCookieOptions(expiresAt: number, hostname: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && hostname !== "localhost" && hostname !== "127.0.0.1",
    path: "/",
    expires: new Date(expiresAt),
  }
}

/** The single source of truth for who is calling. Checks expiry and org membership on every request. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const [row] = await getDb()
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      orgId: organizations.id,
      orgName: organizations.name,
      role: memberships.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, Date.now())))
    .limit(1)
  return row ?? null
}

/** For server pages that read org data: the layout's check does not protect a page's own queries. */
export async function requireSession() {
  const session = await getSession()
  if (!session) redirect("/login")
  return session
}

export async function destroySession(sessionId: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sessionId))
}

export function canOperate(session: Session) {
  return session.role === "owner" || session.role === "operator"
}
