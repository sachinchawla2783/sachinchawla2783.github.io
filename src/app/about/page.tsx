import type { Metadata } from "next";
import { ProductVisual } from "@/components/product/ProductVisual";

export const metadata: Metadata = {
  title: "About",
  description: "Lipids is a biotechnology skincare company engineering formulas from bio-identical lipids.",
};

export default function AboutPage() {
  return (
    <div>
      <section className="relative flex min-h-[60vh] flex-col justify-end overflow-hidden">
        <ProductVisual seed="about-hero" priority className="absolute inset-0 -z-10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-off-white via-off-white/20 to-transparent" />
        <div className="container-lipids pb-16">
          <p className="eyebrow mb-4">About Lipids</p>
          <h1 className="font-display text-display-lg font-bold uppercase leading-[0.9]">
            Engineered,
            <br />
            Not Marketed.
          </h1>
        </div>
      </section>

      <section className="border-t border-stone-200 py-section">
        <div className="container-lipids grid grid-cols-1 gap-16 md:grid-cols-3">
          <div>
            <p className="eyebrow mb-4">01 — Origin</p>
            <p className="text-stone-600">
              Lipids was founded on a simple observation: most skincare treats symptoms of a
              damaged barrier rather than the barrier itself. We started as a lipid biology
              research group before we were a skincare company.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-4">02 — Approach</p>
            <p className="text-stone-600">
              Every formula begins in the lab, not the mood board. We model ingredient ratios
              against published dermatological research before a single product is named or
              packaged.
            </p>
          </div>
          <div>
            <p className="eyebrow mb-4">03 — Standard</p>
            <p className="text-stone-600">
              No fragrance, no filler ingredients, no formulas we can&apos;t defend with data.
              If it doesn&apos;t serve the barrier, it isn&apos;t in the bottle.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
