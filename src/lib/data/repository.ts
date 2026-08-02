import type { Product } from "@/types";
import {
  categories,
  getAllProducts,
  getFeaturedProducts,
  getProductBySlug,
  getProductsByCategory,
} from "./products";

/**
 * Single entry point the app uses to read catalog data.
 *
 * Today this proxies to the in-memory mock catalog so the storefront runs
 * with zero setup. Once DATABASE_URL is configured and the catalog is
 * seeded via `npm run db:seed`, swap the bodies below for Prisma queries
 * against `db` (src/lib/db.ts) — the `Product` shape already matches the
 * Prisma models, so route/component code does not need to change.
 */
export const catalog = {
  async listProducts(): Promise<Product[]> {
    return getAllProducts();
  },
  async listFeatured(): Promise<Product[]> {
    return getFeaturedProducts();
  },
  async listByCategory(category: string): Promise<Product[]> {
    return getProductsByCategory(category);
  },
  async getBySlug(slug: string): Promise<Product | undefined> {
    return getProductBySlug(slug);
  },
  async listCategories() {
    return categories;
  },
};
