# LIPIDS — Engineered for Human Skin

A production-grade ecommerce platform for **Lipids**, a biotechnology skincare
brand. Built with Next.js 15 (App Router), TypeScript, Tailwind CSS, Framer
Motion, Prisma/PostgreSQL, Stripe, Auth.js, and Cloudinary.

The storefront runs out of the box against a built-in mock product catalog —
no database or API keys required to browse the site locally. Connecting
`DATABASE_URL`, `STRIPE_SECRET_KEY`, and `AUTH_SECRET` upgrades it to a fully
live store with real checkout, accounts, and an admin dashboard.

---

## Architecture

```
src/
  app/                        Routes (Next.js App Router)
    page.tsx                  Homepage (hero, gallery, brand sections)
    shop/                     Product listing + category filter
    product/[slug]/           Product detail (expandable sections, JSON-LD)
    cart/, checkout/          Cart page, Stripe checkout, success page
    account/                  Login, signup, order history
    admin/                    Protected admin dashboard (products/orders/customers)
    api/                      checkout, signup, auth, stripe webhook
    sitemap.ts, robots.ts     SEO
  components/
    layout/                   Header, Footer, MobileMenu
    home/                     Hero, ProductGallery, BrandSection
    product/                  ProductCard, ProductVisual, AddToCart, ExpandableSection, Reviews
    cart/                     CartDrawer
    account/, providers/      SignOutButton, AuthProvider (next-auth SessionProvider)
  lib/
    data/                     Mock catalog + `catalog` repository (swap for Prisma when DB is live)
    db.ts                     Prisma client singleton
    auth.ts                   Auth.js (NextAuth v5) config — Credentials provider
    stripe.ts                 Stripe client
    cloudinary.ts              Cloudinary config (admin image uploads)
    utils.ts                  formatPrice, cn, averageRating
  store/
    cart-store.ts             Zustand cart store, persisted to localStorage
  types/                      Shared TypeScript types
prisma/
  schema.prisma                User, Product, Variant, Category, Ingredient, Review, Order, OrderItem
  seed.ts                      Seeds the catalog + an admin user into Postgres
```

**Data layer strategy**: `src/lib/data/repository.ts` is the single place the
UI reads product data from. Today it proxies to the mock catalog
(`src/lib/data/products.ts`) so the site works with zero setup. Once
`DATABASE_URL` is set and seeded, point `catalog`'s methods at `db` (Prisma)
instead — the `Product` type already matches the Prisma schema, so no
component code needs to change.

**Product imagery**: products render procedurally generated lab-glass
artwork (`components/product/ProductVisual.tsx`) rather than stock photos,
matching the scientific/editorial aesthetic without needing placeholder
photography. Replace with real product photography via Cloudinary before
launch (see "How to Add Products" below).

---

## Getting Started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. The full storefront — homepage, shop, product
pages, cart, checkout UI — works immediately against the mock catalog.
Checkout, accounts, and admin require the environment variables below.

## Environment Variables

Copy `.env.example` to `.env` and fill in what you need:

| Variable | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | Accounts, orders, admin | Postgres connection string (Vercel Postgres, Neon, Supabase, Railway, etc.) |
| `AUTH_SECRET` | Auth.js in production | `openssl rand -base64 33`. Dev falls back to an insecure default automatically. |
| `STRIPE_SECRET_KEY` | Checkout | From the Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Order persistence after payment | From Stripe Dashboard → Webhooks, or `stripe listen` locally |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Admin product image uploads | From the Cloudinary console |
| `NEXT_PUBLIC_SITE_URL` | SEO metadata, Stripe redirect URLs | e.g. `https://lipids.co` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Seed script | Credentials for the first admin account |

## Required API Keys

1. **Postgres database** — any managed Postgres works (Vercel Postgres, Neon,
   Supabase, Railway, or self-hosted).
