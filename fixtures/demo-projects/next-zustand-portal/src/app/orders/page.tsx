import { OrderCards } from "../../components/OrderCards";
import { getOrders } from "../../lib/ordersApi";

export default async function OrdersPage() {
  const orders = await getOrders();
  return <OrderCards orders={orders} />;
}
