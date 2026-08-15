import { Component } from "@angular/core";
import { Store } from "@ngrx/store";

import { loadOrders, selectOrders } from "./orders.state";

@Component({
  selector: "app-orders-page",
  template: `<app-order-table [orders]="orders$ | async"></app-order-table>`,
})
export class OrdersPageComponent {
  readonly orders$ = this.store.select(selectOrders);

  constructor(private readonly store: Store) {
    this.store.dispatch(loadOrders());
  }
}
