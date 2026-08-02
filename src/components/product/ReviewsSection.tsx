import type { ReviewItem } from "@/types";
import { averageRating } from "@/lib/utils";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="font-mono text-sm tracking-widest" aria-label={`${rating} out of 5 stars`}>
      {"★".repeat(rating)}
      <span className="text-stone-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function ReviewsSection({ reviews }: { reviews: ReviewItem[] }) {
  const avg = averageRating(reviews);

  return (
    <div>
      <div className="mb-8 flex items-center gap-4">
        <Stars rating={Math.round(avg)} />
        <span className="text-sm text-stone-600">
          {avg.toFixed(1)} &middot; {reviews.length} review{reviews.length === 1 ? "" : "s"}
        </span>
      </div>

      <ul className="flex flex-col gap-8">
        {reviews.map((r) => (
          <li key={r.id} className="border-b border-stone-200 pb-8 last:border-0">
            <div className="mb-2 flex items-center justify-between">
              <Stars rating={r.rating} />
              {r.verified && (
                <span className="text-micro uppercase tracking-widest2 font-mono text-stone-400">
                  Verified Purchase
                </span>
              )}
            </div>
            <p className="mb-1 text-sm font-medium">{r.title}</p>
            <p className="mb-2 text-sm text-stone-600">{r.body}</p>
            <p className="text-micro uppercase tracking-widest2 font-mono text-stone-400">
              {r.name} &mdash; {r.createdAt}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
