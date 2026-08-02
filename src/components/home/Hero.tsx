"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ProductVisual } from "@/components/product/ProductVisual";

export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-5rem)] flex-col justify-between overflow-hidden bg-off-white">
      <ProductVisual seed="hero" priority className="absolute inset-0 -z-10" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-off-white via-off-white/10 to-off-white/40" />

      <div className="container-lipids flex flex-1 flex-col justify-center pt-16">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="eyebrow mb-6"
        >
          Lipid Biotechnology &mdash; Est. 2026
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          className="font-display text-display-xl font-bold uppercase leading-[0.9]"
        >
          Lipids
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          className="mt-6 max-w-lg font-display text-xl font-semibold uppercase tracking-tight text-stone-700 md:text-2xl"
        >
          Engineered for human skin.
        </motion.p>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.6 }}
        className="container-lipids flex items-center justify-between border-t border-ink/10 py-8"
      >
        <p className="hidden max-w-xs text-xs text-stone-600 md:block">
          A five-lipid complex engineered to match the human stratum corneum.
        </p>
        <Link href="/shop" className="btn-primary">
          Shop
        </Link>
      </motion.div>
    </section>
  );
}
