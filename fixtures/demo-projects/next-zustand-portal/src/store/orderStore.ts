import { create } from "zustand";

export const useOrderStore = create<{
  selectedOrderId: string | null;
  selectOrder: (id: string) => void;
}>((set) => ({
  selectedOrderId: null,
  selectOrder: (id) => set({ selectedOrderId: id }),
}));
