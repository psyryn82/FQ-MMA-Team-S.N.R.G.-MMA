import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const jsonResponse = (body: unknown, status = 200, origin = "") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
      "Content-Type": "application/json",
    },
  });

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Critical environment variables are missing.");
}

// Initialize Supabase client once at module scope
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const departmentConfig: Record<string, { email: string; prefix: string; label: string }> = {
  GEN: { email: "fqsnrgmma.info@gmail.com", prefix: "[GENERAL SUPPORT]", label: "General Support" },
  EVT: { email: "fqsnrgmma.info@gmail.com", prefix: "[EVENTS & TICKETS]", label: "Events & Tickets" },
  MED: { email: "fqsnrgmma.info@gmail.com", prefix: "[MEDIA SUPPORT]", label: "Media Support" },
  FTR: { email: "fqsnrgmma.info@gmail.com", prefix: "[FIGHTERS & TEAM]", label: "Fighters & Team" },
  PAY: { email: "fqsnrgmma.info@gmail.com", prefix: "[PAYMENTS & ORDERS]", label: "Payments & Orders" },
  PHO: { email: "fqsnrgmma.info@gmail.com", prefix: "[PHOTOGRAPHY & VIDEO]", label: "Photography & Video" },
  TEC: { email: "fqsnrgmma.info@gmail.com", prefix: "[WEBSITE SUPPORT]", label: "Website Support" },
  OTH: { email: "fqsnrgmma.info@gmail.com", prefix: "[OTHER INQUIRY]", label: "Other Inquiry" },
};

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
      },
    });
  }
  if (origin && !allowedOrigins.has(origin)) {
    return jsonResponse({ error: "Origin not allowed." }, 403, origin);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { name, email, category, subject, message, reference, company } = body;

    // Quietly ignore honeypot submissions.
    if (typeof company === "string" && company.trim()) {
      return jsonResponse({ success: true }, 200, origin);
    }

    // Strict Input Validation
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.trim().length > 120) {
      return jsonResponse({ error: "Invalid or missing name." }, 400, origin);
    }
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return jsonResponse({ error: "Invalid or missing email format." }, 400, origin);
    }
    if (!category || !departmentConfig[category]) {
      return jsonResponse({ error: "Invalid or missing inquiry category." }, 400, origin);
    }
    if (!message || typeof message !== "string" || message.trim().length === 0 || message.length > 5000) {
      return jsonResponse({ error: "Invalid or missing message (max 5000 characters)." }, 400, origin);
    }

    // 1. Resolve Department Config First
    const dept = departmentConfig[category];
    const supportCategory = ["EVT", "MED", "PAY", "TEC"].includes(category);
    const sender = supportCategory
      ? "FQ MMA Support <support@fq-snrg-mma.com>"
      : "FQ MMA / Team S.N.R.G. <info@fq-snrg-mma.com>";
    const replyTo = supportCategory ? "support@fq-snrg-mma.com" : "info@fq-snrg-mma.com";

    // 2. Clean and Format Subject
    const cleanSubject = (subject && typeof subject === "string" && subject.trim().length > 0)
      ? subject.replace(/[\r\n]/g, "").slice(0, 150)
      : "New Customer Support Request";

    const formattedSubject = `${dept.prefix} ${cleanSubject}`;

    const cleanReference = (reference && typeof reference === "string" && reference.trim().length > 0)
      ? reference.replace(/[\r\n]/g, "").slice(0, 100)
      : null;

    // 3. Save Inquiry to Database
    const { data: dbData, error: dbError } = await supabase
      .from("inquiries")
      .insert([{
        name: name.trim(),
        email: email.trim().toLowerCase(),
        category,
        subject: cleanSubject,
        message: message.trim(),
        reference: cleanReference,
        status: "new",
      }])
      .select("id")
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError.message);
      return jsonResponse({ error: "Failed to record inquiry. Please try again later." }, 500, origin);
    }

    // Safe HTML Escaping for Input Data
    const safeName = escapeHtml(name.trim());
    const safeEmail = escapeHtml(email.trim());
    const safeMessage = escapeHtml(message.trim()).replace(/\n/g, "<br>");
    const safeReference = cleanReference ? escapeHtml(cleanReference) : null;

    // 4. Dispatch Emails Concurrently via Resend
    const internalEmailPromise = fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: sender,
        to: [dept.email],
        reply_to: email.trim(),
        subject: formattedSubject,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"></head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #121212; color: #f8f9fa;">
            <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
              New customer inquiry from ${safeName} regarding ${dept.label}.
            </div>
            <div style="padding: 24px; border-radius: 8px;">
              <h2 style="color: #ffb703; border-bottom: 1px solid #333; padding-bottom: 12px;">New Inquiry: ${dept.label}</h2>
              <p><strong>Name:</strong> ${safeName}</p>
              <p><strong>Email:</strong> ${safeEmail}</p>
              ${safeReference ? `<p><strong>Reference / Order ID:</strong> ${safeReference}</p>` : ""}
              <p><strong>Message:</strong></p>
              <blockquote style="background: #1a1a1a; border-left: 4px solid #ffb703; padding: 12px; margin: 12px 0; color: #ddd;">
                ${safeMessage}
              </blockquote>
              <p style="font-size: 11px; color: #777; margin-top: 20px;">Inquiry ID: ${dbData.id}</p>
            </div>
          </body>
          </html>
        `,
      }),
    });

    const customerEmailPromise = fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: sender,
        reply_to: replyTo,
        to: [email.trim()],
        subject: `${dept.prefix} We Received Your Message`,
        html: `
          <!DOCTYPE html>
          <html>
          <head><meta charset="utf-8"></head>
          <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #121212; color: #f8f9fa;">
            <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #fff; opacity: 0;">
              We have received your message regarding ${dept.label}. Our team will review it shortly.
            </div>
            <div style="padding: 24px; border-radius: 8px;">
              <h2 style="color: #ffb703;">Thank You, ${safeName}</h2>
              <p>We have successfully received your inquiry regarding <strong>${dept.label}</strong>.</p>
              <p>Our team will review your message and reply back to you shortly.</p>
              <hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;">
              <p style="font-size: 12px; color: #888;">Note: Never send full payment card details or passwords via email. Fitness Quest MMA Support.</p>
            </div>
          </body>
          </html>
        `,
      }),
    });

    const [internalRes, customerRes] = await Promise.all([internalEmailPromise, customerEmailPromise]);

    const emailSent = internalRes.ok && customerRes.ok;
    if (!emailSent) {
      console.error("Resend delivery warning: one or more inquiry emails failed.", {
        internalStatus: internalRes.status,
        customerStatus: customerRes.status,
        inquiryId: dbData.id,
      });
    }

    // Only mark delivery complete when both messages were accepted by Resend.
    const { error: deliveryUpdateError } = await supabase
      .from("inquiries")
      .update({ email_sent: emailSent })
      .eq("id", dbData.id);
    if (deliveryUpdateError) {
      console.error("Could not update inquiry email_sent flag:", deliveryUpdateError.message);
    }

    // The inquiry is safely recorded even if an email notification needs follow-up.
    return jsonResponse({
      success: true,
      inquiryId: dbData.id,
      emailSent: emailSent && !deliveryUpdateError,
      message: emailSent && !deliveryUpdateError
        ? "Your message was received."
        : "Your message was saved, but email notifications may be delayed.",
    }, 200, origin);

  } catch (error) {
    console.error("Edge function unexpected error:", error);
    return jsonResponse({ error: "An unexpected error occurred while processing your request." }, 500, origin);
  }
});