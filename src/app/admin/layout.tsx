import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/account/SignOutButton";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/customers", label: "Customers" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/account/login?callbackUrl=/admin");
  if (session.user.role !== "ADMIN") redirect("/account");

  return (
    <div className="container-lipids grid grid-cols-1 gap-10 py-16 md:grid-cols-[200px_1fr]">
      <aside>
        <p className="eyebrow mb-6">Admin</p>
        <nav className="flex flex-col gap-3">
          {ADMIN_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-micro uppercase tracking-widest2 font-mono link-underline w-fit"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-4">
            <SignOutButton />
          </div>
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
