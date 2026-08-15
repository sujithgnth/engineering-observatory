import { useOrders } from "../hooks/useOrders";

export function OrderTable() {
  const orders = useOrders();
  return (
    <table>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <td>{order.id}</td>
            <td>{order.total}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
