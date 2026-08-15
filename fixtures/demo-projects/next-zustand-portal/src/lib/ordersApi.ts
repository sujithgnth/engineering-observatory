export async function getOrders() {
  return fetch("/api/orders").then((response) => response.json());
}
