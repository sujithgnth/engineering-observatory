import {
  createAction,
  createReducer,
  createSelector,
  props,
} from "@ngrx/store";

export const loadOrders = createAction("[Orders] Load");
export const ordersLoaded = createAction(
  "[Orders] Loaded",
  props<{ orders: Array<{ id: string }> }>(),
);
export const ordersReducer = createReducer({ orders: [] });
export const selectOrders = createSelector(
  (state: { orders: Array<{ id: string }> }) => state.orders,
  (orders) => orders,
);
