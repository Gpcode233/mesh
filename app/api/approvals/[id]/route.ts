import { asOperator, readJson } from "@/lib/api"
import { decideApproval, DomainError } from "@/lib/procurement"

/** The only path that resolves an agent's request. It requires a human session; the chat route never calls it. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const body = (await readJson(request)) as { decision?: unknown } | null
    if (body?.decision !== "approve" && body?.decision !== "reject") throw new DomainError("Decision must be approve or reject.", 400)
    return Response.json({ approval: await decideApproval(session, id, body.decision) })
  })
}
