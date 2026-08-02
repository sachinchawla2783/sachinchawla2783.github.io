"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const orderStatusSchema = z.enum(["PENDING", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"]);

const productSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  description: z.string().min(1),
  science: z.string().default(""),
  howToUse: z.string().default(""),
  research: z.string().default(""),
  price: z.coerce.number().int().positive(),
  featured: z.coerce.boolean().default(false),
  active: z.coerce.boolean().default(true),
  categorySlug: z.string().optional(),
});

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }
}

export async function createProduct(formData: FormData) {
  await requireAdmin();

  const parsed = productSchema.parse(Object.fromEntries(formData));
  const category = parsed.categorySlug
    ? await db.category.findUnique({ where: { slug: parsed.categorySlug } })
    : null;

  await db.product.create({
    data: {
      slug: parsed.slug,
      name: parsed.name,
      tagline: parsed.tagline,
      description: parsed.description,
      science: parsed.science,
      howToUse: parsed.howToUse,
      research: parsed.research,
      price: parsed.price,
      featured: parsed.featured,
      active: parsed.active,
      categoryId: category?.id,
    },
  });

  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function updateProduct(productId: string, formData: FormData) {
  await requireAdmin();

  const parsed = productSchema.parse(Object.fromEntries(formData));
  const category = parsed.categorySlug
    ? await db.category.findUnique({ where: { slug: parsed.categorySlug } })
    : null;

  await db.product.update({
    where: { id: productId },
    data: {
      slug: parsed.slug,
      name: parsed.name,
      tagline: parsed.tagline,
      description: parsed.description,
      science: parsed.science,
      howToUse: parsed.howToUse,
      research: parsed.research,
      price: parsed.price,
      featured: parsed.featured,
      active: parsed.active,
      categoryId: category?.id,
    },
  });

  revalidatePath("/admin/products");
  redirect("/admin/products");
}

export async function deleteProduct(productId: string) {
  await requireAdmin();
  await db.product.delete({ where: { id: productId } });
  revalidatePath("/admin/products");
}

export async function updateOrderStatus(orderId: string, status: string) {
  await requireAdmin();
  const parsedStatus = orderStatusSchema.parse(status);
  await db.order.update({
    where: { id: orderId },
    data: { status: parsedStatus },
  });
  revalidatePath("/admin/orders");
}
