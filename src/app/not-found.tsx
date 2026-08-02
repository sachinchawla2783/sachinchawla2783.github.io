import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-lipids flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="eyebrow mb-4">404</p>
      <h1 className="font-display text-display-md font-bold uppercase">Not Found</h1>
      <p className="mt-4 max-w-sm text-stone-600">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/" className="btn-primary mt-8">
        Return Home
      </Link>
    </div>
  );
}
