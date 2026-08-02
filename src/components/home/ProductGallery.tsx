import Link from "next/link";
import type { Product } from "@/types";
import { ProductCard } from "@/components/product/ProductCard";

export function ProductGallery({ products }: { products: Product[] }) {
  return (
    <section className="border-t border-stone-200 py-section">
      <div className="container-lipids">
        <div className="mb-16 flex items-end justify-between">
          <div>
            <p className="eyebrow mb-4">The Collection</p>
            <h2 className="font-display text-display-md font-bold uppercase leading-none">
              Formulated
              <br />
              to Function.
            </h2>
          </div>
          <Link href="/shop" className="hidden text-micro uppercase tracking-widest2 font-mono link-underline md:block">
            View All
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3">
          {products.map((product, i) => (
            <ProductCard key={product.id} product={product} index={i} />
          ))}
        </div>

        <div className="mt-16 md:hidden">
          <Link href="/shop" className="btn-secondary w-full">
            View All Products
          </Link>
        </div>
      </div>
    </section>
  );
}
