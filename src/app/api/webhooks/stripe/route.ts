import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { db } from "@/lib/db";

/**
 * Handles Stripe webhook events, primarily checkout.session.completed,
 * to persist orders. Requires STRIPE_WEBHOOK_SECRET and DATABASE_URL —
 * register this endpoint (`/api/webhooks/stripe`) in the Stripe dashboard
 * or via `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });
  }

  const payload = await req.text();
  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature.";
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (!process.env.DATABASE_URL) {
      console.warn("checkout.session.completed received but DATABASE_URL is not set; order not persisted.");
      return NextResponse.json({ received: true });
    }

    const stripe = getStripe();
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price.product"],
    });

    const existing = await db.order.findUnique({ where: { stripeSessionId: session.id } });
    if (!existing) {
      const order = await db.order.create({
        data: {
          email: session.customer_details?.email ?? "unknown@lipids.co",
          status: "PAID",
          subtotal: session.amount_subtotal ?? 0,
          shipping: session.shipping_cost?.amount_total ?? 0,
          tax: session.total_details?.amount_tax ?? 0,
          total: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
          stripeSessionId: session.id,
          shippingAddress: session.shipping_details
            ? JSON.parse(JSON.stringify(session.shipping_details))
            : undefined,
        },
      });

      for (const item of lineItems.data) {
        const product = item.price?.product;
        const metadata =
          typeof product === "object" && product && "metadata" in product ? product.metadata : undefined;
        const productId = metadata?.productId;
        if (!productId) continue;

        const productExists = await db.product.findUnique({ where: { id: productId } });
        if (!productExists) continue;

        const variantId = metadata?.variantId;
        const variantExists = variantId
          ? await db.productVariant.findUnique({ where: { id: variantId } })
          : null;

        await db.orderItem.create({
          data: {
            orderId: order.id,
            productId,
            variantId: variantExists ? variantId : null,
            name: typeof product === "object" && product && "name" in product ? String(product.name) : "",
            size: metadata?.size ?? "",
            quantity: item.quantity ?? 1,
            unitPrice: item.price?.unit_amount ?? 0,
          },
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
