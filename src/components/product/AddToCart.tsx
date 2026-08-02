"use client";

import { useState } from "react";
import type { Product } from "@/types";
import { formatPrice } from "@/lib/utils";
import { useCartStore } from "@/store/cart-store";

export function AddToCart({ product }: { product: Product }) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const addItem = useCartStore((s) => s.addItem);

  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  if (!variant) return null;

  const price = product.price + variant.priceDelta;
  const outOfStock = variant.inventory <= 0;

  return (
    <div>
      <p className="mb-2 text-micro uppercase tracking-widest2 font-mono text-stone-500">Size</p>
      <div className="mb-8 flex flex-wrap gap-2">
        {product.variants.map((v) => (
          <button
            key={v.id}
            onClick={() => setVariantId(v.id)}
            disabled={v.inventory <= 0}
            className={`border px-4 py-2 text-sm transition-colors duration-300 ${
              v.id === variantId
                ? "border-ink bg-ink text-off-white"
                : "border-stone-300 hover:border-ink disabled:opacity-30 disabled:hover:border-stone-300"
            }`}
          >
            {v.size}
          </button>
        ))}
      </div>

      <p className="mb-6 font-mono text-2xl">{formatPrice(price)}</p>

      <button
        onClick={() =>
          addItem({
            productId: product.id,
            variantId: variant.id,
            slug: product.slug,
            name: product.name,
            size: variant.size,
            price,
            image: product.images[0]?.url ?? product.id,
            inventory: variant.inventory,
          })
        }
        disabled={outOfStock}
        className="btn-primary w-full"
      >
        {outOfStock ? "Out of Stock" : "Add to Bag"}
      </button>
    </div>
  );
}
