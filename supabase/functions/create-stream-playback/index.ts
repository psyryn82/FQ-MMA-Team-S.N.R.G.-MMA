import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}
function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
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
  if (!supabaseUrl || !serviceKey || !stripeKey || !encodedPrivate || !encodedPublic) return respond({ error: "Livepeer playback is not configured." }, 503, origin);
  if (!stripeKey.startsWith("sk_test_")) return respond({ error: "Stream playback remains locked to Stripe test mode until the end-to-end flow is verified." }, 503, origin);

  let input: { session_id?: unknown };
  try { input = await req.json(); } catch { return respond({ error: "A paid checkout session is required." }, 400, origin); }
  const sessionId = String(input.session_id || "");
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) return respond({ error: "Invalid checkout session." }, 400, origin);

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let session: Stripe.Checkout.Session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId); }
  catch { return respond({ error: "Could not verify that checkout session." }, 404, origin); }
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.metadata?.purchase_type !== "stream" || !session.metadata.stream_purchase_id) return respond({ error: "A completed, paid stream purchase is required." }, 403, origin);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: purchase, error: purchaseError } = await db.from("stream_purchases")
    .select("id,event_id,buyer_email,amount_cents,currency,status,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("id", session.metadata.stream_purchase_id).eq("status", "paid").maybeSingle();
  if (purchaseError) return respond({ error: "Could not verify stream entitlement." }, 503, origin);
  if (!purchase || purchase.stripe_checkout_session_id !== session.id || purchase.event_id !== session.metadata.event_id) return respond({ error: "No paid stream entitlement was found for that checkout." }, 403, origin);
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (session.amount_total !== purchase.amount_cents || session.currency !== String(purchase.currency || "USD").toLowerCase() || (purchase.stripe_payment_intent_id && purchase.stripe_payment_intent_id !== paymentIntent)) return respond({ error: "The payment details do not match the recorded entitlement." }, 403, origin);

  const { data: config, error: configError } = await db.from("event_streams").select("livepeer_playback_id,is_enabled").eq("event_id", purchase.event_id).maybeSingle();
  if (configError || !config?.is_enabled || !config.livepeer_playback_id) return respond({ error: "Secure Livepeer playback is not enabled for this event yet." }, 409, origin);
  const playbackId = String(config.livepeer_playback_id);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(playbackId)) return respond({ error: "The Livepeer playback ID is invalid." }, 503, origin);
  const { data: event, error: eventError } = await db.from("events").select("title,status").eq("id", purchase.event_id).maybeSingle();
  if (eventError || !event || !["upcoming", "live", "completed"].includes(event.status)) return respond({ error: "Playback is not available for this event." }, 409, origin);

  try {
    const privatePem = atob(encodedPrivate);
    const der = pemToDer(privatePem);
    const keyData = new ArrayBuffer(der.byteLength);
    new Uint8Array(keyData).set(der);
    const privateKey = await crypto.subtle.importKey("pkcs8", keyData, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", typ: "JWT" };
    const payload = { action: "pull", iss: "https://fq-snrg-mma.com", pub: encodedPublic, sub: playbackId, video: "none", exp: now + 600, iat: now };
    const signingInput = base64UrlText(JSON.stringify(header)) + "." + base64UrlText(JSON.stringify(payload));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signingInput)));
    const token = signingInput + "." + base64Url(signature);
    const playbackUrl = "https://playback.livepeer.studio/hls/" + encodeURIComponent(playbackId) + "/index.m3u8?jwt=" + encodeURIComponent(token);
    return respond({ playback_url: playbackUrl, event_title: event.title }, 200, origin);
  } catch (error) {
    console.error("Livepeer playback token creation failed", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Secure Livepeer playback could not be initialized." }, 503, origin);
  }
});