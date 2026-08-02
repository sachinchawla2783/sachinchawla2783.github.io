"use client";

import { motion } from "framer-motion";
import { ProductVisual } from "@/components/product/ProductVisual";

export function BrandSection({
  eyebrow,
  title,
  body,
  index,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  index: number;
  reverse?: boolean;
}) {
  return (
    <section className="border-t border-stone-200 py-section">
      <div
        className={`container-lipids grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-20 ${
          reverse ? "md:[&>*:first-child]:order-2" : ""
        }`}
      >
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="eyebrow mb-4">{eyebrow}</p>
          <h2 className="whitespace-pre-line font-display text-display-md font-bold uppercase leading-[0.95]">
            {title}
          </h2>
          <p className="mt-6 max-w-md text-stone-600">{body}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="aspect-[4/5] w-full"
        >
          <ProductVisual seed={`section-${index}`} className="h-full w-full" />
        </motion.div>
      </div>
    </section>
  );
}
