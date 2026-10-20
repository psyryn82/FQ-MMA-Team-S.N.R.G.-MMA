import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: {
    ...headers,
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
    "Vary": "Origin",
  }});
}
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlText(value: string): string { return base64Url(new TextEncoder().encode(value)); }

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
  if (!req.headers.get("apikey")) return respond({ error: "A public API key is required." }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const encodedPrivate = Deno.env.get("LIVEPEER_SIGNING_PRIVATE_KEY");
  const encodedPublic = Deno.env.get("LIVEPEER_SIGNING_PUBLIC_KEY");
  if (!supabaseUrl || !serviceKey || !stripeKey || !encodedPrivate || !encodedPublic) return respond({ error: "Secure video playback is not configured." }, 503, origin);
  const stripeIsLive = stripeKey.startsWith("sk_live_");
  if (!stripeIsLive && !stripeKey.startsWith("sk_test_")) return respond({ error: "Stripe is not configured with a valid secret key." }, 503, origin);

  let input: { media_id?: unknown; session_id?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "A paid checkout session is required." }, 400, origin); }
  const mediaId = Number(input.media_id);
  const sessionId = String(input.session_id || "").trim();
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !/^cs_(test|live)_[A-Za-z0-9_]+$/.test(sessionId)) return respond({ error: "A valid media item and checkout session are required." }, 400, origin);
  if ((stripeIsLive && !sessionId.startsWith("cs_live_")) || (!stripeIsLive && !sessionId.startsWith("cs_test_"))) return respond({ error: "Checkout session does not match the configured Stripe mode." }, 400, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: media, error: mediaError } = await db.from("media")
    .select("id,title,category,price,price_confirmed,is_published,storage_bucket,livepeer_asset_id,livepeer_playback_id,livepeer_playback_policy")
    .eq("id", mediaId).eq("is_published", true).maybeSingle();
  if (mediaError || !media || String(media.category || "").toLowerCase() !== "video" ||
      media.price_confirmed !== true || Number(media.price) <= 0 || media.storage_bucket !== "fqmma-private" ||
      !media.livepeer_asset_id || !media.livepeer_playback_id || media.livepeer_playback_policy !== "jwt" ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(String(media.livepeer_playback_id))) {
    return respond({ error: "This video is not ready for secure paid playback." }, 409, origin);
  }

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let session: Stripe.Checkout.Session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId); }
  catch { return respond({ error: "Could not verify this Stripe checkout session." }, 404, origin); }
  if (session.livemode !== stripeIsLive || session.mode !== "payment" || session.status !== "complete" ||
      session.payment_status !== "paid" || session.metadata?.purchase_type !== "media" ||
      session.metadata?.media_id !== String(mediaId)) {
    return respond({ error: "Stripe has not confirmed payment for this video." }, 403, origin);
  }

  const paidEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  if (!paidEmail) return respond({ error: "The checkout email could not be verified." }, 403, origin);
  const { data: purchase, error: purchaseError } = await db.from("media_purchases")
    .select("id,media_id,checkout_session_id,customer_email,payment_status,amount_cents,currency")
    .eq("media_id", mediaId).eq("checkout_session_id", session.id)
    .eq("customer_email", paidEmail).eq("payment_status", "paid").maybeSingle();
  if (purchaseError || !purchase || purchase.checkout_session_id !== session.id ||
      purchase.amount_cents !== session.amount_total ||
      String(purchase.currency || "usd").toLowerCase() !== String(session.currency || "").toLowerCase()) {
    return respond({ error: "The paid purchase record is not yet verified. Wait a few seconds and try again." }, 403, origin);
  }
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (purchase.payment_intent_id && purchase.payment_intent_id !== paymentIntent) return respond({ error: "The payment details do not match the recorded purchase." }, 403, origin);

  try {
    const privatePem = atob(encodedPrivate);
    const privateKey = await crypto.subtle.importKey("pkcs8", pemToDer(privatePem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", typ: "JWT" };
    const payload = { action: "pull", iss: "https://fq-snrg-mma.com", pub: encodedPublic, sub: String(media.livepeer_playback_id), video: "none", exp: now + 600, iat: now };
    const signingInput = base64UrlText(JSON.stringify(header)) + "." + base64UrlText(JSON.stringify(payload));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput)));
    const token = signingInput + "." + base64Url(signature);
    const playbackUrl = "https://playback.livepeer.studio/hls/" + encodeURIComponent(String(media.livepeer_playback_id)) + "/index.m3u8?jwt=" + encodeURIComponent(token);
    return respond({ playback_url: playbackUrl, title: media.title, expires_in: 600 }, 200, origin);
  } catch (error) {
    console.error("Secure VOD playback token creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Secure video playback could not be initialized." }, 503, origin);
  }
});
