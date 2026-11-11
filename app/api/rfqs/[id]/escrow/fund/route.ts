import { asOperator, readJson } from "@/lib/api"
import { DomainError } from "@/lib/procurement"
import { confirmFunding } from "@/lib/settlement"

/** Records funding after verifying the order is funded on-chain with the expected amount and supplier. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const body = (await readJson(request)) as { txHash?: unknown } | null
    if (typeof body?.txHash !== "string") throw new DomainError("A transaction hash is required.", 400)
    return Response.json(await confirmFunding(session, id, body.txHash))
  })
}