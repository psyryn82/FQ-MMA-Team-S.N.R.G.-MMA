// FQ MMA one-time ticket checkout. This endpoint intentionally rejects live Stripe keys until testing is complete.
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !anonKey || !serviceKey || !stripeKey) return respond({ error: "Ticket checkout is not configured." }, 503, origin);
  if (req.headers.get("apikey") !== anonKey) return respond({ error: "A valid public API key is required." }, 401, origin);
  if (!stripeKey.startsWith("sk_test_")) return respond({ error: "Ticket checkout is locked to Stripe test mode until end-to-end testing is complete." }, 503, origin);

  let input: { ticket_option_id?: unknown; quantity?: unknown; buyer_email?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Ticket details are required." }, 400, origin); }
  const optionId = String(input.ticket_option_id || "");
  const email = String(input.buyer_email || "").trim().toLowerCase();
  const quantity = Number(input.quantity ?? 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(optionId)) return respond({ error: "Choose a valid ticket option." }, 400, origin);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return respond({ error: "You can purchase between 1 and 10 tickets per checkout." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address for your ticket confirmation." }, 400, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: option, error: optionError } = await db.from("event_ticket_options")
    .select("id,event_id,name,description,price_cents,currency,is_available")
    .eq("id", optionId).eq("is_available", true).maybeSingle();
  if (optionError || !option?.event_id) return respond({ error: "That ticket option is not available." }, 404, origin);
  const { data: event, error: eventError } = await db.from("events")
    .select("id,title,event_date,venue,status").eq("id", option.event_id).maybeSingle();
  if (eventError || !event || !["upcoming", "live"].includes(event.status)) return respond({ error: "Tickets for this event are not currently available." }, 409, origin);

  const { data: purchaseId, error: reserveError } = await db.rpc("reserve_event_ticket_purchase", {
    p_ticket_option_id: option.id, p_quantity: quantity, p_buyer_email: email,
  });
  if (reserveError || !purchaseId) {
    const message = reserveError?.message || "";
    const capacity = /not enough tickets/i.test(message);
    return respond({ error: capacity ? "There are not enough tickets left for that quantity." : "Could not reserve those tickets. Please refresh and try again." }, capacity ? 409 : 400, origin);
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const eventDetails = [event.title, event.venue, event.event_date ? new Date(event.event_date).toLocaleString("en-US", { timeZone: "UTC" }) : "Date to be announced"].filter(Boolean).join(" • ");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      client_reference_id: purchaseId,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      success_url: siteUrl + "/?ticket_purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/?ticket_purchase=cancelled",
      line_items: [{
        quantity,
        price_data: {
          currency: String(option.currency || "USD").toLowerCase(),
          unit_amount: option.price_cents,
          product_data: { name: option.name, description: [option.description, eventDetails].filter(Boolean).join(" • ").slice(0, 500) },
        },
      }],
      metadata: { purchase_type: "ticket", ticket_purchase_id: purchaseId, ticket_option_id: option.id, event_id: event.id },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "ticket", ticket_purchase_id: purchaseId, ticket_option_id: option.id, event_id: event.id } },
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
    console.error("Ticket checkout creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Could not start checkout. No payment was taken. Please try again." }, 502, origin);
  }
});
