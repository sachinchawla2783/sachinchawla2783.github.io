"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLine } from "@/types";

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  addItem: (line: Omit<CartLine, "quantity">, quantity?: number) => void;
  removeItem: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      addItem: (line, quantity = 1) => {
        const existing = get().lines.find((l) => l.variantId === line.variantId);
        if (existing) {
          set({
            lines: get().lines.map((l) =>
              l.variantId === line.variantId
                ? { ...l, quantity: Math.min(l.quantity + quantity, l.inventory) }
                : l
            ),
            isOpen: true,
          });
        } else {
          set({
            lines: [...get().lines, { ...line, quantity: Math.min(quantity, line.inventory) }],
            isOpen: true,
          });
        }
      },
      removeItem: (variantId) =>
        set({ lines: get().lines.filter((l) => l.variantId !== variantId) }),
      setQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          set({ lines: get().lines.filter((l) => l.variantId !== variantId) });
          return;
        }
        set({
          lines: get().lines.map((l) =>
            l.variantId === variantId ? { ...l, quantity: Math.min(quantity, l.inventory) } : l
          ),
        });
      },
      clear: () => set({ lines: [] }),
    }),
    {
      name: "lipids-cart",
      partialize: (state) => ({ lines: state.lines }),
    }
  )
);

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
}
