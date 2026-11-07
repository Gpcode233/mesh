import { asOperator, readJson } from "@/lib/api"
import { DomainError, selectBid } from "@/lib/procurement"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const body = (await readJson(request)) as { bidId?: unknown } | null
    if (typeof body?.bidId !== "string") throw new DomainError("A bid is required.", 400)
    const orderId = await selectBid(session, id, body.bidId)
    return Response.json({ orderId }, { status: 201 })
  })
}
