import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { products, categories } from "../src/lib/data/products";

const db = new PrismaClient();

async function main() {
  console.log("Seeding LIPIDS catalog...");

  for (const cat of categories) {
    await db.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: { slug: cat.slug, name: cat.name },
    });
  }

  for (const p of products) {
    const category = await db.category.findUnique({ where: { slug: p.category } });

    const product = await db.product.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        science: p.science,
        howToUse: p.howToUse,
        research: p.research,
        price: p.price,
        featured: p.featured,
        categoryId: category?.id,
      },
      create: {
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        science: p.science,
        howToUse: p.howToUse,
        research: p.research,
        price: p.price,
        featured: p.featured,
        categoryId: category?.id,
      },
    });

    await db.productImage.deleteMany({ where: { productId: product.id } });
    await db.productImage.createMany({
      data: p.images.map((img, i) => ({
        productId: product.id,
        url: img.url,
        alt: img.alt,
        position: i,
      })),
    });

    for (const v of p.variants) {
      await db.productVariant.upsert({
        where: { sku: v.sku },
        update: { size: v.size, inventory: v.inventory, priceDelta: v.priceDelta, productId: product.id },
        create: { sku: v.sku, size: v.size, inventory: v.inventory, priceDelta: v.priceDelta, productId: product.id },
      });
    }

    for (const ing of p.ingredients) {
      const ingredient = await db.ingredient.upsert({
        where: { name: ing.name },
        update: { function: ing.function, description: ing.description },
        create: { name: ing.name, function: ing.function, description: ing.description },
      });

      await db.productIngredient.upsert({
        where: { productId_ingredientId: { productId: product.id, ingredientId: ingredient.id } },
        update: { concentration: ing.concentration },
        create: {
          productId: product.id,
          ingredientId: ingredient.id,
          concentration: ing.concentration,
        },
      });
    }

    await db.review.deleteMany({ where: { productId: product.id } });
    await db.review.createMany({
      data: p.reviews.map((r) => ({
        productId: product.id,
        name: r.name,
        rating: r.rating,
        title: r.title,
        body: r.body,
        verified: r.verified,
        createdAt: new Date(r.createdAt),
      })),
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@lipids.co";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "change-me-immediately";
  await db.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN" },
    create: {
      email: adminEmail,
      name: "Lipids Admin",
      role: "ADMIN",
      passwordHash: await bcrypt.hash(adminPassword, 12),
    },
  });
  console.log(`Admin user ready: ${adminEmail} (set SEED_ADMIN_PASSWORD to control the password)`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
