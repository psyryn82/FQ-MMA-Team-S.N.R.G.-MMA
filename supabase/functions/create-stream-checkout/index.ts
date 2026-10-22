// Public one-time Livepeer stream checkout. Stripe mode is controlled by the server-side STRIPE_SECRET_KEY.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}


async function checkoutRateLimit(req: Request, email: string, supabaseUrl: string, serviceKey: string): Promise<{ allowed: boolean; status: number; message: string }> {
  const hashBucket = async (value: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${serviceKey}:${value}`));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  };
  const consume = async (value: string, limit: number, windowSeconds: number): Promise<boolean | null> => {
    try {
      const response = await fetch(`${supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl}/rest/v1/rpc/consume_contact_form_rate_limit`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_bucket_hash: await hashBucket(value), p_limit: limit, p_window_seconds: windowSeconds })
      });
      if (!response.ok) return null;
      return await response.json() === true;
    } catch { return null; }
  };
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = req.headers.get("x-real-ip")?.trim() || forwarded?.split(",").map(v => v.trim()).filter(Boolean).at(-1) || "";
  if (ip) {
    const ipAllowed = await consume(`checkout-ip:${ip}`, 10, 900);
    if (ipAllowed === null) return { allowed: false, status: 503, message: "Checkout is temporarily unavailable. Please try again later." };
    if (!ipAllowed) return { allowed: false, status: 429, message: "Too many checkout attempts. Please wait 15 minutes before trying again." };
  }
  const emailAllowed = await consume(`checkout-email:${email.toLowerCase()}`, 5, 3600);
  if (emailAllowed === null) return { allowed: false, status: 503, message: "Checkout is temporarily unavailable. Please try again later." };
  if (!emailAllowed) return { allowed: false, status: 429, message: "Too many checkout attempts for this email. Please try again in an hour." };
  return { allowed: true, status: 200, message: "" };
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
  if (!/^(?:sk|rk)_(?:live|test)_/.test(stripeKey)) return respond({ error: "Stripe server credentials are invalid. Checkout is temporarily unavailable; no payment was taken." }, 503, origin);

  let input: { event_id?: unknown; buyer_email?: unknown; promotion_code?: unknown; accepted_terms?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Choose a stream event and enter your email." }, 400, origin); }
  const eventId = String(input.event_id || "");
  const email = String(input.buyer_email || "").trim().toLowerCase();
  const promotionCode = String(input.promotion_code || "").trim().toUpperCase();
  if (input.accepted_terms !== true) return respond({ error: "Please agree to the Terms of Service and Refund Policy before checkout." }, 400, origin);
  const acceptedAt = new Date().toISOString();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) return respond({ error: "Choose a valid stream event." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address for stream access." }, 400, origin);
  const rateLimit = await checkoutRateLimit(req, email, supabaseUrl, serviceKey);
  if (!rateLimit.allowed) return respond({ error: rateLimit.message }, rateLimit.status, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: config, error: configError } = await db.from("event_streams")
    .select("id,event_id,livepeer_playback_id,stream_price_cents,currency,is_enabled")
    .eq("event_id", eventId).eq("is_enabled", true).maybeSingle();
  if (configError || !config || !config.livepeer_playback_id) return respond({ error: "Paid stream access is not available for that event yet." }, 409, origin);

  const { data: event, error: eventError } = await db.from("events")
    .select("id,title,event_date,venue,main_event,description,status,is_published").eq("id", eventId).maybeSingle();
  if (eventError || !event || event.is_published !== true || !["upcoming", "live"].includes(event.status)) return respond({ error: "Stream checkout is not available for that event." }, 409, origin);
  if (!Number.isInteger(config.stream_price_cents) || config.stream_price_cents < 0) return respond({ error: "Stream price is not configured correctly." }, 503, origin);
  if (config.stream_price_cents === 0) return respond({ free_url: siteUrl + "/watch.html?free_event_id=" + encodeURIComponent(event.id), free: true }, 200, origin);

  let finalAmountCents = config.stream_price_cents;
  let redemptionId: string | null = null;
  if (promotionCode) {
    const { data: promo, error: promoError } = await db.rpc("reserve_promotion_redemption", {
      p_code: promotionCode, p_purchase_type: "stream", p_event_id: event.id,
      p_customer_email: email, p_original_amount_cents: config.stream_price_cents,
    });
    if (promoError || !promo) return respond({ error: promoError?.message || "That promotion could not be applied." }, 400, origin);
    finalAmountCents = Number(promo.final_amount_cents);
    redemptionId = String(promo.redemption_id);
  }

  const { data: purchase, error: purchaseError } = await db.from("stream_purchases").insert({
    event_id: event.id,
    buyer_email: email,
    amount_cents: finalAmountCents,
    currency: config.currency || "USD",
    status: "pending",
  }).select("id").single();
  if (purchaseError || !purchase) {
    if (redemptionId) await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
    console.error("Could not create stream purchase reservation", purchaseError?.message || "unknown error");
    return respond({ error: "Could not reserve stream access. Please try again." }, 500, origin);
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const eventDetails = [event.title, event.venue, event.event_date ? new Date(event.event_date).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Date to be announced", event.main_event, event.description].filter(Boolean).join(" • ");
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
          unit_amount: finalAmountCents,
          product_data: { name: event.title + " - Live Stream Access", description: [eventDetails, promotionCode ? "Promotion " + promotionCode : ""].filter(Boolean).join(" • ").slice(0, 500) },
        },
      }],
      metadata: { purchase_type: "stream", stream_purchase_id: purchase.id, event_id: event.id, event_stream_id: config.id, expected_amount_cents: String(finalAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html", ...(redemptionId ? { promotion_redemption_id: redemptionId } : {}) },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "stream", stream_purchase_id: purchase.id, event_id: event.id, event_stream_id: config.id, expected_amount_cents: String(finalAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html", ...(redemptionId ? { promotion_redemption_id: redemptionId } : {}) } },
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
    if (redemptionId) await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
    console.error("Stream checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not start stream checkout. No payment was taken. Please try again." }, 502, origin);
  }
});