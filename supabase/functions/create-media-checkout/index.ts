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
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const siteUrl = (Deno.env.get("SITE_URL") || "https://fq-snrg-mma.com").replace(/\/$/, "");
  if (!supabaseUrl || !serviceKey || !stripeKey) return respond({ error: "Media checkout is not configured." }, 503, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);
  let input: { media_id?: unknown; buyer_email?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "Media details are required." }, 400, origin); }
  const mediaId = Number(input.media_id), email = String(input.buyer_email || "").trim().toLowerCase();
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) return respond({ error: "Choose valid media." }, 400, origin);
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond({ error: "Enter a valid email address." }, 400, origin);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: media, error } = await db.from("media").select("id,title,description,price,is_published,file_path").eq("id", mediaId).eq("is_published", true).maybeSingle();
  if (error || !media || Number(media.price) <= 0 || !media.file_path) return respond({ error: "This paid media is not available for checkout." }, 404, origin);
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment", payment_method_types: ["card"], customer_email: email,
      success_url: siteUrl + "/?media_purchase=success&media_id=" + media.id,
      cancel_url: siteUrl + "/?media_purchase=cancelled",
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: Math.round(Number(media.price) * 100), product_data: { name: String(media.title).slice(0, 200), description: String(media.description || "FQ MMA digital media").slice(0, 500) } } }],
      metadata: { purchase_type: "media", media_id: String(media.id) },
      payment_intent_data: { receipt_email: email, metadata: { purchase_type: "media", media_id: String(media.id) } }
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return respond({ url: session.url }, 200, origin);
  } catch (err) {
    console.error("Media checkout creation failed", err instanceof Error ? err.message : "unknown error");
    return respond({ error: "Could not start checkout. No payment was taken. Please try again." }, 502, origin);
  }
});