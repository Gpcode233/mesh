import { asOperator, readJson } from "@/lib/api"
import { DomainError } from "@/lib/procurement"
import { releaseOrderMilestone } from "@/lib/settlement"

/** Releases one milestone via the server's restricted operator key, only after chain confirmation. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const body = (await readJson(request)) as { position?: unknown; evidenceUri?: unknown } | null
    const position = typeof body?.position === "number" ? body.position : Number(body?.position)
    if (typeof body?.evidenceUri !== "string") throw new DomainError("Evidence is required.", 400)
    return Response.json(await releaseOrderMilestone(session, id, position, body.evidenceUri))
  })
}