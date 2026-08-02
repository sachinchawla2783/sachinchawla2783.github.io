import type { Product } from "@/types";

/**
 * Mock catalog used when DATABASE_URL is not configured, so the app is
 * fully browsable with `npm run dev` and no setup. In production, swap
 * calls in src/lib/data/repository.ts to the Prisma-backed implementation —
 * the shape of `Product` matches the Prisma models 1:1.
 *
 * Product imagery is rendered procedurally (see components/product/ProductVisual)
 * rather than pointing at stock photography — replace with real Cloudinary
 * product photography before launch (see README "How to add products").
 */
export const products: Product[] = [
  {
    id: "p1",
    slug: "lp-01-barrier-serum",
    name: "LP-01 BARRIER SERUM",
    tagline: "Lipid-replenishing serum for compromised skin barriers.",
    description:
      "A five-lipid complex engineered to match the composition of the human stratum corneum. LP-01 rebuilds barrier function at the molecular level — reducing transepidermal water loss within 14 days of consistent use.",
    science:
      "The skin barrier is a lipid matrix — ceramides, cholesterol, and free fatty acids arranged in a precise 3:1:1 ratio. When this ratio degrades, water escapes and irritants enter. LP-01 delivers bio-identical lipids in that exact ratio, using a lamellar delivery system that integrates directly into the existing barrier structure rather than sitting on top of it.",
    howToUse:
      "Apply 3–4 drops to clean, dry skin morning and night. Press gently into skin — do not rub. Follow with moisturizer to lock in the lipid matrix. Introduce gradually over 7 days if new to barrier actives.",
    research:
      "Independent 12-week clinical study (n=142): 78% reduction in transepidermal water loss, 64% improvement in barrier recovery time post-irritation, measured via corneometry and TEWL probe. Full study data available on request.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 9800,
    category: "serum",
    featured: true,
    images: [
      { url: "lab-01", alt: "LP-01 Barrier Serum, glass vial on stone surface" },
      { url: "lab-01b", alt: "LP-01 Barrier Serum, detail of dropper" },
    ],
    variants: [
      { id: "v1a", size: "15ML", sku: "LP01-15", inventory: 84, priceDelta: -3000 },
      { id: "v1b", size: "30ML", sku: "LP01-30", inventory: 61, priceDelta: 0 },
      { id: "v1c", size: "50ML", sku: "LP01-50", inventory: 22, priceDelta: 4200 },
    ],
    ingredients: [
      { name: "Ceramide NP", function: "Barrier lipid", description: "Primary structural ceramide, restores lamellar bilayer integrity.", concentration: "2.0%" },
      { name: "Cholesterol", function: "Barrier lipid", description: "Modulates lipid fluidity within the stratum corneum matrix." },
      { name: "Linoleic Acid", function: "Free fatty acid", description: "Essential fatty acid supporting barrier lipid synthesis." },
      { name: "Phytosphingosine", function: "Ceramide precursor", description: "Stimulates endogenous ceramide production." },
      { name: "Squalane", function: "Emollient", description: "Biomimetic lipid, non-comedogenic occlusive support." },
    ],
    reviews: [
      { id: "r1", name: "M. Alden", rating: 5, title: "Barrier finally repaired", body: "Three weeks in and the redness around my nose is gone. This is formulated by people who understand skin biology.", verified: true, createdAt: "2026-06-02" },
      { id: "r2", name: "J. Okafor", rating: 5, title: "Different category of product", body: "Feels clinical in the best way. No fragrance, no filler, just works.", verified: true, createdAt: "2026-05-18" },
      { id: "r3", name: "T. Reyes", rating: 4, title: "Excellent, slow shipping", body: "Product is exceptional. Took 6 days to arrive.", verified: true, createdAt: "2026-04-30" },
    ],
  },
  {
    id: "p2",
    slug: "lp-02-lipid-cleanser",
    name: "LP-02 LIPID CLEANSER",
    tagline: "A cleanser that removes without stripping.",
    description:
      "Most cleansers destroy the barrier they claim to clean. LP-02 uses a lipid-first surfactant system that lifts impurities while leaving the skin's native oils intact.",
    science:
      "Traditional surfactants are indiscriminate — they strip sebum, barrier lipids, and dirt equally. LP-02's engineered surfactant complex has a selective affinity profile, targeting particulate and oxidized lipids while sparing the intact ceramide matrix underneath.",
    howToUse:
      "Massage onto damp skin for 30 seconds. Rinse with lukewarm water. Use once daily in the evening; morning use optional for oily skin types.",
    research:
      "In-vitro barrier integrity testing showed 91% retention of surface lipids post-cleanse versus 34% for standard foaming cleansers in the same product class.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 5600,
    category: "cleanser",
    featured: true,
    images: [
      { url: "lab-02", alt: "LP-02 Lipid Cleanser, matte bottle on concrete" },
      { url: "lab-02b", alt: "LP-02 Lipid Cleanser, texture detail" },
    ],
    variants: [
      { id: "v2a", size: "100ML", sku: "LP02-100", inventory: 130, priceDelta: 0 },
      { id: "v2b", size: "200ML", sku: "LP02-200", inventory: 74, priceDelta: 2600 },
    ],
    ingredients: [
      { name: "Coco-Glucoside", function: "Mild surfactant", description: "Plant-derived, low irritation cleansing agent." },
      { name: "Ceramide NP", function: "Barrier lipid", description: "Replenishes lipids lost during the cleansing process.", concentration: "0.5%" },
      { name: "Panthenol", function: "Humectant", description: "Provitamin B5, supports barrier recovery post-cleanse." },
    ],
    reviews: [
      { id: "r4", name: "S. Whitfield", rating: 5, title: "No more tightness", body: "First cleanser in years that doesn't leave my skin feeling stripped.", verified: true, createdAt: "2026-06-10" },
      { id: "r5", name: "D. Park", rating: 5, title: "Minimal and effective", body: "Exactly what a cleanser should be. No unnecessary ingredients.", verified: false, createdAt: "2026-05-02" },
    ],
  },
  {
    id: "p3",
    slug: "lp-03-night-matrix",
    name: "LP-03 NIGHT MATRIX",
    tagline: "Overnight lipid regeneration cream.",
    description:
      "A dense, occlusive lipid matrix designed for overnight repair — when the skin's natural regenerative processes are most active.",
    science:
      "Skin repair peaks during sleep as cortisol drops and cell turnover accelerates. LP-03 supplies a sustained-release lipid reservoir that feeds the barrier over 8 hours, paired with a peptide complex that supports collagen synthesis during this window.",
    howToUse:
      "Apply a generous layer as the final step of your evening routine. Suitable for all skin types; those with oily skin may prefer to use 2–3x weekly rather than nightly.",
    research:
      "8-week trial (n=96) recorded a 41% increase in overnight hydration retention and a 22% improvement in visible fine lines via VISIA imaging.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 12800,
    category: "moisturizer",
    featured: true,
    images: [
      { url: "lab-03", alt: "LP-03 Night Matrix, dark glass jar" },
      { url: "lab-03b", alt: "LP-03 Night Matrix, cream texture" },
    ],
    variants: [
      { id: "v3a", size: "50ML", sku: "LP03-50", inventory: 45, priceDelta: 0 },
    ],
    ingredients: [
      { name: "Ceramide EOP", function: "Barrier lipid", description: "Long-chain ceramide, critical for overnight barrier repair.", concentration: "1.5%" },
      { name: "Peptide Complex", function: "Signal peptide", description: "Supports collagen synthesis and matrix repair." },
      { name: "Shea Butter", function: "Occlusive", description: "Sustained-release lipid reservoir for overnight hydration." },
      { name: "Niacinamide", function: "Barrier support", description: "Boosts ceramide synthesis and reduces inflammatory response.", concentration: "4%" },
    ],
    reviews: [
      { id: "r6", name: "A. Lindqvist", rating: 5, title: "Wake up different", body: "The difference in the morning is immediate and obvious.", verified: true, createdAt: "2026-06-20" },
      { id: "r7", name: "R. Choudhury", rating: 4, title: "Rich but not greasy", body: "Dense texture that sinks in fully by morning.", verified: true, createdAt: "2026-05-27" },
    ],
  },
  {
    id: "p4",
    slug: "lp-04-daily-shield",
    name: "LP-04 DAILY SHIELD",
    tagline: "Broad-spectrum SPF 50 with barrier lipid technology.",
    description:
      "Sun protection engineered into the barrier itself. SPF 50 broad-spectrum defense combined with the same lipid complex found across the LP line.",
    science:
      "UV exposure degrades barrier lipids directly, accelerating water loss and photoaging. LP-04 pairs mineral and next-generation organic filters with barrier-supportive lipids, so protection and repair happen simultaneously rather than sequentially.",
    howToUse:
      "Apply generously as the final step of your morning routine, 15 minutes before sun exposure. Reapply every 2 hours during direct exposure.",
    research:
      "In-vivo SPF testing confirms SPF 50 / PA++++ broad-spectrum protection. Barrier lipid retention measured at 88% after 4 hours of UV exposure versus 52% for standard sunscreen formulations.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 6400,
    category: "spf",
    featured: false,
    images: [
      { url: "lab-04", alt: "LP-04 Daily Shield, aluminum tube" },
      { url: "lab-04b", alt: "LP-04 Daily Shield, applied texture" },
    ],
    variants: [
      { id: "v4a", size: "50ML", sku: "LP04-50", inventory: 97, priceDelta: 0 },
    ],
    ingredients: [
      { name: "Zinc Oxide", function: "Mineral UV filter", description: "Broad-spectrum physical UV protection.", concentration: "18%" },
      { name: "Ceramide NP", function: "Barrier lipid", description: "Maintains barrier integrity under UV stress." },
      { name: "Vitamin E", function: "Antioxidant", description: "Neutralizes UV-induced free radical damage." },
    ],
    reviews: [
      { id: "r8", name: "K. Novak", rating: 5, title: "No white cast, finally", body: "Blends in completely, doesn't pill under makeup.", verified: true, createdAt: "2026-06-14" },
    ],
  },
  {
    id: "p5",
    slug: "lp-05-recovery-mask",
    name: "LP-05 RECOVERY MASK",
    tagline: "Intensive weekly barrier restoration treatment.",
    description:
      "A concentrated lipid mask for weekly intervention — designed for barriers under acute stress from over-exfoliation, environmental damage, or seasonal change.",
    science:
      "Acute barrier damage requires a higher lipid concentration than daily maintenance can safely provide. LP-05 delivers a 3x concentrated dose of the core ceramide-cholesterol-fatty acid complex in a single 15-minute application.",
    howToUse:
      "Apply a thick layer to clean skin. Leave for 15–20 minutes. Remove excess with a damp cloth — do not rinse fully. Use 1–2x weekly.",
    research:
      "Single-application study showed 55% improvement in barrier function markers within 24 hours of use, sustained through day 4.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 8800,
    category: "treatment",
    featured: false,
    images: [
      { url: "lab-05", alt: "LP-05 Recovery Mask, wide jar" },
      { url: "lab-05b", alt: "LP-05 Recovery Mask, texture swatch" },
    ],
    variants: [
      { id: "v5a", size: "75ML", sku: "LP05-75", inventory: 38, priceDelta: 0 },
    ],
    ingredients: [
      { name: "Ceramide Complex (3:1:1)", function: "Barrier lipid", description: "Concentrated ratio-matched lipid blend.", concentration: "6%" },
      { name: "Centella Asiatica", function: "Soothing agent", description: "Reduces inflammatory response in stressed skin." },
      { name: "Allantoin", function: "Soothing agent", description: "Supports cellular regeneration." },
    ],
    reviews: [
      { id: "r9", name: "E. Sorensen", rating: 5, title: "Emergency skin fix", body: "Used this after a bad reaction to a retinoid. Calmed everything down within a day.", verified: true, createdAt: "2026-06-08" },
    ],
  },
  {
    id: "p6",
    slug: "lp-06-eye-complex",
    name: "LP-06 EYE COMPLEX",
    tagline: "Targeted lipid treatment for the periorbital barrier.",
    description:
      "The skin around the eyes has a thinner barrier and fewer lipid-producing glands. LP-06 is formulated at a higher lipid density specifically for this zone.",
    science:
      "Periorbital skin is roughly 40% thinner than facial skin elsewhere, with a barrier that degrades faster under mechanical stress (rubbing, expression lines). LP-06 uses a lightweight but lipid-dense formula that won't migrate into the eye.",
    howToUse:
      "Pat a small amount around the orbital bone using the ring finger, morning and night. Avoid direct contact with the eye.",
    research:
      "6-week study showed 36% reduction in visible fine lines and 29% improvement in periorbital hydration.",
    shipping:
      "Ships in temperature-controlled, light-blocking packaging. Free shipping on orders over $75. Delivered in 2–4 business days domestically, 5–10 internationally.",
    price: 7200,
    category: "treatment",
    featured: false,
    images: [
      { url: "lab-06", alt: "LP-06 Eye Complex, small glass vial" },
      { url: "lab-06b", alt: "LP-06 Eye Complex, applicator detail" },
    ],
    variants: [
      { id: "v6a", size: "15ML", sku: "LP06-15", inventory: 66, priceDelta: 0 },
    ],
    ingredients: [
      { name: "Ceramide AP", function: "Barrier lipid", description: "Lightweight ceramide suited to thin periorbital skin.", concentration: "1%" },
      { name: "Caffeine", function: "Microcirculation support", description: "Reduces appearance of puffiness and discoloration." },
      { name: "Peptide Complex", function: "Signal peptide", description: "Supports collagen density around the eye." },
    ],
    reviews: [
      { id: "r10", name: "N. Fairweather", rating: 4, title: "Subtle but real results", body: "Takes a few weeks but the fine lines are visibly softer.", verified: true, createdAt: "2026-05-30" },
    ],
  },
];

export const categories = [
  { slug: "serum", name: "Serums" },
  { slug: "cleanser", name: "Cleansers" },
  { slug: "moisturizer", name: "Moisturizers" },
  { slug: "spf", name: "SPF" },
  { slug: "treatment", name: "Treatments" },
];

export function getAllProducts(): Product[] {
  return products;
}

export function getFeaturedProducts(): Product[] {
  return products.filter((p) => p.featured);
}

export function getProductBySlug(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export function getProductsByCategory(category: string): Product[] {
  return products.filter((p) => p.category === category);
}
