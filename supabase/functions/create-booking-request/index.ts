import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fq-snrg-mma.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
function response(status: number, body: Record<string, unknown>, origin?: string | null) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (origin === "https://www.fq-snrg-mma.com") headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}
function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
}
function getServiceCredential(): { key: string; legacyJwt: boolean } | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return { key: legacy, legacyJwt: true };
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.default === "string" && parsed.default) return { key: parsed.default, legacyJwt: false };
    } catch { console.error("Server database credentials could not be read."); }
  }
  return null;
}
async function hashRateLimitBucket(secret: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${secret}:${value}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(
  supabaseUrl: string,
  credential: { key: string; legacyJwt: boolean },
  bucketHash: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean | null> {
  const headers: Record<string, string> = {
    "apikey": credential.key,
    "Content-Type": "application/json",
  };
  if (credential.legacyJwt) headers["Authorization"] = `Bearer ${credential.key}`;
  const baseUrl = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl;
  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/consume_contact_form_rate_limit`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_bucket_hash: bucketHash,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      }),
    });
    if (!response.ok) {
      console.error("Contact rate-limit RPC failed with status:", response.status);
      return null;
    }
    const result = await response.json();
    return result === true;
  } catch (error) {
    console.error("Contact rate-limit RPC request failed:", error);
    return null;
  }
}


Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin === "https://www.fq-snrg-mma.com" ? origin : "https://fq-snrg-mma.com" } });
  if (origin && !["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"].includes(origin)) return response(403, { success: false, error: "Origin not allowed." }, origin);
  if (req.method !== "POST") return response(405, { success: false, error: "Method not allowed." }, origin);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return response(400, { success: false, error: "Invalid request." }, origin); }
  if (clean(input.company, 200)) return response(200, { success: true, notified: false }, origin);

  const name = clean(input.name, 120);
  const email = clean(input.email, 254);
  const phone = clean(input.phone, 40);
  const service = clean(input.service, 100);
  const date = clean(input.date, 20);
  const time = clean(input.time, 80);
  const location = clean(input.location, 250);
  const details = clean(input.details, 3000);
  if (!name || !email || !service || !details || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response(400, { success: false, error: "Please complete the required fields with a valid email address." }, origin);
  }
  if (!new Set(["Photography session", "Event photography", "Portrait session", "Video service", "Other / discuss options"]).has(service)) {
    return response(400, { success: false, error: "Please select a valid service." }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const credential = getServiceCredential();
  if (!supabaseUrl || !credential) {
    console.error("Booking request storage or rate limiting is unavailable.");
    return response(503, { success: false, error: "The booking service is temporarily unavailable. Please try again later." }, origin);
  }
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ipAddress = req.headers.get("x-real-ip")?.trim()
    || forwardedFor?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "";
  if (ipAddress) {
    const ipHash = await hashRateLimitBucket(credential.key, `ip:${ipAddress}`);
    const ipAllowed = await consumeRateLimit(supabaseUrl, credential, ipHash, 5, 900);
    if (ipAllowed === null) return response(503, { success: false, error: "The booking service is temporarily unavailable. Please try again later." }, origin);
    if (!ipAllowed) return response(429, { success: false, error: "Too many booking requests. Please wait 15 minutes before trying again." }, origin);
  }
  const emailHash = await hashRateLimitBucket(credential.key, `email:${email.toLowerCase()}`);
  const emailAllowed = await consumeRateLimit(supabaseUrl, credential, emailHash, 3, 3600);
  if (emailAllowed === null) return response(503, { success: false, error: "The booking service is temporarily unavailable. Please try again later." }, origin);
  if (!emailAllowed) return response(429, { success: false, error: "Too many booking requests from this email. Please try again in an hour." }, origin);

  const bookingId = crypto.randomUUID();
  const headers: Record<string, string> = { apikey: credential.key, "Content-Type": "application/json", Prefer: "return=minimal" };
  if (credential.legacyJwt) headers.Authorization = `Bearer ${credential.key}`;
  try {
    const saved = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/booking_requests`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: bookingId,
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        service_type: service,
        preferred_date: date || null,
        preferred_time: time,
        location,
        details,
        status: "pending"
      })
    });
    if (!saved.ok) {
      console.error("Booking request insert failed:", saved.status, await saved.text().catch(() => ""));
      return response(503, { success: false, error: "We could not save your request. Please try again later." }, origin);
    }
  } catch (error) {
    console.error("Booking request storage failed:", error);
    return response(503, { success: false, error: "We could not save your request. Please try again later." }, origin);
  }

  let notified = false;
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("CONTACT_FROM_EMAIL");
  if (apiKey && from) {
    const subject = "FQ MMA Website Inquiry: Portfolio / Photography Inquiry";
    const message = [
      "NEW SASHA PORTFOLIO BOOKING REQUEST",
      `Booking ID: ${bookingId}`,
      `Name: ${name}`,
      `Reply email: ${email}`,
      `Service: ${service}`,
      `Preferred date: ${date || "Not specified"}`,
      `Preferred time: ${time || "Not specified"}`,
      `Phone: ${phone || "Not provided"}`,
      `Location: ${location || "Not specified"}`,
      "",
      "Details:",
      details
    ].join("\n");
    const html = `<h2>New Sasha portfolio booking request</h2><p><strong>Booking ID:</strong> ${escapeHtml(bookingId)}</p><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Reply email:</strong> ${escapeHtml(email)}</p><p><strong>Service:</strong> ${escapeHtml(service)}</p><p><strong>Preferred date:</strong> ${escapeHtml(date || "Not specified")}</p><p><strong>Preferred time:</strong> ${escapeHtml(time || "Not specified")}</p><p><strong>Phone:</strong> ${escapeHtml(phone || "Not provided")}</p><p><strong>Location:</strong> ${escapeHtml(location || "Not specified")}</p><hr><p style="white-space:pre-wrap">${escapeHtml(details)}</p>`;
    try {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: ["support@fq-snrg-mma.com"], reply_to: email, subject, text: message, html })
      });
      notified = emailResponse.ok;
      if (!emailResponse.ok) console.error("Booking email notification failed:", emailResponse.status, await emailResponse.text().catch(() => ""));
    } catch (error) { console.error("Booking email notification request failed:", error); }
  } else {
    console.error("Booking saved but email notification credentials are unavailable.");
  }
  return response(200, { success: true, notified }, origin);
});
