import { notFound } from "next/navigation"
import { OrderDetail } from "@/components/mesh/order-detail"
import { canOperate, requireSession } from "@/lib/auth"
import { getOrderDetail } from "@/lib/procurement"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const order = await getOrderDetail(session.orgId, id)
  if (!order) notFound()
  return <OrderDetail order={order} canOperate={canOperate(session)} />
}
