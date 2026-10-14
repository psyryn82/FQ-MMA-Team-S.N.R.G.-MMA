// Public one-time Livepeer stream checkout. This remains test-mode-only until end-to-end testing is complete.
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
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !serviceKey || !stripeKey) return respond({ error: "Stream checkout is not configured." }, 503, origin);
  if (!stripeKey.startsWith("sk_test_")) return respond({ error: "Stream checkout is locked to Stripe test mode until end-to-end testing is complete." }, 503, origin);

  let input: { event_id?: unknown; buyer_email?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Choose a stream event and enter your email." }, 400, origin); }
  const eventId = String(input.event_id || "");
  const email = String(input.buyer_email || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) return respond({ error: "Choose a valid stream event." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address for stream access." }, 400, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error: configError } = await db.from("event_streams")
    .select("id,event_id,livepeer_playback_id,stream_price_cents,currency,is_enabled")
    .eq("event_id", eventId).eq("is_enabled", true).maybeSingle();
  if (configError || !config || !config.livepeer_playback_id) return respond({ error: "Paid stream access is not available for that event yet." }, 409, origin);

  const { data: event, error: eventError } = await db.from("events")
    .select("id,title,event_date,venue,status").eq("id", eventId).maybeSingle();
  if (eventError || !event || !["upcoming", "live"].includes(event.status)) return respond({ error: "Stream checkout is not available for that event." }, 409, origin);
  if (!Number.isInteger(config.stream_price_cents) || config.stream_price_cents < 50) return respond({ error: "Stream price is not configured correctly." }, 503, origin);

  const { data: purchase, error: purchaseError } = await db.from("stream_purchases").insert({
    event_id: event.id,
    buyer_email: email,
    amount_cents: config.stream_price_cents,
    currency: config.currency || "USD",
    status: "pending",
  }).select("id").single();
  if (purchaseError || !purchase) {
    console.error("Could not create stream purchase reservation", purchaseError?.message || "unknown error");
    return respond({ error: "Could not reserve stream access. Please try again." }, 500, origin);
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const eventDetails = [event.title, event.venue, event.event_date ? new Date(event.event_date).toLocaleString("en-US", { timeZone: "UTC" }) : "Date to be announced"].filter(Boolean).join(" • ");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: purchase.id,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      success_url: siteUrl + "/watch.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/?stream_purchase=cancelled",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(config.currency || "USD").toLowerCase(),
          unit_amount: config.stream_price_cents,
          product_data: { name: event.title + " - Live Stream Access", description: eventDetails.slice(0, 500) },
        },
      }],
      metadata: { purchase_type: "stream", stream_purchase_id: purchase.id, event_id: event.id, event_stream_id: config.id },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "stream", stream_purchase_id: purchase.id, event_id: event.id, event_stream_id: config.id } },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    const { error: updateError } = await db.from("stream_purchases").update({
      stripe_checkout_session_id: session.id,
      updated_at: new Date().toISOString(),
    }).eq("id", purchase.id).eq("status", "pending");
    if (updateError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      throw new Error("Could not attach checkout to stream purchase");
    }
    return respond({ url: session.url }, 200, origin);
  } catch (error) {
    await db.from("stream_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchase.id).eq("status", "pending");
    console.error("Stream checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not start stream checkout. No payment was taken. Please try again." }, 502, origin);
  }
});
