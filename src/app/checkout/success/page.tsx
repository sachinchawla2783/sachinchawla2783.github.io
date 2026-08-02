"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useCartStore } from "@/store/cart-store";

export default function CheckoutSuccessPage() {
  const clear = useCartStore((s) => s.clear);

  useEffect(() => {
    clear();
  }, [clear]);

  return (
    <div className="container-lipids flex min-h-[60vh] flex-col items-center justify-center text-center py-section">
      <p className="eyebrow mb-4">Order Confirmed</p>
      <h1 className="font-display text-display-md font-bold uppercase leading-none">
        Thank You
      </h1>
      <p className="mt-6 max-w-md text-stone-600">
        Your order is confirmed. A receipt has been sent to your email, and you can track its
        status from your account.
      </p>
      <div className="mt-10 flex gap-4">
        <Link href="/account" className="btn-primary">
          View Orders
        </Link>
        <Link href="/shop" className="btn-secondary">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
