// Supabase Edge Function: stripe-webhook
// Deploy with verify_jwt=false. Stripe requests are authenticated by their signature below.
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signature = req.headers.get("stripe-signature");
  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey || !signature) {
    return new Response("Webhook is not configured", { status: 503 });
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = await stripe.webhooks.constructEventAsync(
      rawBody, signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe signature verification failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Invalid signature", { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // A unique event ledger prevents duplicate Stripe deliveries from repeating fulfillment.
  // Failed events are removed from the ledger so Stripe's retry can process them again.
  const { data: prior, error: priorError } = await db.from("stripe_webhook_events")
    .select("event_id,status").eq("event_id", event.id).maybeSingle();
  if (priorError) {
    console.error("Could not check Stripe event idempotency ledger", priorError.message);
    return new Response("Webhook storage unavailable", { status: 500 });
  }
  if (prior?.status === "processed") return json({ received: true, duplicate: true });
  if (prior?.status === "processing") return new Response("Event is already processing", { status: 409 });

  const { error: ledgerError } = await db.from("stripe_webhook_events").insert({
    event_id: event.id, event_type: event.type, status: "processing",
  });
  if (ledgerError) {
    // Another delivery may have inserted the same event between our read and insert.
    const { data: raced } = await db.from("stripe_webhook_events")
      .select("status").eq("event_id", event.id).maybeSingle();
    if (raced?.status === "processed") return json({ received: true, duplicate: true });
    return new Response("Event is already processing; retry shortly", { status: 409 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id || session.client_reference_id;
      const planId = session.metadata?.plan_id;
      const email = session.customer_details?.email || session.customer_email;
      if (!userId || !planId || !email) {
        console.error("Checkout session missing required membership metadata", session.id);
        throw new Error("Missing membership metadata");
      }
      const paid = session.payment_status === "paid" ||
        (session.mode === "subscription" && session.payment_status === "no_payment_required");
      const { data: existing, error: findError } = await db.from("memberships")
        .select("status").eq("stripe_checkout_session_id", session.id).maybeSingle();
      if (findError) throw findError;
      const status = paid ? "active" : existing?.status === "active" ? "active" : "pending";
      const row = {
        user_id: userId,
        email,
        plan_id: planId,
        status,
        payment_provider: "stripe",
        external_payment_id: session.id,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : "",
        stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : "",
        stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : "",
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from("memberships").upsert(row, { onConflict: "stripe_checkout_session_id" });
      if (error) throw error;
    } else if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { error } = await db.from("memberships").update({
        status: "cancelled", updated_at: new Date().toISOString(),
      }).eq("stripe_checkout_session_id", session.id).neq("status", "active");
      if (error) throw error;
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const status = event.type === "customer.subscription.deleted" || subscription.status === "canceled"
        ? "cancelled"
        : subscription.status === "active" || subscription.status === "trialing"
          ? "active"
          : subscription.status === "past_due" || subscription.status === "unpaid" ||
              subscription.status === "incomplete" || subscription.status === "incomplete_expired"
            ? "pending" : "pending";
      const { error } = await db.from("memberships").update({
        status,
        stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : "",
        stripe_subscription_id: subscription.id,
        current_period_end: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", subscription.id);
      if (error) throw error;
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = typeof invoice.subscription === "string"
        ? invoice.subscription
        : invoice.subscription?.id;
      if (subscriptionId) {
        // Invoice events can arrive late/out of order; confirm current subscription state
        // before granting access from a paid invoice.
        const subscription = event.type === "invoice.paid"
          ? await stripe.subscriptions.retrieve(subscriptionId)
          : null;
        const status = event.type === "invoice.payment_failed" ? "pending"
          : subscription?.status === "active" || subscription?.status === "trialing" ? "active"
          : subscription?.status === "canceled" ? "cancelled" : "pending";
        const { error } = await db.from("memberships").update({
          status,
          stripe_subscription_id: subscriptionId,
          ...(subscription?.current_period_end ? { current_period_end: new Date(subscription.current_period_end * 1000).toISOString() } : {}),
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", subscriptionId);
        if (error) throw error;
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string"
        ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId && charge.refunded) {
        const { error } = await db.from("memberships").update({
          status: "refunded", updated_at: new Date().toISOString(),
        }).eq("stripe_payment_intent_id", paymentIntentId);
        if (error) throw error;
      }
    }

    const { error: doneError } = await db.from("stripe_webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() }).eq("event_id", event.id);
    if (doneError) throw doneError;
    return json({ received: true });
  } catch (error) {
    await db.from("stripe_webhook_events").delete().eq("event_id", event.id);
    console.error("Could not process verified Stripe event", event.id, error instanceof Error ? error.message : "unknown error");
    return new Response("Could not process event", { status: 500 });
  }
});
