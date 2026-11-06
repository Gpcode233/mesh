import { OrderDetail } from "@/components/mesh/order-detail"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OrderDetail id={decodeURIComponent(id)} />
}
