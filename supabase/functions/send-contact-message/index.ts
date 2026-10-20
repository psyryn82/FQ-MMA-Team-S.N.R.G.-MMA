import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fq-snrg-mma.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function jsonResponse(status: number, body: Record<string, unknown>, origin?: string | null) {
  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  if (origin === "https://www.fq-snrg-mma.com") headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

async function verifyTurnstile(token: string, action: string, remoteIp: string): Promise<"valid" | "invalid" | "unavailable"> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) { console.error("Turnstile server verification secret is missing."); return "unavailable"; }
  if (!token) return "invalid";
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (remoteIp) form.set("remoteip", remoteIp);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!response.ok) return "unavailable";
    const result = await response.json();
    return result.success === true
      && new Set(["fq-snrg-mma.com", "www.fq-snrg-mma.com"]).has(String(result.hostname || ""))
      && result.action === action ? "valid" : "invalid";
  } catch (error) { console.error("Turnstile verification request failed:", error); return "unavailable"; }
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
}


function getSupabaseServiceCredential(): { key: string; legacyJwt: boolean } | null {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return { key: legacy, legacyJwt: true };
  const rawSecretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (rawSecretKeys) {
    try {
      const parsed = JSON.parse(rawSecretKeys);
      if (typeof parsed.default === "string" && parsed.default) {
        return { key: parsed.default, legacyJwt: false };
      }
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON.");
    }
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
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": origin === "https://www.fq-snrg-mma.com"
          ? origin
          : "https://fq-snrg-mma.com",
      },
    });
  }
  if (origin && !["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"].includes(origin)) {
    return jsonResponse(403, { success: false, error: "Origin not allowed." });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { success: false, error: "Method not allowed." }, origin);
  }

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return jsonResponse(400, { success: false, error: "Invalid request." }, origin);
  }

  // Quietly accept honeypot submissions without forwarding spam.
  if (cleanText(input.company, 200)) return jsonResponse(200, { success: true }, origin);

  const ipAddress = req.headers.get("cf-connecting-ip")?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || req.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
    || "";
  const turnstileStatus = await verifyTurnstile(cleanText(input.turnstileToken, 4096), "contact", ipAddress);
  if (turnstileStatus === "unavailable") return jsonResponse(503, { success: false, error: "The security check is temporarily unavailable. Please try again later." }, origin);
  if (turnstileStatus !== "valid") return jsonResponse(400, { success: false, error: "Please complete the security check and try again." }, origin);

  const name = cleanText(input.name, 120);
  const email = cleanText(input.email, 254);
  const category = cleanText(input.category, 100);
  const message = cleanText(input.message, 5000);
  const allowedCategories = new Set([
    "General Inquiry",
    "Media Purchase Inquiry",
    "Portfolio / Photography Inquiry",
    "Fighter / Athlete Inquiry",
    "Ticket / Stream Access Inquiry",
    "Website Support",
  ]);

  if (!name || !email || !category || !message) {
    return jsonResponse(400, { success: false, error: "Please complete every field." }, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { success: false, error: "Please provide a valid email address." }, origin);
  }
  if (!allowedCategories.has(category)) {
    return jsonResponse(400, { success: false, error: "Invalid inquiry category." }, origin);
  }


  // Server-side limits: 5 requests per IP per 15 minutes, plus 3 per sender email per hour.
  // Hash identifiers with a server-only secret so raw IPs/emails are never stored in the limiter table.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceCredential = getSupabaseServiceCredential();
  if (!supabaseUrl || !serviceCredential) {
    console.error("Contact rate limiting is unavailable: Supabase URL or server credential is missing.");
    return jsonResponse(503, { success: false, error: "The contact form is temporarily unavailable. Please try again later." }, origin);
  }

  if (ipAddress) {
    const ipHash = await hashRateLimitBucket(serviceCredential.key, `ip:${ipAddress}`);
    const ipAllowed = await consumeRateLimit(supabaseUrl, serviceCredential, ipHash, 5, 900);
    if (ipAllowed === null) {
      return jsonResponse(503, { success: false, error: "The contact form is temporarily unavailable. Please try again later." }, origin);
    }
    if (!ipAllowed) {
      return jsonResponse(429, { success: false, error: "Too many messages have been sent. Please wait 15 minutes before trying again." }, origin);
    }
  }

  const emailHash = await hashRateLimitBucket(serviceCredential.key, `email:${email.toLowerCase()}`);
  const emailAllowed = await consumeRateLimit(supabaseUrl, serviceCredential, emailHash, 3, 3600);
  if (emailAllowed === null) {
    return jsonResponse(503, { success: false, error: "The contact form is temporarily unavailable. Please try again later." }, origin);
  }
  if (!emailAllowed) {
    return jsonResponse(429, { success: false, error: "Too many messages were sent from this email address. Please try again in an hour." }, origin);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("CONTACT_FROM_EMAIL");
  if (!apiKey || !from) {
    console.error("Contact email service is not configured: RESEND_API_KEY or CONTACT_FROM_EMAIL is missing.");
    return jsonResponse(503, {
      success: false,
      error: "Contact email service is not configured (RESEND_API_KEY / CONTACT_FROM_EMAIL).",
    }, origin);
  }

  const subject = `FQ MMA Website Inquiry: ${category}`;
  const textBody = [
    "New message from the FQ MMA / Team S.N.R.G. MMA website",
    "",
    `Name: ${name}`,
    `Reply email: ${email}`,
    `Inquiry type: ${category}`,
    "",
    "Message:",
    message,
  ].join("\n");
  const htmlBody = `<h2>New website inquiry</h2><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Reply email:</strong> ${escapeHtml(email)}</p><p><strong>Inquiry type:</strong> ${escapeHtml(category)}</p><hr><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: ["fqsnrgmma.info@gmail.com"],
        reply_to: email,
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Resend rejected contact email:", response.status, result);
      return jsonResponse(502, { success: false, error: "The email provider could not deliver your message." }, origin);
    }
    return jsonResponse(200, { success: true }, origin);
  } catch (error) {
    console.error("Contact email request failed:", error);
    return jsonResponse(502, { success: false, error: "Could not reach the email provider." }, origin);
  }
});
