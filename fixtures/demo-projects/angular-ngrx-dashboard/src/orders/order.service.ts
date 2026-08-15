import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class OrderService {
  constructor(private readonly http: HttpClient) {}

  loadOrders() {
    return this.http.get("/api/orders");
  }
}
