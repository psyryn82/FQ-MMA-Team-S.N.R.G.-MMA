import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const json = (status: number, body: Record<string, unknown>, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
    "Vary": "Origin"
  }
});
const clean = (v: unknown, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] || c));

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return json(200, { ok: true }, origin);
  if (req.method !== "POST") return json(405, { error: "Method not allowed." }, origin);
  if (origin && !allowedOrigins.has(origin)) return json(403, { error: "Origin not allowed." }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = "FQ MMA Support <support@fq-snrg-mma.com>";
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!supabaseUrl || !serviceKey || !resendKey || !token) return json(503, { error: "Booking email service or authentication is not configured." }, origin);

  const adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await adminDb.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: "Please sign in again." }, origin);
  const { data: adminRecord, error: adminError } = await adminDb.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (adminError || !adminRecord) return json(403, { error: "Administrator access required." }, origin);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json(400, { error: "Invalid request." }, origin); }
  const bookingId = clean(input.booking_id, 80);
  const paymentUrl = clean(input.payment_url, 2000);
  const paymentType = clean(input.payment_type, 10);
  const amount = input.payment_amount_cents == null || input.payment_amount_cents === "" ? null : Number(input.payment_amount_cents);
  const notes = clean(input.admin_notes, 3000);
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return json(400, { error: "Choose a valid booking." }, origin);
  let parsedUrl: URL;
  try { parsedUrl = new URL(paymentUrl); } catch { return json(400, { error: "Enter a valid Stripe payment link." }, origin); }
  if (parsedUrl.protocol !== "https:" || !["buy.stripe.com", "checkout.stripe.com"].includes(parsedUrl.hostname)) return json(400, { error: "Use a secure Stripe payment link (buy.stripe.com or checkout.stripe.com)." }, origin);
  if (!["deposit", "full"].includes(paymentType)) return json(400, { error: "Choose deposit or full payment." }, origin);
  if (amount !== null && (!Number.isSafeInteger(amount) || amount < 50 || amount > 100000000)) return json(400, { error: "Payment amount must be at least $0.50." }, origin);

  const { data: booking, error: bookingError } = await adminDb.from("booking_requests")
    .select("id,customer_name,customer_email,service_type,status").eq("id", bookingId).maybeSingle();
  if (bookingError || !booking) return json(404, { error: "Booking request not found." }, origin);
  if (["declined", "cancelled"].includes(booking.status)) return json(409, { error: "Declined or cancelled bookings cannot be sent payment links." }, origin);

  const subject = "FQ MMA / Sasha portfolio booking: payment link";
  const amountText = amount === null ? "As discussed" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
  const paymentLabel = paymentType === "deposit" ? "Deposit" : "Full payment";
  const html = `<h2>Booking update</h2><p>Hello ${escapeHtml(booking.customer_name)},</p><p>Your booking request for <strong>${escapeHtml(booking.service_type)}</strong> has been approved.</p><p><strong>${paymentLabel}:</strong> ${escapeHtml(amountText)}</p><p>Use the secure Stripe link below to make your payment:</p><p><a href="${escapeHtml(paymentUrl)}">Continue to secure payment</a></p><p>If you have questions, reply to this email.</p><p>FQ MMA / Team S.N.R.G.</p>`;
  const textBody = `Hello ${booking.customer_name},\n\nYour booking request for ${booking.service_type} has been approved.\n${paymentLabel}: ${amountText}\n\nUse this secure Stripe payment link: ${paymentUrl}\n\nFQ MMA / Team S.N.R.G.`;
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [booking.customer_email], reply_to: "fqsnrgmma.info@gmail.com", subject, text: textBody, html })
  });
  const emailResult = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    console.error("Booking payment email rejected", emailResponse.status, emailResult);
    return json(502, { error: "The payment link email could not be sent. The booking was not marked approved." }, origin);
  }

  const { error: updateError } = await adminDb.from("booking_requests").update({
    status: "approved",
    admin_notes: notes,
    payment_type: paymentType,
    payment_amount_cents: amount,
    payment_url: paymentUrl,
    payment_sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("id", bookingId);
  if (updateError) {
    console.error("Payment email sent but booking update failed", updateError.message);
    return json(500, { error: "The email was sent, but the booking record could not be updated. Refresh and check the record before resending." }, origin);
  }
  return json(200, { success: true }, origin);
});