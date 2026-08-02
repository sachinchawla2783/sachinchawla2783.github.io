"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

type Link_ = { href: string; label: string };

export function MobileMenu({
  open,
  onClose,
  links,
}: {
  open: boolean;
  onClose: () => void;
  links: Link_[];
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-50 flex flex-col bg-ink text-off-white"
        >
          <div className="container-lipids flex h-20 items-center justify-between">
            <span className="font-display text-xl font-bold">LIPIDS</span>
            <button
              onClick={onClose}
              className="text-micro uppercase tracking-widest2 font-mono"
              aria-label="Close menu"
            >
              Close
            </button>
          </div>

          <nav className="container-lipids flex flex-1 flex-col justify-center gap-4">
            {[...links, { href: "/account", label: "Account" }, { href: "/cart", label: "Cart" }].map(
              (link, i) => (
                <motion.div
                  key={link.href}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Link
                    href={link.href}
                    onClick={onClose}
                    className="font-display text-display-md font-bold uppercase leading-none"
                  >
                    {link.label}
                  </Link>
                </motion.div>
              )
            )}
          </nav>

          <div className="container-lipids pb-10">
            <p className="eyebrow text-stone-400">Engineered for human skin.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
