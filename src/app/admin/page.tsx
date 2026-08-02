import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";

export default async function AdminOverviewPage() {
  const hasDb = Boolean(process.env.DATABASE_URL);

  if (!hasDb) {
    return (
      <div>
        <h1 className="mb-6 font-display text-display-md font-bold uppercase leading-none">
          Overview
        </h1>
        <div className="border border-stone-200 p-8 text-sm text-stone-600">
          Connect a database (set <code className="font-mono">DATABASE_URL</code> and run{" "}
          <code className="font-mono">npm run db:push && npm run db:seed</code>) to manage
          products, orders, and customers here. See README.md.
        </div>
      </div>
    );
  }

  const [productCount, orderCount, customerCount, orders] = await Promise.all([
    db.product.count(),
    db.order.count(),
    db.user.count({ where: { role: "CUSTOMER" } }),
    db.order.findMany({ where: { status: { in: ["PAID", "FULFILLED"] } }, select: { total: true } }),
  ]);

  const revenue = orders.reduce((sum, o) => sum + o.total, 0);

  const stats = [
    { label: "Products", value: productCount },
    { label: "Orders", value: orderCount },
    { label: "Customers", value: customerCount },
    { label: "Revenue", value: formatPrice(revenue) },
  ];

  return (
    <div>
      <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
        Overview
      </h1>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="border border-stone-200 p-6">
            <p className="eyebrow mb-2">{s.label}</p>
            <p className="font-mono text-2xl">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
