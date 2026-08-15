import { Routes } from "@angular/router";

export const routes: Routes = [
  {
    path: "orders",
    loadComponent: () =>
      import("./orders/orders-page.component").then(
        (module) => module.OrdersPageComponent,
      ),
    canActivate: ["authGuard"],
  },
];
