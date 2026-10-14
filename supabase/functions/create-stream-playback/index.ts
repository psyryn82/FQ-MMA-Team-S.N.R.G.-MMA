// Entitlement-checked Cloudflare Stream playback. Stripe test mode only until the full flow is verified.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}
Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const cloudflareApiToken = Deno.env.get("CLOUDFLARE_STREAM_API_TOKEN");
  const cloudflareCustomerCode = Deno.env.get("CLOUDFLARE_STREAM_CUSTOMER_CODE") || "46irc6h95foi67cf";
  if (!supabaseUrl || !serviceKey || !stripeKey) return respond({ error: "Stream playback is not configured." }, 503, origin);
  if (!stripeKey.startsWith("sk_test_")) return respond({ error: "Stream playback is locked to test mode until end-to-end testing is complete." }, 503, origin);
  if (!cloudflareAccountId || !cloudflareApiToken || !/^[a-z0-9]+$/i.test(cloudflareCustomerCode)) return respond({ error: "Cloudflare Stream playback is not configured yet." }, 503, origin);

  let input: { session_id?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "A paid checkout session is required." }, 400, origin); }
  const sessionId = String(input.session_id || "");
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) return respond({ error: "Invalid checkout session." }, 400, origin);

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let session: Stripe.Checkout.Session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId); }
  catch { return respond({ error: "Could not verify that checkout session." }, 404, origin); }
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.metadata?.purchase_type !== "stream" || !session.metadata.stream_purchase_id) {
    return respond({ error: "A completed, paid stream purchase is required." }, 403, origin);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: purchase, error: purchaseError } = await db.from("stream_purchases")
    .select("id,event_id,buyer_email,amount_cents,currency,status,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("id", session.metadata.stream_purchase_id).eq("status", "paid").maybeSingle();
  if (purchaseError) return respond({ error: "Could not verify stream entitlement." }, 503, origin);
  if (!purchase || purchase.stripe_checkout_session_id !== session.id || purchase.event_id !== session.metadata.event_id) {
    return respond({ error: "No paid stream entitlement was found for that checkout." }, 403, origin);
  }
  const sessionPaymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (session.amount_total !== purchase.amount_cents || session.currency !== String(purchase.currency || "USD").toLowerCase() ||
      (purchase.stripe_payment_intent_id && purchase.stripe_payment_intent_id !== sessionPaymentIntent)) {
    return respond({ error: "The payment details do not match the recorded entitlement." }, 403, origin);
  }

  const { data: config, error: configError } = await db.from("event_streams")
    .select("mux_playback_id,is_enabled").eq("event_id", purchase.event_id).maybeSingle();
  if (configError || !config?.is_enabled || !config.mux_playback_id) return respond({ error: "Secure playback is not available for this event yet." }, 409, origin);
  // Legacy column name retained to avoid a destructive schema change. It now stores the Cloudflare Live Input ID.
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(config.mux_playback_id)) return respond({ error: "The Cloudflare Live Input ID is not valid." }, 503, origin);

  const { data: event, error: eventError } = await db.from("events").select("title,status").eq("id", purchase.event_id).maybeSingle();
  if (eventError || !event || !["upcoming", "live", "completed"].includes(event.status)) return respond({ error: "Playback is not available for this event." }, 409, origin);

  try {
    const tokenResponse = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(cloudflareAccountId) + "/stream/" + encodeURIComponent(config.mux_playback_id) + "/token",
      { method: "POST", headers: { "Authorization": "Bearer " + cloudflareApiToken, "Content-Type": "application/json" },
        body: JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 6 * 60 * 60, downloadable: false }) },
    );
    const tokenPayload = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || tokenPayload?.success !== true || typeof tokenPayload?.result?.token !== "string") {
      const codes = Array.isArray(tokenPayload?.errors) ? tokenPayload.errors.map((item: { code?: number }) => item.code).filter(Boolean).join(",") : "";
      console.error("Cloudflare signed playback token request failed", tokenResponse.status, codes);
      return respond({ error: "Cloudflare could not authorize playback yet. Confirm this Live Input requires signed URLs and the Stream API token has Stream edit permissions." }, 503, origin);
    }
    const token = tokenPayload.result.token;
    return respond({ playback_url: "https://customer-" + cloudflareCustomerCode + ".cloudflarestream.com/" + token + "/iframe", event_title: event.title }, 200, origin);
  } catch (error) {
    console.error("Could not request Cloudflare playback token", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Secure stream playback could not be initialized." }, 503, origin);
  }
});
