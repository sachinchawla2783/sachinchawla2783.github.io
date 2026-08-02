import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { ProductGallery } from "@/components/home/ProductGallery";
import { BrandSection } from "@/components/home/BrandSection";
import { catalog } from "@/lib/data/repository";

export const metadata: Metadata = {
  title: "Lipids — Engineered for Human Skin",
  description:
    "A biotechnology skincare company engineering barrier-replenishing formulas from bio-identical lipids.",
};

export default async function HomePage() {
  const featured = await catalog.listFeatured();

  return (
    <>
      <Hero />
      <ProductGallery products={featured} />

      <BrandSection
        index={1}
        eyebrow="The Science"
        title={"The Barrier\nIs the Point."}
        body="Skin barrier function is a matrix of ceramides, cholesterol, and free fatty acids arranged in a precise ratio. Every Lipids formula is engineered to restore that exact ratio — not mask its absence."
      />

      <BrandSection
        index={2}
        eyebrow="Engineered for Human Skin"
        title={"Biology,\nNot Beauty."}
        body="We don't formulate around trends. We formulate around the stratum corneum — the body's most sophisticated barrier system — and build products that work with its architecture, not against it."
        reverse
      />

      <BrandSection
        index={3}
        eyebrow="Formulation"
        title={"Tested.\nMeasured.\nProven."}
        body="Every Lipids formula is validated through independent clinical study — transepidermal water loss, corneometry, and barrier recovery time — before it reaches your skin."
      />
    </>
  );
}
