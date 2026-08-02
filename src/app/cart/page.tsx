"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCartStore, cartSubtotal } from "@/store/cart-store";
import { formatPrice } from "@/lib/utils";
import { ProductVisual } from "@/components/product/ProductVisual";

export default function CartPage() {
  const { lines, setQuantity, removeItem } = useCartStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const subtotal = mounted ? cartSubtotal(lines) : 0;
  const displayLines = mounted ? lines : [];

  return (
    <div className="container-lipids py-section">
      <p className="eyebrow mb-4">Your Bag</p>
      <h1 className="mb-12 font-display text-display-md font-bold uppercase leading-none">Bag</h1>

      {mounted && displayLines.length === 0 ? (
        <div className="py-24 text-center">
          <p className="mb-8 text-stone-500">Your bag is empty.</p>
          <Link href="/shop" className="btn-primary">
            Shop the Collection
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
          <ul className="flex flex-col gap-8 md:col-span-2">
            {displayLines.map((line) => (
              <li key={line.variantId} className="flex gap-6 border-b border-stone-200 pb-8">
                <ProductVisual seed={line.variantId} className="h-32 w-24 shrink-0" />
                <div className="flex flex-1 flex-col justify-between">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-display font-semibold uppercase">{line.name}</p>
                      <p className="mt-1 text-sm text-stone-500">{line.size}</p>
                    </div>
                    <p className="font-mono">{formatPrice(line.price * line.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center border border-stone-300">
                      <button
                        className="px-3 py-1"
                        onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm">{line.quantity}</span>
                      <button
                        className="px-3 py-1"
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

          <div className="h-fit border border-stone-200 p-8">
            <div className="mb-4 flex justify-between text-sm">
              <span className="text-stone-500">Subtotal</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="mb-6 flex justify-between text-sm">
              <span className="text-stone-500">Shipping</span>
              <span className="text-stone-500">Calculated at checkout</span>
            </div>
            <Link href="/checkout" className="btn-primary w-full">
              Checkout
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
