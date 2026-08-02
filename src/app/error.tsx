"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container-lipids flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="eyebrow mb-4">Error</p>
      <h1 className="font-display text-display-md font-bold uppercase">Something Broke</h1>
      <p className="mt-4 max-w-sm text-stone-600">
        {error.message || "An unexpected error occurred."}
      </p>
      <button onClick={reset} className="btn-primary mt-8">
        Try Again
      </button>
    </div>
  );
}
