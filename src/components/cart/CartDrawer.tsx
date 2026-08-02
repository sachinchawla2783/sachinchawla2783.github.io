"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useCartStore, cartSubtotal } from "@/store/cart-store";
import { formatPrice } from "@/lib/utils";
import { ProductVisual } from "@/components/product/ProductVisual";

export function CartDrawer() {
  const { isOpen, close, lines, setQuantity, removeItem } = useCartStore();
  const subtotal = cartSubtotal(lines);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[60] bg-ink/40"
            onClick={close}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-off-white"
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-6 py-5">
              <p className="text-micro uppercase tracking-widest2 font-mono">
                Bag ({lines.reduce((s, l) => s + l.quantity, 0)})
              </p>
              <button onClick={close} className="text-micro uppercase tracking-widest2 font-mono" aria-label="Close cart">
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {lines.length === 0 ? (
                <p className="text-sm text-stone-500">Your bag is empty.</p>
              ) : (
                <ul className="flex flex-col gap-6">
                  {lines.map((line) => (
                    <li key={line.variantId} className="flex gap-4">
                      <ProductVisual seed={line.variantId} className="h-24 w-20 shrink-0" />
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{line.name}</p>
                            <p className="text-xs text-stone-500">{line.size}</p>
                          </div>
                          <p className="text-sm">{formatPrice(line.price * line.quantity)}</p>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <div className="flex items-center border border-stone-300">
                            <button
                              className="px-3 py-1 text-sm"
                              onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span className="w-8 text-center text-sm">{line.quantity}</span>
                            <button
                              className="px-3 py-1 text-sm"
                              onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                              disabled={line.quantity >= line.inventory}
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                          <button
                            onClick={() => removeItem(line.variantId)}
                            className="text-micro uppercase tracking-widest2 font-mono text-stone-500 link-underline"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {lines.length > 0 && (
              <div className="border-t border-stone-200 px-6 py-6">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-stone-500">Subtotal</span>
                  <span>{formatPrice(subtotal)}</span>
                </div>
                <Link href="/checkout" onClick={close} className="btn-primary w-full">
                  Checkout
                </Link>
                <Link
                  href="/cart"
                  onClick={close}
                  className="mt-3 block text-center text-micro uppercase tracking-widest2 font-mono link-underline"
                >
                  View Bag
                </Link>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
