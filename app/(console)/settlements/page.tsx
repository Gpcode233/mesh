import { SettlementsView } from "@/components/mesh/settlements-view"
import { requireSession } from "@/lib/auth"
import { getSettlementSummary } from "@/lib/procurement"

export default async function Page() {
  const session = await requireSession()
  return <SettlementsView summary={await getSettlementSummary(session.orgId)} />
}
