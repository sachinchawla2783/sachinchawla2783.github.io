import Stripe from "stripe";

let stripeClient: Stripe | null = null;

/**
 * Lazily-constructed Stripe client. Throws only when actually invoked
 * without STRIPE_SECRET_KEY set, so pages that don't touch checkout
 * (the whole storefront in dev) never require the key.
 */
export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env to enable checkout — see README.md."
    );
  }

  stripeClient = new Stripe(key, {
    apiVersion: "2025-02-24.acacia",
  });

  return stripeClient;
}
