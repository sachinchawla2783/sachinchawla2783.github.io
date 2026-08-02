"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCartStore, cartSubtotal } from "@/store/cart-store";
import { formatPrice } from "@/lib/utils";

export default function CheckoutPage() {
  const lines = useCartStore((s) => s.lines);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const subtotal = mounted ? cartSubtotal(lines) : 0;

  async function startCheckout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            quantity: l.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  if (mounted && lines.length === 0) {
    return (
      <div className="container-lipids flex min-h-[50vh] flex-col items-center justify-center text-center py-section">
        <p className="mb-8 text-stone-500">Your bag is empty.</p>
        <Link href="/shop" className="btn-primary">
          Shop the Collection
        </Link>
      </div>
    );
  }

  return (
    <div className="container-lipids py-section">
      <p className="eyebrow mb-4">Checkout</p>
      <h1 className="mb-12 font-display text-display-md font-bold uppercase leading-none">
        Review &amp; Pay
      </h1>

      <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
        <ul className="flex flex-col gap-4 md:col-span-2">
          {lines.map((line) => (
            <li key={line.variantId} className="flex justify-between border-b border-stone-200 pb-4 text-sm">
              <span>
                {line.name} ({line.size}) &times; {line.quantity}
              </span>
              <span className="font-mono">{formatPrice(line.price * line.quantity)}</span>
            </li>
          ))}
        </ul>

        <div className="h-fit border border-stone-200 p-8">
          <div className="mb-6 flex justify-between text-sm">
            <span className="text-stone-500">Subtotal</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <p className="mb-6 text-xs text-stone-500">
            Shipping, tax, and payment are completed securely via Stripe on the next step.
          </p>
          {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
          <button onClick={startCheckout} disabled={loading} className="btn-primary w-full">
            {loading ? "Redirecting…" : "Proceed to Payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
