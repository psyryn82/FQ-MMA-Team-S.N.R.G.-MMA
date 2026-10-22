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
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !serviceKey || !stripeKey) return respond({ error: "Media checkout is not configured." }, 503, origin);
  if (!stripeKey.startsWith("sk_live_") && !stripeKey.startsWith("sk_test_")) return respond({ error: "Stripe server credentials are invalid. Checkout is temporarily unavailable; no payment was taken." }, 503, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);
  let input: { media_id?: unknown; buyer_email?: unknown; accepted_terms?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Media details are required." }, 400, origin); }
  const mediaId = Number(input.media_id), email = String(input.buyer_email || "").trim().toLowerCase();
  if (input.accepted_terms !== true) return respond({ error: "Please agree to the Terms of Service and Refund Policy before checkout." }, 400, origin);
  const acceptedAt = new Date().toISOString();
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) return respond({ error: "Choose valid media." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address." }, 400, origin);
  const rateLimit = await checkoutRateLimit(req, email, supabaseUrl, serviceKey);
  if (!rateLimit.allowed) return respond({ error: rateLimit.message }, rateLimit.status, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: media, error } = await db.from("media").select("id,title,description,category,price,price_confirmed,is_published,file_path,storage_bucket").eq("id", mediaId).eq("is_published", true).maybeSingle();
  if (error || !media || media.price_confirmed !== true || Number(media.price) <= 0 || !media.file_path || media.storage_bucket !== "fqmma-private") return respond({ error: "This paid media is not available for secure checkout." }, 404, origin);
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  const expectedAmountCents = Math.round(Number(media.price) * 100);
  if (!Number.isSafeInteger(expectedAmountCents) || expectedAmountCents < 1) return respond({ error: "The configured media price is invalid." }, 409, origin);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], customer_email: email,
      success_url: siteUrl + "/?media_purchase=success&media_id=" + media.id + "&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/?media_purchase=cancelled",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(Number(media.price) * 100), product_data: { name: String(media.title).slice(0, 200), description: String(media.description || "FQ MMA digital media").slice(0, 500) } } }],
      metadata: { purchase_type: "media", media_id: String(media.id), expected_amount_cents: String(expectedAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html" },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "media", media_id: String(media.id), expected_amount_cents: String(expectedAmountCents), terms_accepted: "true", terms_version: "2026-10-21", terms_accepted_at: acceptedAt, terms_url: "https://fq-snrg-mma.com/terms.html", refund_policy_url: "https://fq-snrg-mma.com/refunds-outages.html" } }
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return respond({ url: session.url }, 200, origin);
  } catch (err) {
    console.error("Media checkout creation failed", err instanceof Error ? err.message : "unknown error");
    return respond({ error: "Could not start checkout. No payment was taken. Please try again." }, 502, origin);
  }
});