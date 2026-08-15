import axios from "axios";

export class OrderService {
  async loadOrders() {
    return axios.get("/api/orders");
  }
}

export const orderService = new OrderService();
