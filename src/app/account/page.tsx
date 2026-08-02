import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatPrice } from "@/lib/utils";
import { SignOutButton } from "@/components/account/SignOutButton";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/account/login");

  const orders = process.env.DATABASE_URL
    ? await db.order.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      })
    : [];

  return (
    <div className="container-lipids py-section">
      <div className="mb-12 flex items-start justify-between">
        <div>
          <p className="eyebrow mb-4">Account</p>
          <h1 className="font-display text-display-md font-bold uppercase leading-none">
            {session.user.name ?? "Your Account"}
          </h1>
          <p className="mt-2 text-sm text-stone-500">{session.user.email}</p>
        </div>
        <SignOutButton />
      </div>

      <div>
        <p className="eyebrow mb-6">Order History</p>
        {orders.length === 0 ? (
          <p className="text-stone-500">No orders yet.</p>
        ) : (
          <ul className="flex flex-col gap-6">
            {orders.map((order) => (
              <li key={order.id} className="border border-stone-200 p-6">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-stone-500">
                    #{order.id.slice(-8).toUpperCase()} &mdash;{" "}
                    {new Date(order.createdAt).toLocaleDateString()}
                  </span>
                  <span className="text-micro uppercase tracking-widest2 font-mono">
                    {order.status}
                  </span>
                </div>
                <ul className="mb-4 flex flex-col gap-1 text-sm text-stone-600">
                  {order.items.map((item) => (
                    <li key={item.id}>
                      {item.name} ({item.size}) &times; {item.quantity}
                    </li>
                  ))}
                </ul>
                <p className="text-right font-mono">{formatPrice(order.total, order.currency.toUpperCase())}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
