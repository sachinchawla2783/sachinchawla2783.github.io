import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { OrderStatusSelect } from "./OrderStatusSelect";

export default async function AdminOrdersPage() {
  const hasDb = Boolean(process.env.DATABASE_URL);

  return (
    <div>
      <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
        Orders
      </h1>
      {!hasDb ? (
        <div className="border border-stone-200 p-8 text-sm text-stone-600">
          Connect a database to manage orders. See README.md.
        </div>
      ) : (
        <OrdersTable />
      )}
    </div>
  );
}

async function OrdersTable() {
  const orders = await db.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
    take: 100,
  });

  if (orders.length === 0) {
    return <p className="text-stone-500">No orders yet.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-micro uppercase tracking-widest2 font-mono text-stone-500">
          <th className="pb-3">Order</th>
          <th className="pb-3">Email</th>
          <th className="pb-3">Items</th>
          <th className="pb-3">Total</th>
          <th className="pb-3">Status</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id} className="border-b border-stone-200">
            <td className="py-4 font-mono text-xs">#{o.id.slice(-8).toUpperCase()}</td>
            <td className="py-4">{o.email}</td>
            <td className="py-4">{o.items.length}</td>
            <td className="py-4 font-mono">{formatPrice(o.total, o.currency.toUpperCase())}</td>
            <td className="py-4">
              <OrderStatusSelect orderId={o.id} status={o.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
