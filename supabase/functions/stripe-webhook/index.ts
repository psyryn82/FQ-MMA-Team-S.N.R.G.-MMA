// FQ MMA Stripe webhook for one-time ticket purchases.
// Deploy with verify_jwt=false: Stripe authenticates this endpoint with its signature.
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signature = req.headers.get("stripe-signature");
  if (!stripeKey || !webhookSecret || !supabaseUrl || !serviceKey || !signature) return new Response("Webhook is not configured", { status: 503 });

  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, webhookSecret, undefined, Stripe.createSubtleCryptoProvider());
  } catch (error) {
    console.error("Stripe signature verification failed", error instanceof Error ? error.message : "unknown error");
    return new Response("Invalid signature", { status: 400 });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: prior, error: priorError } = await db.from("stripe_webhook_events").select("event_id,status,received_at").eq("event_id", event.id).maybeSingle();
  if (priorError) return new Response("Webhook storage unavailable", { status: 500 });
  if (prior?.status === "processed") return json({ received: true, duplicate: true });

  // Recover abandoned processing leases. Claim the stale row with a conditional
  // timestamp update so concurrent Stripe retries cannot both take ownership.
  let claimedStaleEvent = false;
  if (prior?.status === "processing") {
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: reclaimed, error: reclaimError } = await db.from("stripe_webhook_events")
      .update({ received_at: new Date().toISOString() })
      .eq("event_id", event.id)
      .eq("status", "processing")
      .lt("received_at", staleBefore)
      .select("event_id")
      .maybeSingle();
    if (reclaimError) return new Response("Webhook storage unavailable", { status: 500 });
    if (!reclaimed) return new Response("Event is already processing; retry shortly", { status: 409 });
    claimedStaleEvent = true;
  }

  if (!claimedStaleEvent) {
    const { error: ledgerError } = await db.from("stripe_webhook_events").insert({ event_id: event.id, event_type: event.type, status: "processing" });
    if (ledgerError) {
      const { data: raced } = await db.from("stripe_webhook_events").select("status").eq("event_id", event.id).maybeSingle();
      if (raced?.status === "processed") return json({ received: true, duplicate: true });
      return new Response("Event is already processing; retry shortly", { status: 409 });
    }
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.purchase_type === "ticket") {
        const purchaseId = session.metadata.ticket_purchase_id;
        if (!purchaseId || session.mode !== "payment") throw new Error("Ticket checkout metadata is invalid");
        if (session.payment_status === "paid") {
          if (session.amount_total !== Number(session.metadata.expected_amount_cents || NaN)) throw new Error("Ticket checkout amount does not match expected amount");
          const { data: purchase, error: findError } = await db.from("ticket_purchases")
            .select("id,status,stripe_checkout_session_id,total_cents,charged_total_cents").eq("id", purchaseId).maybeSingle();
          if (findError) throw findError;
          if (!purchase) throw new Error("Ticket reservation was not found");
          if (purchase.stripe_checkout_session_id && purchase.stripe_checkout_session_id !== session.id) throw new Error("Ticket reservation/session mismatch");
          if (session.amount_total !== Number(purchase.charged_total_cents ?? purchase.total_cents)) throw new Error("Ticket checkout amount does not match the saved reservation total");
          if (purchase.status !== "refunded") {
            const { error } = await db.from("ticket_purchases").update({
              status: "paid",
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
              updated_at: new Date().toISOString(),
            }).eq("id", purchaseId);
            if (error) throw error;
          }
        }
      } else if (session.metadata?.purchase_type === "stream") {
        const purchaseId = session.metadata.stream_purchase_id;
        if (!purchaseId || session.mode !== "payment") throw new Error("Stream checkout metadata is invalid");
        if (session.payment_status === "paid") {
          if (session.amount_total !== Number(session.metadata.expected_amount_cents || NaN)) throw new Error("Stream checkout amount does not match expected amount");
          const { data: purchase, error: findError } = await db.from("stream_purchases")
            .select("id,event_id,buyer_email,status,amount_cents,currency,stripe_checkout_session_id").eq("id", purchaseId).maybeSingle();
          if (findError) throw findError;
          if (!purchase) throw new Error("Stream purchase reservation was not found");
          if (purchase.stripe_checkout_session_id && purchase.stripe_checkout_session_id !== session.id) throw new Error("Stream reservation/session mismatch");
          if (purchase.event_id !== session.metadata.event_id || session.amount_total !== purchase.amount_cents ||
              session.currency !== String(purchase.currency || "USD").toLowerCase()) {
            throw new Error("Stream checkout details do not match the reservation");
          }
          if (purchase.status !== "refunded") {
            const { error } = await db.from("stream_purchases").update({
              status: "paid",
              stripe_checkout_session_id: session.id,
              stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
              updated_at: new Date().toISOString(),
            }).eq("id", purchaseId);
            if (error) throw error;

            // Email is a best-effort side effect. A Resend outage must never
            // undo a paid purchase or cause Stripe to retry payment recording.
            const buyerEmail = (String(session.customer_details?.email || "").trim() || String(purchase.buyer_email || "").trim()).toLowerCase();
            const resendKey = Deno.env.get("RESEND_API_KEY");
            if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
              console.error("Stream access email skipped: no valid buyer email for purchase", purchaseId);
            } else if (!resendKey) {
              console.error("Stream access email skipped: RESEND_API_KEY is not configured for purchase", purchaseId);
            } else {
              let eventTitle = "Fight Quest XVI";
              let eventDate = "Date and time to be announced";
              try {
                const { data: eventDetails, error: eventDetailsError } = await db.from("events")
                  .select("title,event_date").eq("id", purchase.event_id).maybeSingle();
                if (eventDetailsError) throw eventDetailsError;
                if (eventDetails?.title) eventTitle = String(eventDetails.title);
                if (eventDetails?.event_date) {
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
              } catch (emailContextError) {
                console.error("Could not load event details for stream access email", purchaseId, emailContextError instanceof Error ? emailContextError.message : "unknown error");
              }

              const watchLink = "https://fq-snrg-mma.com/watch.html?session_id=" + encodeURIComponent(session.id);
              const safeTitle = escapeHtml(eventTitle);
              const safeDate = escapeHtml(eventDate);
              const safeLink = escapeHtml(watchLink);
              const from = Deno.env.get("CONTACT_FROM_EMAIL") || "FQ MMA <info@fq-snrg-mma.com>";
              try {
                const emailResponse = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Authorization": "Bearer " + resendKey,
                    "Content-Type": "application/json",
                    "Idempotency-Key": "stream-access-" + purchaseId,
                  },
                  body: JSON.stringify({
                    from,
                    to: [buyerEmail],
                    reply_to: "support@fq-snrg-mma.com",
                    subject: "Your Fight Quest XVI live stream access",
                    text: "Your live stream access for " + eventTitle + "\nEvent date and time: " + eventDate + " (America/Los_Angeles).\n\nWatch your live stream: " + watchLink + "\n\nThis pass is live-only and includes no replay. Don't share this link.\n\nFor help, contact support@fq-snrg-mma.com.",
                    html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#222\"><h2>Your Fight Quest XVI live stream access</h2><p>Your access is for <strong>" + safeTitle + "</strong>.</p><p><strong>Event date and time:</strong> " + safeDate + " (America/Los_Angeles).</p><p><a href=\"" + safeLink + "\" style=\"display:inline-block;background:#c62828;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold\">Watch the live stream</a></p><p>This pass is live-only and includes no replay. <strong>Don't share this link.</strong></p><p>For help, contact <a href=\"mailto:support@fq-snrg-mma.com\">support@fq-snrg-mma.com</a>.</p></div>",
                  }),
                });
                if (!emailResponse.ok) {
                  const detail = await emailResponse.text().catch(() => "");
                  console.error("Resend rejected stream access email", purchaseId, emailResponse.status, detail.slice(0, 500));
                }
              } catch (emailError) {
                console.error("Stream access email request failed", purchaseId, emailError instanceof Error ? emailError.message : "unknown error");
              }
            }
          }
        }
      } else if (session.metadata?.purchase_type === "media") {
        const rawMediaId = session.metadata.media_id;
        const mediaId = rawMediaId && /^\d+$/.test(rawMediaId) ? Number(rawMediaId) : NaN;
        if (!Number.isSafeInteger(mediaId) || mediaId < 1 || session.mode !== "payment") {
          throw new Error("Media checkout metadata is invalid");
        }
        if (session.payment_status === "paid") {
          const { data: media, error: mediaError } = await db.from("media")
            .select("id,title,is_published,price,price_confirmed,file_path,storage_bucket").eq("id", mediaId).maybeSingle();
          if (mediaError) throw mediaError;
          if (!media || media.is_published !== true || media.price_confirmed !== true || !media.file_path || media.storage_bucket !== "fqmma-private") {
            throw new Error("Paid media is unavailable or not configured for private delivery");
          }
          const expectedAmountText = String(session.metadata?.expected_amount_cents || "");
          const expectedAmountCents = expectedAmountText ? Number(expectedAmountText) : NaN;
          if (!Number.isSafeInteger(expectedAmountCents) || expectedAmountCents < 1 || session.amount_total !== expectedAmountCents || String(session.currency || "").toLowerCase() !== "usd") {
            throw new Error("Media checkout amount or currency does not match the amount recorded when checkout was created");
          }
          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
          const buyerEmail = String(session.customer_details?.email ?? session.customer_email ?? "").trim().toLowerCase();
          const { error: purchaseError } = await db.from("media_purchases").upsert({
            media_id: mediaId,
            checkout_session_id: session.id,
            payment_intent_id: paymentIntentId,
            customer_email: buyerEmail || null,
            payment_status: "paid",
            amount_cents: session.amount_total,
            currency: String(session.currency || "usd").toUpperCase(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "checkout_session_id" });
          if (purchaseError) throw purchaseError;

          const { data: savedPurchase, error: savedPurchaseError } = await db.from("media_purchases")
            .select("id,download_email_status,download_email_sent_at").eq("checkout_session_id", session.id).single();
          if (savedPurchaseError || !savedPurchase) throw savedPurchaseError || new Error("Paid media purchase record could not be reloaded");

          if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
            const { error: noEmailError } = await db.from("media_purchases").update({
              download_email_status: "needs_email",
              download_email_error: "Stripe did not provide a valid customer email.",
              updated_at: new Date().toISOString(),
            }).eq("id", savedPurchase.id);
            if (noEmailError) throw noEmailError;
          } else if (savedPurchase.download_email_status !== "sent" && !savedPurchase.download_email_sent_at) {
            const resendKey = Deno.env.get("RESEND_API_KEY");
            if (!resendKey) {
              await db.from("media_purchases").update({
                download_email_status: "failed",
                download_email_error: "RESEND_API_KEY is not configured.",
                updated_at: new Date().toISOString(),
              }).eq("id", savedPurchase.id);
              throw new Error("Automatic media delivery email cannot run because RESEND_API_KEY is not configured");
            }

            const { error: pendingError } = await db.from("media_purchases").update({
              download_email_status: "pending",
              download_email_error: null,
              updated_at: new Date().toISOString(),
            }).eq("id", savedPurchase.id);
            if (pendingError) throw pendingError;

            let { data: permission, error: permissionError } = await db.from("media_download_permissions")
              .select("id,authorized_email,revoked_at").eq("purchase_checkout_session_id", session.id).maybeSingle();
            if (permissionError) throw permissionError;
            if (!permission) {
              const { data: insertedPermission, error: insertPermissionError } = await db.from("media_download_permissions")
                .insert({
                  media_id: mediaId,
                  authorized_email: buyerEmail,
                  granted_by: null,
                  reason: "Automatic paid-media delivery for checkout " + session.id,
                  purchase_checkout_session_id: session.id,
                }).select("id,authorized_email,revoked_at").single();
              if (insertPermissionError || !insertedPermission) throw insertPermissionError || new Error("Could not create paid-media download permission");
              permission = insertedPermission;
            }
            if (permission.authorized_email !== buyerEmail || permission.revoked_at) {
              throw new Error("Paid-media download permission is revoked or does not match the buyer email");
            }

            const now = new Date().toISOString();
            const { error: invalidateError } = await db.from("media_download_tokens")
              .update({ consumed_at: now }).eq("permission_id", permission.id).is("consumed_at", null);
            if (invalidateError) throw invalidateError;

            const token = randomToken();
            const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            const { data: tokenRow, error: tokenError } = await db.from("media_download_tokens")
              .insert({
                permission_id: permission.id,
                token_hash: await sha256Hex(token),
                expires_at: expiresAt,
                sent_by: null,
              }).select("id").single();
            if (tokenError || !tokenRow) throw tokenError || new Error("Could not create paid-media download token");

            const link = "https://fq-snrg-mma.com/media-download.html#token=" + token;
            const title = String(media.title || "your purchased media");
            const safeTitle = escapeHtml(title);
            const from = Deno.env.get("CONTACT_FROM_EMAIL") || "FQ MMA <downloads@fq-snrg-mma.com>";
            let emailResponse: Response;
            try {
              emailResponse = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Authorization": "Bearer " + resendKey,
                  "Content-Type": "application/json",
                  "Idempotency-Key": "media-download-" + tokenRow.id,
                },
                body: JSON.stringify({
                  from,
                  to: [buyerEmail],
                  reply_to: "support@fq-snrg-mma.com",
                  subject: "Your FQ MMA media purchase is ready",
                  text: "Thanks for your purchase of " + title + ". Your secure download link expires in 30 minutes and can be used once: " + link + "\n\nAfter opening the link, select Download file. The generated file link is valid for 15 minutes. If you need help, contact support@fq-snrg-mma.com.",
                  html: "<div style=\"font-family:Arial,sans-serif;line-height:1.6;color:#222\"><h2>Your FQ MMA media is ready</h2><p>Thanks for purchasing <strong>" + safeTitle + "</strong>.</p><p>This secure download link expires in 30 minutes and can be used once.</p><p><a href=\"" + link + "\" style=\"display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:bold\">Download your purchase</a></p><p>After opening the link, select Download file. The generated file link is valid for 15 minutes.</p><p>If you need help, contact <a href=\"mailto:support@fq-snrg-mma.com\">support@fq-snrg-mma.com</a>.</p></div>",
                }),
              });
            } catch {
              await db.from("media_download_tokens").delete().eq("id", tokenRow.id);
              await db.from("media_purchases").update({
                download_email_status: "failed",
                download_email_error: "Email provider could not be reached.",
                updated_at: new Date().toISOString(),
              }).eq("id", savedPurchase.id);
              throw new Error("Resend could not be reached for paid-media delivery email");
            }
            if (!emailResponse.ok) {
              await db.from("media_download_tokens").delete().eq("id", tokenRow.id);
              await db.from("media_purchases").update({
                download_email_status: "failed",
                download_email_error: "Email provider rejected the delivery email.",
                updated_at: new Date().toISOString(),
              }).eq("id", savedPurchase.id);
              throw new Error("Resend rejected the paid-media delivery email: " + emailResponse.status);
            }
            const { error: sentUpdateError } = await db.from("media_purchases").update({
              download_email_status: "sent",
              download_email_sent_at: new Date().toISOString(),
              download_email_error: null,
              updated_at: new Date().toISOString(),
            }).eq("id", savedPurchase.id);
            if (sentUpdateError) throw sentUpdateError;
          }
        }
      }
      if (session.payment_status === "paid" && session.metadata?.promotion_redemption_id) {
        const redemptionId = session.metadata.promotion_redemption_id;
        if (!/^[0-9a-f-]{36}$/i.test(redemptionId)) throw new Error("Promotion redemption metadata is invalid");
        const { data: finished, error: finishError } = await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "redeemed" });
        if (finishError || finished !== true) throw new Error("Could not finalize promotion redemption");
      }
    } else if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.metadata?.promotion_redemption_id) {
        const redemptionId = session.metadata.promotion_redemption_id;
        if (!/^[0-9a-f-]{36}$/i.test(redemptionId)) throw new Error("Promotion redemption metadata is invalid");
        const { data: released, error: releaseError } = await db.rpc("finish_promotion_redemption", { p_redemption_id: redemptionId, p_outcome: "released" });
        if (releaseError || released !== true) throw new Error("Could not release promotion redemption");
      }
      if (session.metadata?.purchase_type === "ticket" && session.metadata.ticket_purchase_id) {
        const { error } = await db.from("ticket_purchases").update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", session.metadata.ticket_purchase_id).eq("status", "pending");
        if (error) throw error;
      } else if (session.metadata?.purchase_type === "stream" && session.metadata.stream_purchase_id) {
        const failureStatus = event.type === "checkout.session.expired" ? "expired" : "failed";
        const { error } = await db.from("stream_purchases").update({ status: failureStatus, updated_at: new Date().toISOString() })
          .eq("id", session.metadata.stream_purchase_id).eq("status", "pending");
        if (error) throw error;
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (paymentIntentId && charge.refunded) {
        const { error } = await db.from("ticket_purchases").update({ status: "refunded", updated_at: new Date().toISOString() })
          .eq("stripe_payment_intent_id", paymentIntentId).eq("status", "paid");
        if (error) throw error;
        const { error: mediaRefundError } = await db.from("media_purchases").update({
          payment_status: "refunded",
          updated_at: new Date().toISOString(),
        }).eq("payment_intent_id", paymentIntentId).eq("payment_status", "paid");
        if (mediaRefundError) throw mediaRefundError;

        const { data: refundedMediaPurchases, error: refundedMediaFindError } = await db.from("media_purchases")
          .select("checkout_session_id").eq("payment_intent_id", paymentIntentId).eq("payment_status", "refunded");
        if (refundedMediaFindError) throw refundedMediaFindError;
        for (const refundedPurchase of refundedMediaPurchases || []) {
          const { data: permissions, error: permissionsError } = await db.from("media_download_permissions")
            .select("id").eq("purchase_checkout_session_id", refundedPurchase.checkout_session_id);
          if (permissionsError) throw permissionsError;
          for (const permission of permissions || []) {
            const revokedAt = new Date().toISOString();
            const { error: expirePermissionError } = await db.from("media_download_permissions")
              .update({ expires_at: revokedAt }).eq("id", permission.id);
            if (expirePermissionError) throw expirePermissionError;
            const { error: consumeTokensError } = await db.from("media_download_tokens")
              .update({ consumed_at: revokedAt }).eq("permission_id", permission.id).is("consumed_at", null);
            if (consumeTokensError) throw consumeTokensError;
          }
        }

        const { error: streamRefundError } = await db.from("stream_purchases").update({
          status: "refunded",
          updated_at: new Date().toISOString(),
        }).eq("stripe_payment_intent_id", paymentIntentId).eq("status", "paid");
        if (streamRefundError) throw streamRefundError;
      }
    }

    const { error: doneError } = await db.from("stripe_webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("event_id", event.id);
    if (doneError) throw doneError;
    return json({ received: true });
  } catch (error) {
    await db.from("stripe_webhook_events").delete().eq("event_id", event.id);
    console.error("Could not process verified Stripe event", event.id, error instanceof Error ? error.message : "unknown error");
    return new Response("Could not process event", { status: 500 });
  }
});
