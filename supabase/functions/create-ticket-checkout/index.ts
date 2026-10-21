// FQ MMA one-time ticket checkout. Stripe mode is controlled by the server-side STRIPE_SECRET_KEY.
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) return respond({ error: "Ticket checkout is not configured." }, 503, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);

  let input: { ticket_option_id?: unknown; quantity?: unknown; buyer_email?: unknown; promotion_code?: unknown; accepted_terms?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Ticket details are required." }, 400, origin); }
  const optionId = String(input.ticket_option_id || "");
  const email = String(input.buyer_email || "").trim().toLowerCase();
  const promotionCode = String(input.promotion_code || "").trim().toUpperCase();
  const quantity = Number(input.quantity ?? 1);
  if (input.accepted_terms !== true) return respond({ error: "Please agree to the Terms of Service and Refund Policy before checkout." }, 400, origin);
  const acceptedAt = new Date().toISOString();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(optionId)) return respond({ error: "Choose a valid ticket option." }, 400, origin);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return respond({ error: "You can purchase between 1 and 10 tickets per checkout." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address for your ticket confirmation." }, 400, origin);
  const rateLimit = await checkoutRateLimit(req, email, supabaseUrl, serviceKey);
  if (!rateLimit.allowed) return respond({ error: rateLimit.message }, rateLimit.status, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: option, error: optionError } = await db.from("event_ticket_options")
    .select("id,event_id,name,description,price_cents,currency,is_available")
    .eq("id", optionId).eq("is_available", true).maybeSingle();
  if (optionError || !option?.event_id) return respond({ error: "That ticket option is not available." }, 404, origin);
  if (/\b(watch\s*live|live[- ]?stream|stream access)\b/i.test(`${option.name || ""} ${option.description || ""}`)) {
    return respond({ error: "Live-stream access must be purchased through the dedicated stream checkout. Please use the Live-stream access button on the event page." }, 409, origin);
  }
  const { data: event, error: eventError } = await db.from("events")
    .select("id,title,event_date,venue,status,is_published").eq("id", option.event_id).maybeSingle();
  if (eventError || !event || event.is_published !== true || !["upcoming", "live"].includes(event.status)) return respond({ error: "Tickets for this event are not currently available." }, 409, origin);

  const originalAmountCents = option.price_cents * quantity;
  let finalAmountCents = originalAmountCents;
  let redemptionId: string | null = null;
  if (promotionCode) {
    const { data: promo, error: promoError } = await db.rpc("reserve_promotion_redemption", {
      p_code: promotionCode, p_purchase_type: "ticket", p_event_id: event.id,
      p_customer_email: email, p_original_amount_cents: originalAmountCents,
    });
    if (promoError || !promo) return respond({ error: promoError?.message || "That promotion could not be applied." }, 400, origin);
    finalAmountCents = Number(promo.final_amount_cents);
    redemptionId = String(promo.redemption_id);
  }

  const { data: purchaseId, error: reserveError } = await db.rpc("reserve_event_ticket_purchase", {
    p_ticket_option_id: option.id, p_quantity: quantity, p_buyer_email: email,
  });
  if (reserveError || !purchaseId) {
    if (redemptionId) await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
    const message = reserveError?.message || "";
    const capacity = /not enough tickets/i.test(message);
    return respond({ error: capacity ? "There are not enough tickets left for that quantity." : "Could not reserve those tickets. Please refresh and try again." }, capacity ? 409 : 400, origin);
  }

  const { error: chargedTotalError } = await db.from("ticket_purchases")
    .update({ charged_total_cents: finalAmountCents, updated_at: new Date().toISOString() })
    .eq("id", purchaseId).eq("status", "pending");
  if (chargedTotalError) {
    await db.from("ticket_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchaseId).eq("status", "pending");
    if (redemptionId) await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
    return respond({ error: "Could not save the discounted ticket total. Please try again." }, 500, origin);
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const eventDetails = [event.title, event.venue, event.event_date ? new Date(event.event_date).toLocaleString("en-US", { timeZone: "UTC" }) : "Date to be announced"].filter(Boolean).join(" • ");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: purchaseId,
      expires_at: Math.floor(Date.now() / 1000) + 1860,
      success_url: siteUrl + "/?ticket_purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/?ticket_purchase=cancelled",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(option.currency || "USD").toLowerCase(),
          unit_amount: finalAmountCents,
          product_data: { name: option.name + " (" + quantity + (quantity === 1 ? " ticket)" : " tickets)"), description: [option.description, eventDetails, promotionCode ? "Promotion " + promotionCode : ""].filter(Boolean).join(" • ").slice(0, 500) },
        },
      }],
      metadata: { purchase_type: "ticket", ticket_purchase_id: purchaseId, ticket_option_id: option.id, event_id: event.id, expected_amount_cents: String(finalAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html", ...(redemptionId ? { promotion_redemption_id: redemptionId } : {}) },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "ticket", ticket_purchase_id: purchaseId, ticket_option_id: option.id, event_id: event.id, expected_amount_cents: String(finalAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html", ...(redemptionId ? { promotion_redemption_id: redemptionId } : {}) } },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    const { error: updateError } = await db.from("ticket_purchases").update({
      stripe_checkout_session_id: session.id,
      expires_at: new Date(session.expires_at * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", purchaseId).eq("status", "pending");
    if (updateError) {
      await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
      throw new Error("Could not attach checkout to the ticket reservation");
    }
    return respond({ url: session.url }, 200, origin);
  } catch (error) {
    await db.from("ticket_purchases").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", purchaseId).eq("status", "pending");
    if (redemptionId) await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
    console.error("Ticket checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not start checkout. No payment was taken. Please try again." }, 502, origin);
  }
});
