import { getSession } from "@/lib/auth"
import { getSettlementSummary } from "@/lib/procurement"

/** The settlements page totals: committed today against the daily limit, approved orders, chain-confirmed payments. */
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 })
  return Response.json(await getSettlementSummary(session.orgId))
}
