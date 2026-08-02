"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCartStore, cartCount } from "@/store/cart-store";
import { MobileMenu } from "./MobileMenu";

const NAV_LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/science", label: "Science" },
  { href: "/about", label: "About" },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lines = useCartStore((s) => s.lines);
  const openCart = useCartStore((s) => s.open);

  useEffect(() => {
    setMounted(true);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const count = mounted ? cartCount(lines) : 0;

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-40 transition-colors duration-700 ease-cinematic ${
          scrolled ? "bg-off-white/90 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="container-lipids flex h-20 items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            LIPIDS
          </Link>

          <nav className="hidden items-center gap-10 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="link-underline text-micro uppercase tracking-widest2 font-mono"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-6">
            <Link
              href="/account"
              className="hidden text-micro uppercase tracking-widest2 font-mono link-underline md:inline"
            >
              Account
            </Link>
            <button
              onClick={openCart}
              className="text-micro uppercase tracking-widest2 font-mono"
              aria-label="Open cart"
            >
              Cart {count > 0 ? `(${count})` : ""}
            </button>
            <button
              onClick={() => setMenuOpen(true)}
              className="text-micro uppercase tracking-widest2 font-mono md:hidden"
              aria-label="Open menu"
            >
              Menu
            </button>
          </div>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} links={NAV_LINKS} />
    </>
  );
}
