"use client";

import { useOrderStore } from "../store/orderStore";

export function OrderCards({ orders }: { orders: Array<{ id: string }> }) {
  const selectOrder = useOrderStore((state) => state.selectOrder);
  return (
    <section>
      {orders.map((order) => (
        <button key={order.id} onClick={() => selectOrder(order.id)}>
          {order.id}
        </button>
      ))}
    </section>
  );
}
