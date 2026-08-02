export default function ShopLoading() {
  return (
    <div className="py-section">
      <div className="container-lipids mb-16">
        <div className="mb-4 h-3 w-24 animate-pulse bg-stone-200" />
        <div className="h-16 w-2/3 animate-pulse bg-stone-200" />
      </div>
      <div className="container-lipids grid grid-cols-2 gap-x-6 gap-y-14 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-[3/4] animate-pulse bg-stone-100" />
            <div className="mt-4 h-4 w-3/4 animate-pulse bg-stone-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
