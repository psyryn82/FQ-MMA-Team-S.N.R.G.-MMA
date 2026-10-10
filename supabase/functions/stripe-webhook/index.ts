// Supabase Edge Function: stripe-webhook
// Deploy with: supabase functions deploy stripe-webhook --no-verify-jwt
// Set secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY
// Configure Stripe to send checkout.session.completed, checkout.session.async_payment_succeeded,
// customer.subscription.updated, and customer.subscription.deleted to this function URL.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (error) {
    console.error("Stripe signature verification failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Invalid signature", { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id || session.client_reference_id;
      const planId = session.metadata?.plan_id;
      const email = session.customer_details?.email || session.customer_email;
      if (!userId || !planId || !email) {
        console.error("Checkout session missing required membership metadata", session.id);
        return new Response("Missing membership metadata", { status: 400 });
      }
      const paid = session.payment_status === "paid" || (session.mode === "subscription" && session.payment_status === "no_payment_required");
      const row = {
        user_id: userId,
        email,
        plan_id: planId,
        status: paid ? "active" : "pending",
        payment_provider: "stripe",
        external_payment_id: session.id,
        stripe_checkout_session_id: session.id,
        stripe_customer_id: typeof session.customer === "string" ? session.customer : "",
        stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : "",
        updated_at: new Date().toISOString(),
      };
      const { data: existing, error: findError } = await db.from("memberships").select("id").eq("stripe_checkout_session_id", session.id).maybeSingle();
      if (findError) throw findError;
      const result = existing
        ? await db.from("memberships").update(row).eq("id", existing.id)
        : await db.from("memberships").insert(row);
      if (result.error) throw result.error;
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const status = subscription.status === "active" || subscription.status === "trialing"
        ? "active"
        : subscription.status === "canceled" ? "cancelled"
        : subscription.status === "past_due" || subscription.status === "unpaid" || subscription.status === "incomplete" ? "pending"
        : "pending";
      const { error } = await db.from("memberships").update({
        status,
        stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : "",
        stripe_subscription_id: subscription.id,
        current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", subscription.id);
      if (error) throw error;
    }
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Could not update membership from verified Stripe event", error instanceof Error ? error.message : "unknown error");
    return new Response("Could not process event", { status: 500 });
  }
});
