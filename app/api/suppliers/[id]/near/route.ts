import { asOperator, readJson } from "@/lib/api"
import { DomainError } from "@/lib/procurement"
import { setSupplierNearAccount } from "@/lib/settlement"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    const body = (await readJson(request)) as { nearAccountId?: unknown } | null
    if (typeof body?.nearAccountId !== "string") throw new DomainError("A NEAR account is required.", 400)
    const nearAccountId = await setSupplierNearAccount(session, id, body.nearAccountId)
    return Response.json({ nearAccountId })
  })
}