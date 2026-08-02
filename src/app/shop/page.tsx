import type { Metadata } from "next";
import { catalog } from "@/lib/data/repository";
import { ProductCard } from "@/components/product/ProductCard";
import { CategoryFilter } from "@/components/product/CategoryFilter";

export const metadata: Metadata = {
  title: "Shop",
  description: "The full Lipids collection — serums, cleansers, moisturizers, and treatments engineered for the skin barrier.",
};

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const [products, categories] = await Promise.all([
    category ? catalog.listByCategory(category) : catalog.listProducts(),
    catalog.listCategories(),
  ]);

  return (
    <div className="py-section">
      <div className="container-lipids mb-16">
        <p className="eyebrow mb-4">Shop</p>
        <h1 className="font-display text-display-md font-bold uppercase leading-none">
          The Collection
        </h1>
      </div>

      <div className="container-lipids mb-12">
        <CategoryFilter categories={categories} active={category} />
      </div>

      <div className="container-lipids">
        {products.length === 0 ? (
          <p className="text-stone-500">No products in this category yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3">
            {products.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
