import { createSlice } from "@reduxjs/toolkit";

export const ordersSlice = createSlice({
  name: "orders",
  initialState: { items: [] as Array<{ id: string; total: number }> },
  reducers: {
    ordersLoaded(state, action) {
      state.items = action.payload;
    },
    orderRemoved(state, action) {
      state.items = state.items.filter((order) => order.id !== action.payload);
    },
  },
  selectors: {
    selectAllOrders: (state) => state.items,
  },
});

export const { ordersLoaded, orderRemoved } = ordersSlice.actions;
export const { selectAllOrders } = ordersSlice.selectors;
