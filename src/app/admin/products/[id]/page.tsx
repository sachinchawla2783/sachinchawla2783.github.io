import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ProductForm } from "../ProductForm";
import { updateProduct } from "../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, categories] = await Promise.all([
    db.product.findUnique({ where: { id } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  if (!product) notFound();

  const boundUpdate = updateProduct.bind(null, product.id);

  return (
    <div>
      <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
        Edit Product
      </h1>
      <ProductForm action={boundUpdate} product={product} categories={categories} />
    </div>
  );
}
