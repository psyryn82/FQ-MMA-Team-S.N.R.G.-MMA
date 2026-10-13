// Supabase Edge Function: create-checkout-session
// Deploy with: supabase functions deploy create-checkout-session
// Set secrets: STRIPE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, SITE_URL
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const allowedOrigins = new Set([
  "https://fq-snrg-mma.com",
  "https://www.fq-snrg-mma.com",
]);
function response(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
      "Vary": "Origin",
    },
  });
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return response({ error: "Origin not allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) return response({ error: "Payment service is not configured. Ask an administrator to set the Edge Function secrets." }, 503, origin);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return response({ error: "Please sign in before purchasing a ticket." }, 401, origin);
  const token = authorization.slice("Bearer ".length);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user?.email) return response({ error: "Your sign-in session could not be verified." }, 401, origin);

  let planId = "";
  try { planId = String((await req.json()).plan_id || ""); } catch { return response({ error: "A ticket option is required." }, 400, origin); }
  if (!planId) return response({ error: "A ticket option is required." }, 400, origin);

  const adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: plan, error: planError } = await adminDb.from("membership_plans").select("id,name,description,price_cents,currency,billing_interval,is_published").eq("id", planId).eq("is_published", true).maybeSingle();
  if (planError || !plan) return response({ error: "That ticket option is unavailable." }, 404, origin);
  if (!Number.isInteger(plan.price_cents) || plan.price_cents < 0 || !/^[A-Z]{3}$/i.test(plan.currency || "")) return response({ error: "The selected plan has invalid pricing configuration." }, 400, origin);

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1" as Stripe.LatestApiVersion, httpClient: Stripe.createFetchHttpClient() });
    const isSubscription = plan.billing_interval === "month" || plan.billing_interval === "year";
    const lineItem: Record<string, unknown> = {
      quantity: 1,
      price_data: {
        currency: plan.currency.toLowerCase(),
        unit_amount: plan.price_cents,
        product_data: { name: plan.name, description: plan.description || "FQ MMA live-stream ticket" },
        ...(isSubscription ? { recurring: { interval: plan.billing_interval } } : {}),
      },
    };
    const session = await stripe.checkout.sessions.create({
      ui_mode: "custom",
      mode: isSubscription ? "subscription" : "payment",
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      ...(isSubscription ? { payment_method_collection: "always" as const } : {}),
      submit_type: "pay",
      name_collection: { individual: { enabled: true, optional: true } },
      saved_payment_method_options: { payment_method_save: "enabled" },
      integration_identifier: "custom_embedded_web_0001",
      line_items: [lineItem as Stripe.Checkout.SessionCreateParams.LineItem],
    });

    const { error: saveError } = await adminDb.from("memberships").insert({
      user_id: userData.user.id,
      email: userData.user.email,
      plan_id: plan.id,
      status: "pending",
      payment_provider: "stripe",
      external_payment_id: session.id,
      stripe_checkout_session_id: session.id,
      stripe_customer_id: typeof session.customer === "string" ? session.customer : "",
      stripe_subscription_id: typeof session.subscription === "string" ? session.subscription : "",
    });
    if (saveError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      console.error("Could not create pending membership record", saveError.message);
      return response({ error: "Could not start the ticket purchase. Please try again." }, 500, origin);
    }
    if (!session.client_secret) return response({ error: "Stripe did not return a Checkout Form client secret." }, 502, origin);
    return response({ client_secret: session.client_secret }, 200, origin);
  } catch (error) {
    console.error("Stripe checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return response({ error: "Could not create checkout. Please try again later." }, 502, origin);
  }
});
