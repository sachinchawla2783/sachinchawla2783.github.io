import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { catalog } from "@/lib/data/repository";
import { getAllProducts } from "@/lib/data/products";
import { ProductVisual } from "@/components/product/ProductVisual";
import { AddToCart } from "@/components/product/AddToCart";
import { ExpandableSection } from "@/components/product/ExpandableSection";
import { ReviewsSection } from "@/components/product/ReviewsSection";
import { ProductCard } from "@/components/product/ProductCard";

export async function generateStaticParams() {
  return getAllProducts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await catalog.getBySlug(slug);
  if (!product) return {};

  return {
    title: product.name,
    description: product.tagline,
    openGraph: {
      title: `${product.name} — Lipids`,
      description: product.tagline,
      type: "website",
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await catalog.getBySlug(slug);
  if (!product) notFound();

  const all = await catalog.listProducts();
  const related = all.filter((p) => p.id !== product.id && p.category === product.category).slice(0, 3);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: (product.price / 100).toFixed(2),
      availability: product.variants.some((v) => v.inventory > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
    aggregateRating:
      product.reviews.length > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: (
              product.reviews.reduce((s, r) => s + r.rating, 0) / product.reviews.length
            ).toFixed(1),
            reviewCount: product.reviews.length,
          }
        : undefined,
  };

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="container-lipids grid grid-cols-1 gap-12 py-section md:grid-cols-2 md:gap-20">
        <div className="grid gap-4">
          <ProductVisual seed={product.id} priority className="aspect-[3/4] w-full" />
          <ProductVisual seed={`${product.id}-b`} className="aspect-[3/4] w-full md:hidden" />
        </div>

        <div className="md:sticky md:top-28 md:self-start">
          <p className="eyebrow mb-3">{product.category}</p>
          <h1 className="font-display text-display-md font-bold uppercase leading-[0.95]">
            {product.name}
          </h1>
          <p className="mt-4 max-w-md text-stone-600">{product.tagline}</p>

          <div className="my-10">
            <AddToCart product={product} />
          </div>

          <div>
            <ExpandableSection title="Science" defaultOpen>
              {product.science}
            </ExpandableSection>
            <ExpandableSection title="Ingredients">
              <ul className="flex flex-col gap-3">
                {product.ingredients.map((ing) => (
                  <li key={ing.name}>
                    <p className="font-medium text-ink">
                      {ing.name}
                      {ing.concentration ? ` — ${ing.concentration}` : ""}
                    </p>
                    <p className="text-stone-500">{ing.description}</p>
                  </li>
                ))}
              </ul>
            </ExpandableSection>
            <ExpandableSection title="How to Use">{product.howToUse}</ExpandableSection>
            <ExpandableSection title="Research">{product.research}</ExpandableSection>
            <ExpandableSection title="Shipping">{product.shipping}</ExpandableSection>
            <ExpandableSection title={`Reviews (${product.reviews.length})`}>
              <ReviewsSection reviews={product.reviews} />
            </ExpandableSection>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="border-t border-stone-200 py-section">
          <div className="container-lipids">
            <p className="eyebrow mb-10">You May Also Need</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3">
              {related.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
