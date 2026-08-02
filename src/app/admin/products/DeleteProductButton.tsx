"use client";

import { useTransition } from "react";
import { deleteProduct } from "./actions";

export function DeleteProductButton({ productId }: { productId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => {
        if (confirm("Delete this product? This cannot be undone.")) {
          startTransition(() => deleteProduct(productId));
        }
      }}
      disabled={pending}
      className="text-red-700 link-underline"
    >
      {pending ? "Deleting…" : "Delete"}
    </button>
  );
}
