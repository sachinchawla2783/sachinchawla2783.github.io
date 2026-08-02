import type { Metadata } from "next";
import { BrandSection } from "@/components/home/BrandSection";
import { ProductVisual } from "@/components/product/ProductVisual";

export const metadata: Metadata = {
  title: "Science",
  description: "The lipid biology behind every Lipids formula — barrier structure, ceramide ratios, and clinical validation.",
};

const PILLARS = [
  {
    eyebrow: "Skin Barrier Technology",
    title: "The Stratum\nCorneum Model",
    body: "The outermost layer of skin is not a passive wall — it's an active lipid matrix arranged in stacked bilayers. We model every formula against this structure, not against category conventions.",
  },
  {
    eyebrow: "Lipid Biology",
    title: "The 3:1:1\nRatio",
    body: "Ceramides, cholesterol, and free fatty acids occur naturally in a 3:1:1 ratio. Deviate from it and the barrier weakens. Every Lipids formula is built to preserve or restore that exact proportion.",
    reverse: true,
  },
  {
    eyebrow: "Ingredient Engineering",
    title: "Bio-Identical,\nNot Synthetic",
    body: "We use ceramides and lipids structurally identical to those your skin already produces — delivered via lamellar systems engineered to integrate into the existing barrier rather than coat it.",
  },
];

export default function SciencePage() {
  return (
    <div>
      <section className="relative flex min-h-[70vh] flex-col justify-end overflow-hidden">
        <ProductVisual seed="science-hero" priority className="absolute inset-0 -z-10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-off-white via-off-white/20 to-transparent" />
        <div className="container-lipids pb-16">
          <p className="eyebrow mb-4">Research &amp; Development</p>
          <h1 className="font-display text-display-lg font-bold uppercase leading-[0.9]">
            The Science
          </h1>
        </div>
      </section>

      {PILLARS.map((p, i) => (
        <BrandSection key={p.title} index={i + 10} {...p} />
      ))}
    </div>
  );
}
