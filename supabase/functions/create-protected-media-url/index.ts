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
      .select("id")
      .eq("media_id", mediaId)
      .eq("authorized_email", email)
      .is("revoked_at", null)
      .maybeSingle();
    if (existingError) return respond({ error: "Could not check existing download approval." }, 500, origin);

    if (existing) {
      const { data: updated, error: updateError } = await db
        .from("media_download_permissions")
        .update({ reason: reason || null, expires_at: expiresAt })
        .eq("id", existing.id)
        .is("revoked_at", null)
        .select("id,media_id,authorized_email,reason,created_at,expires_at")
        .single();
      if (updateError || !updated) return respond({ error: "Could not update the existing approval." }, 500, origin);
      return respond({ permission: updated, updated: true }, 200, origin);
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

  if (action === "revoke") {
    const staff = await requireStaff();
    if ("error" in staff) return respond({ error: staff.error }, staff.status, origin);

    const permissionId = String(input.permission_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(permissionId)) {
      return respond({ error: "A valid approval ID is required." }, 400, origin);
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
    const authorization = req.headers.get("Authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return respond({ error: "For approved downloads, sign in with the verified email address that received approval." }, 401, origin);
    }
    const { data: authData, error: authError } = await db.auth.getUser(match[1]);
    const user = authData?.user;
    const accountEmail = String(user?.email || "").trim().toLowerCase();
    if (authError || !user || !user.email_confirmed_at || !accountEmail || accountEmail !== email) {
      return respond({ error: "Sign in with the verified email address that received approval." }, 403, origin);
    }

    const { data: permission, error: permissionError } = await db
      .from("media_download_permissions")
      .select("id")
      .eq("media_id", mediaId)
      .eq("authorized_email", email)
      .is("revoked_at", null)
      .or("expires_at.is.null,expires_at.gt.now()")
      .maybeSingle();
    if (permissionError || !permission) {
      return respond({ error: "No active download approval was found for this email and media item." }, 403, origin);
    }
  }

  const { data: signed, error: signedError } = await db.storage
    .from("fqmma-private")
    .createSignedUrl(media.file_path, 900, { download: true });
  if (signedError || !signed?.signedUrl) {
    return respond({ error: "The download is temporarily unavailable. Please contact FQ MMA support." }, 502, origin);
  }
  return respond({ url: signed.signedUrl, title: media.title, expires_in: 900 }, 200, origin);
});
