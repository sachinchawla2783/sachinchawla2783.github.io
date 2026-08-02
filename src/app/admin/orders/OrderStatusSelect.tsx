"use client";

import { useTransition } from "react";
import { updateOrderStatus } from "../products/actions";

const STATUSES = ["PENDING", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"];

export function OrderStatusSelect({ orderId, status }: { orderId: string; status: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      defaultValue={status}
      disabled={pending}
      onChange={(e) => startTransition(() => updateOrderStatus(orderId, e.target.value))}
      className="border border-stone-300 bg-off-white px-3 py-1 text-micro uppercase tracking-widest2 font-mono focus:border-ink focus:outline-none"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
