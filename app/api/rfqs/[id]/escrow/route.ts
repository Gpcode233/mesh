import { asOperator } from "@/lib/api"
import { getFundingPlan } from "@/lib/settlement"

/** Funding plan for the owner's wallet: the fund_order call to sign, with its exact deposit. Owners only. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return asOperator(async (session) => {
    const { id } = await params
    return Response.json(await getFundingPlan(session, id))
  })
}
