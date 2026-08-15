import { Injectable } from "@angular/core";
import { createEffect } from "@ngrx/effects";

import { OrderService } from "./order.service";

@Injectable()
export class OrdersEffects {
  constructor(private readonly orderService: OrderService) {}

  readonly loadOrders = createEffect(() => this.orderService.loadOrders());
}
