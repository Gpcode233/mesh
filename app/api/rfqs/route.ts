import { asOperator, readJson } from "@/lib/api"
import { createRfq } from "@/lib/procurement"

export async function POST(request: Request) {
  return asOperator(async (session) => {
    const id = await createRfq(session, await readJson(request))
    return Response.json({ id }, { status: 201 })
  })
}
