import { db } from "@/lib/db";

export default async function AdminCustomersPage() {
  const hasDb = Boolean(process.env.DATABASE_URL);

  return (
    <div>
      <h1 className="mb-10 font-display text-display-md font-bold uppercase leading-none">
        Customers
      </h1>
      {!hasDb ? (
        <div className="border border-stone-200 p-8 text-sm text-stone-600">
          Connect a database to manage customers. See README.md.
        </div>
      ) : (
        <CustomersTable />
      )}
    </div>
  );
}

async function CustomersTable() {
  const customers = await db.user.findMany({
    where: { role: "CUSTOMER" },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { orders: true } } },
  });

  if (customers.length === 0) {
    return <p className="text-stone-500">No customers yet.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-micro uppercase tracking-widest2 font-mono text-stone-500">
          <th className="pb-3">Name</th>
          <th className="pb-3">Email</th>
          <th className="pb-3">Orders</th>
          <th className="pb-3">Joined</th>
        </tr>
      </thead>
      <tbody>
        {customers.map((c) => (
          <tr key={c.id} className="border-b border-stone-200">
            <td className="py-4">{c.name ?? "—"}</td>
            <td className="py-4">{c.email}</td>
            <td className="py-4">{c._count.orders}</td>
            <td className="py-4 text-stone-500">{new Date(c.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
