import { asOperator, readJson } from "@/lib/api"
import { updatePolicy } from "@/lib/procurement"

export async function PUT(request: Request) {
  return asOperator(async (session) => {
    await updatePolicy(session, await readJson(request))
    return Response.json({ ok: true })
  })
}
