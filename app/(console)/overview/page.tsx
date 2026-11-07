import { OverviewView } from "@/components/mesh/overview-view"
import { requireSession } from "@/lib/auth"
import { listOrders, listSuppliers } from "@/lib/procurement"

export default async function Page() {
  const session = await requireSession()
  const [orders, suppliers] = await Promise.all([listOrders(session.orgId), listSuppliers(session.orgId)])
  return <OverviewView orders={orders} suppliers={suppliers} />
}
