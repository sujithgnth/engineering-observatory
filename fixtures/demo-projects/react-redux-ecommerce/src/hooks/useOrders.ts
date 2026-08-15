import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";

import { orderService } from "../services/OrderService";
import { ordersLoaded, selectAllOrders } from "../store/ordersSlice";

export function useOrders() {
  const dispatch = useDispatch();
  const orders = useSelector(selectAllOrders);
  useEffect(() => {
    void orderService.loadOrders().then((response) => {
      dispatch(ordersLoaded(response.data));
    });
  }, [dispatch]);
  return orders;
}
