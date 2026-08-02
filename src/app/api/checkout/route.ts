import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { catalog } from "@/lib/data/repository";

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string(),
        variantId: z.string(),
        quantity: z.number().int().positive().max(20),
      })
    )
    .min(1),
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid cart payload." }, { status: 400 });
  }

  // Recompute prices and validate stock server-side — never trust
  // client-submitted prices.
  const products = await catalog.listProducts();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

  for (const line of parsed.lines) {
    const product = products.find((p) => p.id === line.productId);
    const variant = product?.variants.find((v) => v.id === line.variantId);
    if (!product || !variant) {
      return NextResponse.json({ error: "One or more items are no longer available." }, { status: 400 });
    }
    if (variant.inventory < line.quantity) {
      return NextResponse.json(
        { error: `${product.name} (${variant.size}) is out of stock.` },
        { status: 409 }
      );
    }

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: product.name,
          description: `${variant.size} — ${product.tagline}`,
          metadata: { productId: product.id, variantId: variant.id, size: variant.size },
        },
        unit_amount: product.price + variant.priceDelta,
      },
      quantity: line.quantity,
    });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB", "AU", "DE", "FR", "IE", "NL"],
      },
      success_url: `${siteUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart`,
      automatic_tax: { enabled: true },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to start checkout.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
