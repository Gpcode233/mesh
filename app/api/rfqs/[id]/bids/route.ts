import { asOperator, readJson } from "@/lib/api"
import { recordBid } from "@/lib/procurement"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const bidId = await recordBid(session, id, await readJson(request))
    return Response.json({ id: bidId }, { status: 201 })
  })
}
