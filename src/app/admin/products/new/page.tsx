import { db } from "@/lib/db";
import { ProductForm } from "../ProductForm";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  const categories = await db.category.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
        New Product
      </h1>
      <ProductForm action={createProduct} categories={categories} />
    </div>
  );
}
