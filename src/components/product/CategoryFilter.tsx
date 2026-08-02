import Link from "next/link";

export function CategoryFilter({
  categories,
  active,
}: {
  categories: { slug: string; name: string }[];
  active?: string;
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 border-y border-stone-200 py-4">
      <Link
        href="/shop"
        className={`text-micro uppercase tracking-widest2 font-mono ${
          !active ? "text-ink" : "text-stone-400 link-underline"
        }`}
      >
        All
      </Link>
      {categories.map((c) => (
        <Link
          key={c.slug}
          href={`/shop?category=${c.slug}`}
          className={`text-micro uppercase tracking-widest2 font-mono ${
            active === c.slug ? "text-ink" : "text-stone-400 link-underline"
          }`}
        >
          {c.name}
        </Link>
      ))}
    </div>
  );
}
