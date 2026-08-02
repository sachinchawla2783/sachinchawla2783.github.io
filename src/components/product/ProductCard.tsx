"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Product } from "@/types";
import { formatPrice } from "@/lib/utils";
import { ProductVisual } from "./ProductVisual";

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: (index % 4) * 0.06 }}
    >
      <Link href={`/product/${product.slug}`} className="group block">
        <div className="relative aspect-[3/4] overflow-hidden bg-stone-100">
          <ProductVisual
            seed={product.id}
            className="h-full w-full transition-transform duration-1200 ease-cinematic group-hover:scale-[1.04]"
          />
        </div>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-tight">
              {product.name}
            </p>
            <p className="mt-1 text-xs text-stone-500">{product.tagline}</p>
          </div>
          <p className="shrink-0 text-sm font-mono">{formatPrice(product.price)}</p>
        </div>
      </Link>
    </motion.div>
  );
}
