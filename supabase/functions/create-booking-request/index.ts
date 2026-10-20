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
async function verifyTurnstile(token: string, action: string, remoteIp: string): Promise<"valid" | "invalid" | "unavailable"> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) { console.error("Turnstile server verification secret is missing."); return "unavailable"; }
  if (!token) return "invalid";
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp) form.set("remoteip", remoteIp);
    const resultResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!resultResponse.ok) return "unavailable";
    const result = await resultResponse.json();
    return result.success === true
      && new Set(["fq-snrg-mma.com", "www.fq-snrg-mma.com"]).has(String(result.hostname || ""))
      && result.action === action ? "valid" : "invalid";
  } catch (error) {
    console.error("Turnstile verification request failed:", error);
    return "unavailable";
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

  const remoteIp = req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "";
  const turnstileStatus = await verifyTurnstile(clean(input.turnstileToken, 4096), "booking", remoteIp);
  if (turnstileStatus === "unavailable") return response(503, { success: false, error: "The security check is temporarily unavailable. Please try again later." }, origin);
  if (turnstileStatus !== "valid") return response(400, { success: false, error: "Please complete the security check and try again." }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const credential = getServiceCredential();
  if (!supabaseUrl || !credential) {
    console.error("Booking request storage is unavailable.");
    return response(503, { success: false, error: "The booking service is temporarily unavailable. Please try again later." }, origin);
  }
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
        body: JSON.stringify({ from, to: ["fqsnrgmma.info@gmail.com"], reply_to: email, subject, text: message, html })
      });
      notified = emailResponse.ok;
      if (!emailResponse.ok) console.error("Booking email notification failed:", emailResponse.status, await emailResponse.text().catch(() => ""));
    } catch (error) { console.error("Booking email notification request failed:", error); }
  } else {
    console.error("Booking saved but email notification credentials are unavailable.");
  }
  return response(200, { success: true, notified }, origin);
});
