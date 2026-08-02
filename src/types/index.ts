export type Variant = {
  id: string;
  size: string;
  sku: string;
  inventory: number;
  priceDelta: number; // cents
};

export type IngredientRef = {
  name: string;
  function: string;
  description: string;
  concentration?: string;
};

export type ReviewItem = {
  id: string;
  name: string;
  rating: number;
  title: string;
  body: string;
  verified: boolean;
  createdAt: string;
};

export type ProductImg = {
  url: string;
  alt: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  science: string;
  howToUse: string;
  research: string;
  shipping: string;
  price: number; // base price, cents
  category: string;
  featured: boolean;
  images: ProductImg[];
  variants: Variant[];
  ingredients: IngredientRef[];
  reviews: ReviewItem[];
};

export type CartLine = {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  size: string;
  price: number; // unit price, cents, incl. variant delta
  image: string;
  quantity: number;
  inventory: number;
};

export type OrderSummary = {
  id: string;
  status: string;
  total: number;
  currency: string;
  createdAt: string;
  items: { name: string; size: string; quantity: number; unitPrice: number }[];
};