2. **Stripe** — [dashboard.stripe.com](https://dashboard.stripe.com). You
   need a secret key for checkout and a webhook signing secret for order
   persistence.
3. **Cloudinary** — [cloudinary.com](https://cloudinary.com) (free tier is
   fine) for admin product image uploads.

---

## Setting Up a Live Database

```bash
# 1. Set DATABASE_URL in .env
# 2. Push the schema
npm run db:push

# 3. Seed the catalog + an admin account
npm run db:seed
```

The seed script creates the six starter products, their categories,
variants, ingredients, and reviews, plus an admin user
(`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, defaults to
`admin@lipids.co` / `change-me-immediately` — **change this immediately in
production**).

Once seeded, swap `src/lib/data/repository.ts`'s method bodies to query
`db` (Prisma) instead of the mock catalog, so the storefront reads live
data. Admin, checkout, and accounts already read from Prisma directly.

For schema changes going forward, prefer `npm run db:migrate` (creates a
migration file) over `db:push` once you have a production database.

## Enabling Stripe Checkout

1. Set `STRIPE_SECRET_KEY` in `.env`.
2. For local webhook testing:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.
3. In production, add a webhook endpoint in the Stripe Dashboard pointing to
   `https://<your-domain>/api/webhooks/stripe`, subscribed to
   `checkout.session.completed`.

Checkout recomputes prices and validates inventory server-side
(`src/app/api/checkout/route.ts`) — it never trusts client-submitted prices.

## Enabling Accounts & Admin

1. Set `DATABASE_URL` and `AUTH_SECRET`.
2. Run `npm run db:seed` to create the first admin user, or promote an
   existing user manually:
   ```sql
   UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@example.com';
   ```
3. Sign in at `/account/login`, then visit `/admin`.

---

## How to Add Products

**With a live database** (recommended): go to `/admin/products/new` while
signed in as an admin. Fill in name, tagline, description, science,
how-to-use, research, price (in cents), and category, then save. Variants,
ingredients, and reviews can be added via Prisma Studio (`npm run
db:studio`) until dedicated admin UI for those is built out — the schema
already supports them fully.

**Without a database** (editing the mock catalog): open
`src/lib/data/products.ts` and add a new object to the `products` array
following the existing shape (id, slug, name, tagline, description, science,
howToUse, research, shipping, price in cents, category, images, variants,
ingredients, reviews). It appears on the site immediately in dev.

**Product photography**: replace the procedural `ProductVisual` placeholders
by uploading real photography to Cloudinary and swapping
`components/product/ProductVisual.tsx`'s usage for a Cloudinary-backed
`next/image` component once real assets exist.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Start the production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:push` | Push Prisma schema to the database (no migration file) |
| `npm run db:migrate` | Create + apply a Prisma migration |
| `npm run db:seed` | Seed the catalog and an admin user |
| `npm run db:studio` | Open Prisma Studio |

---

## Deployment (Vercel)

1. Push this repository to GitHub and import it in
   [Vercel](https://vercel.com/new).
2. Add all environment variables from `.env.example` in the Vercel project
   settings (Production + Preview as needed).
3. Provision a Postgres database (Vercel Postgres integration, or bring your
   own) and set `DATABASE_URL`.
4. Add a `postinstall` step if you want migrations to run automatically on
   deploy, or run `npm run db:migrate deploy` manually against production
   the first time.
5. Set the Stripe webhook endpoint to
   `https://<your-vercel-domain>/api/webhooks/stripe`.
6. Set `NEXT_PUBLIC_SITE_URL` to your production domain (used in metadata,
   the sitemap, and Stripe redirect URLs).

This repository's GitHub Pages `CNAME` (`kuroka.me`) is unrelated to this
app — GitHub Pages only serves static files and cannot run a Next.js
server with API routes, so deploy this project to Vercel (or another
Node.js host), not GitHub Pages.

---

## Tech Stack

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Framer Motion
- **State**: Zustand (cart, persisted to localStorage)
- **Backend**: Next.js Route Handlers + Server Actions, PostgreSQL, Prisma
- **Payments**: Stripe Checkout
- **Auth**: Auth.js (NextAuth v5), Credentials provider, bcrypt password hashing
- **Images**: Cloudinary (admin uploads)
- **Validation**: Zod
- **Deployment**: Vercel
