import Link from "next/link";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { DeleteProductButton } from "./DeleteProductButton";

export default async function AdminProductsPage() {
  const hasDb = Boolean(process.env.DATABASE_URL);

  return (
    <div>
      <div className="mb-10 flex items-center justify-between">
        <h1 className="font-display text-display-md font-bold uppercase leading-none">
          Products
        </h1>
        {hasDb && (
          <Link href="/admin/products/new" className="btn-primary">
            New Product
          </Link>
        )}
      </div>

      {!hasDb ? (
        <div className="border border-stone-200 p-8 text-sm text-stone-600">
          Connect a database to manage products. See README.md.
        </div>
      ) : (
        <ProductTable />
      )}
    </div>
  );
}

async function ProductTable() {
  const products = await db.product.findMany({ orderBy: { createdAt: "desc" } });

  if (products.length === 0) {
    return <p className="text-stone-500">No products yet. Run `npm run db:seed` or create one.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-micro uppercase tracking-widest2 font-mono text-stone-500">
          <th className="pb-3">Name</th>
          <th className="pb-3">Price</th>
          <th className="pb-3">Status</th>
          <th className="pb-3" />
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.id} className="border-b border-stone-200">
            <td className="py-4">{p.name}</td>
            <td className="py-4 font-mono">{formatPrice(p.price)}</td>
            <td className="py-4">{p.active ? "Active" : "Hidden"}</td>
            <td className="py-4 text-right">
              <Link href={`/admin/products/${p.id}`} className="link-underline mr-4">
                Edit
              </Link>
              <DeleteProductButton productId={p.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
