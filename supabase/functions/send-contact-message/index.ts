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

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] || char);
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
  if (cleanText(input.company, 200)) {
    return jsonResponse(200, { success: true }, origin);
  }

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
