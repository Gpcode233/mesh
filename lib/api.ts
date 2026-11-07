import { canOperate, getSession, type Session } from "@/lib/auth"
import { DomainError } from "@/lib/procurement"

type Handler = (session: Session) => Promise<Response>

/** Wraps a route so every mutation shares the same auth, role and error handling. */
export async function asOperator(handler: Handler) {
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (!canOperate(session)) return Response.json({ error: "Your role cannot do this." }, { status: 403 })
  try {
    return await handler(session)
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status })
    console.error("Mesh request failed", error)
    return Response.json({ error: "Something went wrong. Nothing was confirmed." }, { status: 500 })
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new DomainError("Request body must be valid JSON.", 400)
  }
}
