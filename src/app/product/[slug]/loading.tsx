export default function ProductLoading() {
  return (
    <div className="container-lipids grid grid-cols-1 gap-12 py-section md:grid-cols-2 md:gap-20">
      <div className="aspect-[3/4] w-full animate-pulse bg-stone-100" />
      <div>
        <div className="mb-3 h-3 w-16 animate-pulse bg-stone-100" />
        <div className="h-16 w-3/4 animate-pulse bg-stone-100" />
        <div className="mt-6 h-10 w-full max-w-md animate-pulse bg-stone-100" />
      </div>
    </div>
  );
}
