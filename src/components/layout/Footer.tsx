import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-off-white">
      <div className="container-lipids grid grid-cols-2 gap-y-12 py-16 md:grid-cols-4">
        <div className="col-span-2 md:col-span-1">
          <p className="font-display text-2xl font-bold">LIPIDS</p>
          <p className="mt-3 max-w-xs text-sm text-stone-600">
            Engineered for human skin.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <p className="eyebrow mb-1">Shop</p>
          <Link href="/shop" className="link-underline w-fit text-sm">All Products</Link>
          <Link href="/shop?category=serum" className="link-underline w-fit text-sm">Serums</Link>
          <Link href="/shop?category=cleanser" className="link-underline w-fit text-sm">Cleansers</Link>
        </div>

        <div className="flex flex-col gap-3">
          <p className="eyebrow mb-1">Company</p>
          <Link href="/science" className="link-underline w-fit text-sm">Science</Link>
          <Link href="/about" className="link-underline w-fit text-sm">About</Link>
          <Link href="/account" className="link-underline w-fit text-sm">Account</Link>
        </div>

        <div className="flex flex-col gap-3">
          <p className="eyebrow mb-1">Support</p>
          <a href="mailto:support@lipids.co" className="link-underline w-fit text-sm">
            support@lipids.co
          </a>
          <Link href="/shop" className="link-underline w-fit text-sm">Shipping</Link>
        </div>
      </div>

      <div className="container-lipids flex flex-col items-start justify-between gap-4 border-t border-stone-200 py-6 text-micro uppercase tracking-widest2 font-mono text-stone-500 md:flex-row md:items-center">
        <span>&copy; {new Date().getFullYear()} Lipids Laboratories. All rights reserved.</span>
        <span>Formulated &amp; engineered in-house.</span>
      </div>
    </footer>
  );
}
