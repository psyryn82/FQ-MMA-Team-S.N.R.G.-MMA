// Entitlement-checked signed Mux playback. Stripe test mode only until the full flow is verified.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = { "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" } });
}
function base64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function privateKeyDer(rawValue: string): Uint8Array {
  let pem = rawValue.replace(/\\n/g, "\n").trim();
  if (!pem.includes("-----BEGIN")) {
    try {
      const decoded = atob(pem);
      if (decoded.includes("-----BEGIN")) pem = decoded;
      else pem = "-----BEGIN PRIVATE KEY-----\n" + (pem.match(/.{1,64}/g) || []).join("\n") + "\n-----END PRIVATE KEY-----";
    } catch {
      pem = "-----BEGIN PRIVATE KEY-----\n" + (pem.match(/.{1,64}/g) || []).join("\n") + "\n-----END PRIVATE KEY-----";
    }
  }
  const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (!match) throw new Error("Mux signing private key must be PKCS#8 PEM or its base64-encoded form.");
  const base64 = match[1].replace(/\s/g, "");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
async function signPlaybackToken(playbackId: string, purchaseId: string, keyId: string, privateKeyValue: string): Promise<string> {
  const der = privateKeyDer(privateKeyValue);
  const keyData = new ArrayBuffer(der.byteLength);
  new Uint8Array(keyData).set(der);
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
  const payload = base64Url(JSON.stringify({ sub: playbackId, aud: "v", exp: now + 6 * 60 * 60, kid: keyId, custom: { purchase_id: purchaseId } }));
  const unsigned = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  return unsigned + "." + base64Url(signature);
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
  const signingKeyId = Deno.env.get("MUX_SIGNING_KEY");
  const signingPrivateKey = Deno.env.get("MUX_PRIVATE_KEY");
  if (!supabaseUrl || !serviceKey || !stripeKey) return respond({ error: "Stream playback is not configured." }, 503, origin);
  if (!stripeKey.startsWith("sk_test_")) return respond({ error: "Stream playback is locked to test mode until end-to-end testing is complete." }, 503, origin);
  if (!signingKeyId || !signingPrivateKey) return respond({ error: "Secure stream playback is not configured yet." }, 503, origin);

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
  if (!/^[A-Za-z0-9_-]+$/.test(config.mux_playback_id)) return respond({ error: "The event playback ID is not valid." }, 503, origin);

  const { data: event, error: eventError } = await db.from("events").select("title,status").eq("id", purchase.event_id).maybeSingle();
  if (eventError || !event || !["upcoming", "live", "completed"].includes(event.status)) return respond({ error: "Playback is not available for this event." }, 409, origin);

  try {
    const token = await signPlaybackToken(config.mux_playback_id, purchase.id, signingKeyId, signingPrivateKey);
    return respond({ playback_url: "https://stream.mux.com/" + config.mux_playback_id + ".m3u8?token=" + token, event_title: event.title }, 200, origin);
  } catch (error) {
    console.error("Could not sign Mux playback token", error instanceof Error ? error.message : "unknown error");
    return respond({ error: "Secure stream playback could not be initialized." }, 503, origin);
  }
});
