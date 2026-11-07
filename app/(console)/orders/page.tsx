import { OrdersView } from "@/components/mesh/orders-view"
import { requireSession } from "@/lib/auth"
import { listOrders } from "@/lib/procurement"

export default async function Page() {
  const session = await requireSession()
  return <OrdersView orders={await listOrders(session.orgId)} />
}
