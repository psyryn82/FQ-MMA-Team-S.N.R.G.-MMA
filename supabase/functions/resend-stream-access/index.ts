import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fq-snrg-mma.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function respond(status: number, body: Record<string, unknown>, origin?: string | null) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (origin === "https://www.fq-snrg-mma.com") headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}
function cleanEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
function getSupabaseServiceCredential(): { key: string; legacyJwt: boolean } | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return { key: legacy, legacyJwt: true };
  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (rawSecretKeys) {
    try {
      const parsed = JSON.parse(rawSecretKeys);
      if (typeof parsed.default === "string" && parsed.default) return { key: parsed.default, legacyJwt: false };
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON.");
    }
  }
  return null;
}
async function hashRateLimitBucket(secret: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${value}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function consumeRateLimit(
  supabaseUrl: string,
  credential: { key: string; legacyJwt: boolean },
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean | null> {
  const headers: Record<string, string> = { apikey: credential.key, "Content-Type": "application/json" };
  if (credential.legacyJwt) headers.Authorization = `Bearer ${credential.key}`;
  const baseUrl = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/consume_contact_form_rate_limit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_bucket_hash: await hashRateLimitBucket(credential.key, bucket),
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (!response.ok) {
      console.error("Stream recovery rate-limit RPC failed with status:", response.status);
      return null;
    }
    return await response.json() === true;
  } catch (error) {
    console.error("Stream recovery rate-limit RPC request failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

const genericMessage = "If that email has a paid pass, we've sent the link.";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": origin === "https://www.fq-snrg-mma.com" ? origin : "https://fq-snrg-mma.com",
      },
    });
  }
  if (origin && !allowedOrigins.has(origin)) return respond(403, { success: false, error: "Origin not allowed." });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed." }, origin);
  if (!req.headers.get("apikey")) return respond(401, { success: false, error: "A public API key is required." }, origin);

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return respond(400, { success: false, error: "Invalid request." }, origin);
  }
  const email = cleanEmail(input.email);
  const eventId = typeof input.event_id === "string" ? input.event_id.trim() : "";
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return respond(400, { success: false, error: "Enter a valid email address." }, origin);
  }
  if (!uuidPattern.test(eventId)) return respond(400, { success: false, error: "Choose a valid event." }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const credential = getSupabaseServiceCredential();
  if (!supabaseUrl || !credential) {
    console.error("Stream recovery is unavailable: Supabase URL or server credential is missing.");
    return respond(503, { success: false, error: "Stream recovery is temporarily unavailable. Please try again later." }, origin);
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const ipAddress = req.headers.get("x-real-ip")?.trim()
    || forwardedFor?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "";
  if (ipAddress) {
    const ipAllowed = await consumeRateLimit(supabaseUrl, credential, `stream-recovery-ip:${ipAddress}`, 5, 900);
    if (ipAllowed === null) return respond(503, { success: false, error: "Stream recovery is temporarily unavailable. Please try again later." }, origin);
    if (!ipAllowed) return respond(429, { success: false, error: "Too many requests. Please wait 15 minutes before trying again." }, origin);
  }
  const emailAllowed = await consumeRateLimit(supabaseUrl, credential, `stream-recovery-email:${email}`, 3, 3600);
  if (emailAllowed === null) return respond(503, { success: false, error: "Stream recovery is temporarily unavailable. Please try again later." }, origin);
  if (!emailAllowed) return respond(429, { success: false, error: "Too many requests. Please wait before trying again." }, origin);

  try {
    const db = createClient(supabaseUrl, credential.key, { auth: { persistSession: false, autoRefreshToken: false } });
    const escapedEmail = email.replace(/[\\%_]/g, "\\$&");
    const { data: purchase, error: purchaseError } = await db.from("stream_purchases")
      .select("id,event_id,buyer_email,stripe_checkout_session_id,created_at")
      .ilike("buyer_email", escapedEmail)
      .eq("event_id", eventId)
      .eq("status", "paid")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (purchaseError) {
      console.error("Could not look up paid stream purchase for recovery:", purchaseError.message);
      return respond(200, { success: true, message: genericMessage }, origin);
    }
    if (!purchase || !purchase.stripe_checkout_session_id || !/^cs_(test|live)_[A-Za-z0-9_]+$/.test(purchase.stripe_checkout_session_id)) {
      return respond(200, { success: true, message: genericMessage }, origin);
    }

    const buyerEmail = cleanEmail(purchase.buyer_email || email);
    if (!emailPattern.test(buyerEmail)) {
      console.error("Stream recovery skipped: paid purchase has no valid buyer email", purchase.id);
      return respond(200, { success: true, message: genericMessage }, origin);
    }

    let eventTitle = "Fight Quest XVI";
    let eventDate = "Date and time to be announced";
    const { data: eventDetails, error: eventDetailsError } = await db.from("events")
      .select("title,event_date").eq("id", purchase.event_id).maybeSingle();
    if (eventDetailsError) {
      console.error("Could not load event details for stream recovery", purchase.id, eventDetailsError.message);
    } else if (eventDetails) {
      if (eventDetails.title) eventTitle = String(eventDetails.title);
      if (eventDetails.event_date) {
        const parsedDate = new Date(eventDetails.event_date);
        if (!Number.isNaN(parsedDate.getTime())) {
          eventDate = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZoneName: "short",
          }).format(parsedDate);
        }
      }
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("Stream recovery email skipped: RESEND_API_KEY is not configured", purchase.id);
      return respond(200, { success: true, message: genericMessage }, origin);
    }
    const watchLink = "https://fq-snrg-mma.com/watch.html?session_id=" + encodeURIComponent(purchase.stripe_checkout_session_id);
    const safeTitle = escapeHtml(eventTitle);
    const safeDate = escapeHtml(eventDate);
    const safeLink = escapeHtml(watchLink);
    const from = Deno.env.get("CONTACT_FROM_EMAIL") || "FQ MMA <downloads@fq-snrg-mma.com>";
    const emailBody = {
      from,
      to: [buyerEmail],
      reply_to: "support@fq-snrg-mma.com",
      subject: "Your Fight Quest XVI live stream access",
      text: "Your live stream access for " + eventTitle + "\nEvent date and time: " + eventDate + " (America/Los_Angeles).\n\nWatch your live stream: " + watchLink + "\n\nThis pass is live-only and includes no replay. Don't share this link.\n\nFor help, contact support@fq-snrg-mma.com.",
      html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#222\"><h2>Your Fight Quest XVI live stream access</h2><p>Your access is for <strong>" + safeTitle + "</strong>.</p><p><strong>Event date and time:</strong> " + safeDate + " (America/Los_Angeles).</p><p><a href=\"" + safeLink + "\" style=\"display:inline-block;background:#c62828;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold\">Watch the live stream</a></p><p>This pass is live-only and includes no replay. <strong>Don't share this link.</strong></p><p>For help, contact <a href=\"mailto:support@fq-snrg-mma.com\">support@fq-snrg-mma.com</a>.</p></div>",
    };
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + resendKey,
          "Content-Type": "application/json",
          "Idempotency-Key": "stream-access-recovery-" + purchase.id + "-" + crypto.randomUUID(),
        },
        body: JSON.stringify(emailBody),
      });
      if (!emailResponse.ok) {
        const detail = await emailResponse.text().catch(() => "");
        console.error("Resend rejected recovered stream access email", purchase.id, emailResponse.status, detail.slice(0, 500));
      }
    } catch (error) {
      console.error("Stream recovery email request failed", purchase.id, error instanceof Error ? error.message : "unknown error");
    }
    return respond(200, { success: true, message: genericMessage }, origin);
  } catch (error) {
    console.error("Stream access recovery failed", error instanceof Error ? error.message : "unknown error");
    return respond(200, { success: true, message: genericMessage }, origin);
  }
});
