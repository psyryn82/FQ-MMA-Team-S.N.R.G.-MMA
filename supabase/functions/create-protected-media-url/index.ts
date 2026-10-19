import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://fq-snrg-mma.com", "https://www.fq-snrg-mma.com"]);
const headers = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com",
      "Vary": "Origin",
      "Cache-Control": "no-store",
    },
  });
}

function validEmail(value: string) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, (char) => entities[char] || char);
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { ...headers, "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://fq-snrg-mma.com", "Vary": "Origin" },
    });
  }
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey || !req.headers.get("apikey")) {
    return respond({ error: "Media delivery is not configured." }, 503, origin);
  }

  let input: {
    action?: unknown;
    media_id?: unknown;
    buyer_email?: unknown;
    session_id?: unknown;
    authorized_email?: unknown;
    permission_id?: unknown;
    reason?: unknown;
    expires_at?: unknown;
    token?: unknown;
  };
  try {
    input = await req.json();
  } catch {
    return respond({ error: "Request details are required." }, 400, origin);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const action = String(input.action || "download").toLowerCase();

  async function requireStaff(allowedRoles: string[] = ["admin", "sasha"]) {
    const authorization = req.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return { error: "Sign in with an authorized staff account.", status: 401 } as const;

    const { data: authData, error: authError } = await db.auth.getUser(match[1]);
    const user = authData?.user;
    if (authError || !user || !user.email || !user.email_confirmed_at) {
      return { error: "A verified staff sign-in is required.", status: 401 } as const;
    }

    const { data: staff, error: staffError } = await db
      .from("admin_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (staffError || !staff || !allowedRoles.includes(String(staff.role))) {
      return { error: "You are not authorized to manage media download access.", status: 403 } as const;
    }
    return { user, role: String(staff.role) } as const;
  }

  if (action === "grant") {
    const staff = await requireStaff();
    if ("error" in staff) return respond({ error: staff.error }, staff.status, origin);

    const mediaId = Number(input.media_id);
    const email = String(input.authorized_email || "").trim().toLowerCase();
    const reason = String(input.reason || "").trim().slice(0, 500);
    let expiresAt: string | null = null;
    if (input.expires_at !== undefined && input.expires_at !== null && String(input.expires_at).trim() !== "") {
      const parsed = new Date(String(input.expires_at));
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        return respond({ error: "Expiry must be a valid future date and time." }, 400, origin);
      }
      expiresAt = parsed.toISOString();
    }
    if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !validEmail(email)) {
      return respond({ error: "A valid media item and approved email are required." }, 400, origin);
    }

    const { data: media, error: mediaError } = await db
      .from("media")
      .select("id,title,file_path,storage_bucket,is_published")
      .eq("id", mediaId)
      .eq("is_published", true)
      .maybeSingle();
    if (mediaError || !media || !media.file_path || media.storage_bucket !== "fqmma-private") {
      return respond({ error: "Only published media with a private original can receive download approval." }, 404, origin);
    }

    const { data: existing, error: existingError } = await db
      .from("media_download_permissions")
      .select("id,expires_at")
      .eq("media_id", mediaId)
      .eq("authorized_email", email)
      .is("revoked_at", null)
      .maybeSingle();
    if (existingError) return respond({ error: "Could not check existing download approval." }, 500, origin);

    if (existing) {
      const stillActive = !existing.expires_at || new Date(existing.expires_at).getTime() > Date.now();
      if (stillActive) {
        // Reuse an active approval so the admin's combined approve-and-send action can proceed.
        const { data: activePermission, error: activePermissionError } = await db
          .from("media_download_permissions")
          .select("id,media_id,authorized_email,reason,created_at,expires_at")
          .eq("id", existing.id)
          .single();
        if (activePermissionError || !activePermission) {
          return respond({ error: "An active approval exists, but its details could not be loaded. Use Send / resend link." }, 500, origin);
        }
        return respond({ permission: activePermission, updated: true, reused: true }, 200, origin);
      }
      const { error: expireError } = await db
        .from("media_download_permissions")
        .update({ revoked_at: new Date().toISOString(), revoked_by: staff.user.id })
        .eq("id", existing.id)
        .is("revoked_at", null);
      if (expireError) return respond({ error: "Could not close the expired approval before replacing it." }, 500, origin);
    }

    const { data: permission, error: insertError } = await db
      .from("media_download_permissions")
      .insert({
        media_id: mediaId,
        authorized_email: email,
        granted_by: staff.user.id,
        reason: reason || null,
        expires_at: expiresAt,
      })
      .select("id,media_id,authorized_email,reason,created_at,expires_at")
      .single();
    if (insertError || !permission) return respond({ error: "Could not save download approval." }, 500, origin);
    return respond({ permission, updated: false }, 200, origin);
  }


  if (action === "send_download_link") {
    const staff = await requireStaff();
    if ("error" in staff) return respond({ error: staff.error }, staff.status, origin);
    const mediaId = Number(input.media_id);
    const email = String(input.authorized_email || "").trim().toLowerCase();
    if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !validEmail(email)) return respond({ error: "A valid media item and approved email are required." }, 400, origin);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("CONTACT_FROM_EMAIL") || "FQ MMA <downloads@fq-snrg-mma.com>";
    if (!resendKey) return respond({ error: "Email delivery is not configured. Add RESEND_API_KEY in Supabase secrets." }, 503, origin);
    const { data: permission, error: permissionError } = await db.from("media_download_permissions")
      .select("id,media_id,authorized_email,expires_at,revoked_at").eq("media_id", mediaId).eq("authorized_email", email).is("revoked_at", null).maybeSingle();
    if (permissionError || !permission || (permission.expires_at && new Date(permission.expires_at).getTime() <= Date.now())) return respond({ error: "No active download approval was found for this media item and email." }, 404, origin);
    const { data: media, error: mediaError } = await db.from("media")
      .select("id,title,file_path,storage_bucket,is_published").eq("id", mediaId).eq("is_published", true).maybeSingle();
    if (mediaError || !media || !media.file_path || media.storage_bucket !== "fqmma-private") return respond({ error: "This item is not available for private download." }, 404, origin);
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count, error: rateError } = await db.from("media_download_tokens")
      .select("id", { count: "exact", head: true }).eq("permission_id", permission.id).gt("created_at", since);
    if (rateError) return respond({ error: "Could not verify recent download-link requests." }, 500, origin);
    if ((count || 0) >= 3) return respond({ error: "For security, only three download links can be sent per approval every five minutes." }, 429, origin);
    const token = randomToken(), tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { data: tokenRow, error: tokenError } = await db.from("media_download_tokens")
      .insert({ permission_id: permission.id, token_hash: tokenHash, expires_at: expiresAt, sent_by: staff.user.id }).select("id").single();
    if (tokenError || !tokenRow) return respond({ error: "Could not create a secure download link." }, 500, origin);
    const link = "https://fq-snrg-mma.com/media-download.html#token=" + token;
    const safeTitle = escapeHtml(String(media.title || "your approved media"));
    let emailResponse: Response;
    try {
        emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from, to: [email], reply_to: "fqsnrgmma.info@gmail.com", subject: "Your FQ MMA media download link",
          text: "Your download of " + String(media.title || "the approved media") + " has been approved. Open this link within 30 minutes, then select Download file. The link can be used once. If you did not expect this email, contact fqsnrgmma.info@gmail.com.\n\n" + link,
          html: "<div style=\"font-family:Arial,sans-serif;line-height:1.5;color:#171717\"><h2>Your FQ MMA media download is approved</h2><p>Your download of <strong>" + safeTitle + "</strong> has been approved.</p><p>This link expires in 30 minutes and can be used once. Open the page, then press <strong>Download file</strong> to use the link.</p><p><a href=\"" + link + "\" style=\"display:inline-block;background:#e50914;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold\">Open secure download</a></p><p>If you did not expect this email, contact <a href=\"mailto:fqsnrgmma.info@gmail.com\">fqsnrgmma.info@gmail.com</a>.</p></div>"
        })
      });
    } catch {
      await db.from("media_download_tokens").delete().eq("id", tokenRow.id);
      return respond({ error: "Email delivery could not be reached. No download email was confirmed as sent." }, 502, origin);
    }
    if (!emailResponse.ok) {
      await db.from("media_download_tokens").delete().eq("id", tokenRow.id);
      return respond({ error: "The download email could not be sent. Check the Resend sender configuration and try again." }, 502, origin);
    }
    await db.from("media_download_tokens")
      .update({ consumed_at: new Date().toISOString() })
      .eq("permission_id", permission.id).is("consumed_at", null).neq("id", tokenRow.id);
    return respond({ sent: true, expires_in: 1800, message: "One-time download link sent." }, 200, origin);
  }

  if (action === "revoke") {
    const staff = await requireStaff();
    if ("error" in staff) return respond({ error: staff.error }, staff.status, origin);

    let permissionId = String(input.permission_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(permissionId)) {
      const mediaId = Number(input.media_id);
      const email = String(input.authorized_email || "").trim().toLowerCase();
      if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !validEmail(email)) {
        return respond({ error: "Provide an approval ID or a valid media ID and approved email." }, 400, origin);
      }
      const { data: existing, error: lookupError } = await db.from("media_download_permissions")
        .select("id").eq("media_id", mediaId).eq("authorized_email", email).is("revoked_at", null).maybeSingle();
      if (lookupError || !existing) return respond({ error: "Active approval not found for this media and email." }, 404, origin);
      permissionId = existing.id;
    }
    const { data: permission, error } = await db
      .from("media_download_permissions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: staff.user.id })
      .eq("id", permissionId)
      .is("revoked_at", null)
      .select("id,media_id,authorized_email,revoked_at")
      .maybeSingle();
    if (error) return respond({ error: "Could not revoke this download approval." }, 500, origin);
    if (!permission) return respond({ error: "Active approval not found." }, 404, origin);
    return respond({ permission, revoked: true }, 200, origin);
  }

  if (action !== "download") return respond({ error: "Unsupported action." }, 400, origin);

  const token = String(input.token || "").trim().toLowerCase();
  if (token) {
    if (!/^[0-9a-f]{64}$/.test(token)) return respond({ error: "This download link is invalid or has expired. Ask staff to send a new one." }, 400, origin);
    const tokenHash = await sha256Hex(token), now = new Date().toISOString();
    const { data: tokenRow, error: tokenError } = await db.from("media_download_tokens")
      .select("id,permission_id,expires_at,consumed_at").eq("token_hash", tokenHash).gt("expires_at", now).is("consumed_at", null).maybeSingle();
    if (tokenError || !tokenRow) return respond({ error: "This download link is invalid, expired, or already used. Ask staff to send a new one." }, 403, origin);
    const { data: permission, error: permissionError } = await db.from("media_download_permissions")
      .select("id,media_id,authorized_email,expires_at,revoked_at").eq("id", tokenRow.permission_id).is("revoked_at", null).maybeSingle();
    if (permissionError || !permission || (permission.expires_at && new Date(permission.expires_at).getTime() <= Date.now())) return respond({ error: "This approval is no longer active. Contact FQ MMA support." }, 403, origin);
    const { data: media, error: mediaError } = await db.from("media")
      .select("id,title,file_path,storage_bucket,is_published").eq("id", permission.media_id).eq("is_published", true).maybeSingle();
    if (mediaError || !media || !media.file_path || media.storage_bucket !== "fqmma-private") return respond({ error: "This media is not configured for private delivery." }, 404, origin);
    const consumeNow = new Date().toISOString();
    const { data: consumed, error: consumeError } = await db.from("media_download_tokens")
      .update({ consumed_at: consumeNow }).eq("id", tokenRow.id).is("consumed_at", null).gt("expires_at", consumeNow).select("id").maybeSingle();
    if (consumeError || !consumed) return respond({ error: "This download link has already been used. Ask staff to send a new one." }, 403, origin);
    const { data: stillApproved, error: recheckError } = await db.from("media_download_permissions")
      .select("id").eq("id", permission.id).is("revoked_at", null).maybeSingle();
    if (recheckError || !stillApproved) return respond({ error: "This approval is no longer active. Contact FQ MMA support." }, 403, origin);
    const { data: signed, error: signedError } = await db.storage.from("fqmma-private").createSignedUrl(media.file_path, 900, { download: true });
    if (signedError || !signed?.signedUrl) return respond({ error: "The download is temporarily unavailable. Ask staff to send a new link." }, 502, origin);
    return respond({ url: signed.signedUrl, title: media.title, expires_in: 900 }, 200, origin);
  }

  const mediaId = Number(input.media_id);
  const email = String(input.buyer_email || "").trim().toLowerCase();
  const sessionId = String(input.session_id || "").trim();
  if (!Number.isSafeInteger(mediaId) || mediaId < 1 || !validEmail(email)) {
    return respond({ error: "A valid media item and email address are required." }, 400, origin);
  }

  const { data: media, error: mediaError } = await db
    .from("media")
    .select("id,title,file_path,storage_bucket,is_published,price")
    .eq("id", mediaId)
    .eq("is_published", true)
    .maybeSingle();
  if (mediaError || !media || !media.file_path || media.storage_bucket !== "fqmma-private") {
    return respond({ error: "This media is not configured for private delivery." }, 404, origin);
  }

  if (sessionId) {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey || (!stripeKey.startsWith("sk_live_") && !stripeKey.startsWith("sk_test_"))) {
      return respond({ error: "Secure payment verification is not configured." }, 503, origin);
    }
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return respond({ error: "A valid checkout session is required." }, 400, origin);
    }
    const stripeIsLive = stripeKey.startsWith("sk_live_");
    if ((stripeIsLive && !sessionId.startsWith("cs_live_")) || (!stripeIsLive && !sessionId.startsWith("cs_test_"))) {
      return respond({ error: "Checkout session does not match the configured Stripe mode." }, 400, origin);
    }

    const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      return respond({ error: "Could not verify this Stripe checkout session." }, 404, origin);
    }
    if (
      session.livemode !== stripeIsLive ||
      session.mode !== "payment" ||
      session.status !== "complete" ||
      session.payment_status !== "paid" ||
      session.metadata?.purchase_type !== "media" ||
      session.metadata?.media_id !== String(mediaId)
    ) {
      return respond({ error: "Stripe has not confirmed payment for this media item." }, 403, origin);
    }
    const paidEmail = String(session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
    if (!paidEmail || paidEmail !== email) {
      return respond({ error: "Use the same email address used at Stripe checkout." }, 403, origin);
    }

    const { data: purchase, error: purchaseError } = await db
      .from("media_purchases")
      .select("id")
      .eq("media_id", mediaId)
      .eq("checkout_session_id", sessionId)
      .eq("customer_email", email)
      .eq("payment_status", "paid")
      .maybeSingle();
    if (purchaseError || !purchase) {
      return respond({ error: "The payment record is still syncing. Wait a few seconds and try again." }, 403, origin);
    }
  } else {
    return respond({ error: "For approved downloads, use the one-time link sent to your email." }, 401, origin);
  }

  const { data: signed, error: signedError } = await db.storage
    .from("fqmma-private")
    .createSignedUrl(media.file_path, 900, { download: true });
  if (signedError || !signed?.signedUrl) {
    return respond({ error: "The download is temporarily unavailable. Please contact FQ MMA support." }, 502, origin);
  }
  return respond({ url: signed.signedUrl, title: media.title, expires_in: 900 }, 200, origin);
});
