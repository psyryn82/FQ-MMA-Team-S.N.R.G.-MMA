// FQ MMA Stripe webhook for one-time ticket purchases.
// Deploy with verify_jwt=false: Stripe authenticates this endpoint with its signature.
// Required secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY.
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  const { data: prior, error: priorError } = await db.from("stripe_webhook_events").select("event_id,status").eq("event_id", event.id).maybeSingle();
  if (priorError) return new Response("Webhook storage unavailable", { status: 500 });
  if (prior?.status === "processed") return json({ received: true, duplicate: true });
  if (prior?.status === "processing") return new Response("Event is already processing", { status: 409 });

  const { error: ledgerError } = await db.from("stripe_webhook_events").insert({ event_id: event.id, event_type: event.type, status: "processing" });
  if (ledgerError) {
    const { data: raced } = await db.from("stripe_webhook_events").select("status").eq("event_id", event.id).maybeSingle();
    if (raced?.status === "processed") return json({ received: true, duplicate: true });
    return new Response("Event is already processing; retry shortly", { status: 409 });
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
            .select("id,status,stripe_checkout_session_id").eq("id", purchaseId).maybeSingle();
          if (findError) throw findError;
          if (!purchase) throw new Error("Ticket reservation was not found");
          if (purchase.stripe_checkout_session_id && purchase.stripe_checkout_session_id !== session.id) throw new Error("Ticket reservation/session mismatch");
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
            .select("id,event_id,status,amount_cents,currency,stripe_checkout_session_id").eq("id", purchaseId).maybeSingle();
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
            .select("id,is_published,price,file_path").eq("id", mediaId).maybeSingle();
          if (mediaError) throw mediaError;
          if (!media || !media.is_published || Number(media.price) <= 0 || !media.file_path) {
            throw new Error("Paid media is unavailable or not configured for private delivery");
          }
          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
          const { error: purchaseError } = await db.from("media_purchases").upsert({
            media_id: mediaId,
            checkout_session_id: session.id,
            payment_intent_id: paymentIntentId,
            customer_email: session.customer_details?.email ?? session.customer_email ?? null,
            payment_status: "paid",
            updated_at: new Date().toISOString(),
          }, { onConflict: "checkout_session_id" });
          if (purchaseError) throw purchaseError;
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
