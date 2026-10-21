# FQ MMA one-time ticket sales

## Configure ticket sales in the admin dashboard

1. Create or edit the event under **Events**.
2. Under **Ticket options**, create the ticket name, description, fixed price, currency, and optional quantity limit.
3. Keep **Allow customers to buy** turned off while preparing.
4. Link the ticket option to the correct event, confirm the price and availability, and enable sales only when the event is ready.
5. Use **Ticket purchases** to review purchase records. A checkout redirect or pending record is not proof of payment. The signed Stripe webhook is responsible for marking a purchase paid.

## Current Stripe checkout architecture

- `create-ticket-checkout`: one-time event ticket payments.
- `create-stream-checkout`: one-time livestream access payments.
- `create-media-checkout`: one-time paid media checkout for eligible private media.
- `stripe-webhook`: verifies Stripe signatures and updates supported purchase records.
- `create-checkout-session`: retired legacy membership endpoint; it returns HTTP 410 and is not used for current sales.

The active ticket, stream, and media checkout functions use the server-side `STRIPE_SECRET_KEY` to choose Stripe mode. The former test-only code guards have been removed. Live payments still require a live secret key in Supabase and a live-mode webhook configured with its matching signing secret.

## Safe payment checks

- Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Supabase Edge Function secrets. Never commit or share secret values.
- The webhook endpoint is `https://dmcbbavsxyxrxuuzraiu.supabase.co/functions/v1/stripe-webhook`. Configure it in the same Stripe mode as the secret key.
- A checkout session can be created without charging a customer. Completing the hosted checkout causes the payment, so do not complete a live checkout during testing without explicit authorization.
- Test successful payments, failed/cancelled/expired checkouts, webhook delivery, correct purchase status, and refund handling in test mode before relying on fulfillment.
- After a payment, check the Stripe webhook delivery log and the matching Supabase purchase row. Do not mark a purchase paid manually just because the buyer returned to the site.
- Ticket inventory reservations are managed in Postgres. Pending reservations can expire; paid tickets count against configured limits, and refund handling must be verified before relying on capacity being released.
- The website does not currently promise QR codes, printable tickets, or an automated event-entry credential.

## Paid media

Paid media checkout requires the media item to be published, its price to be confirmed and greater than zero, and the original to use the configured private storage bucket. Private uploads are admin-only. A payment record does not by itself prove that the download-delivery path works; verify the signed webhook and the post-payment delivery flow separately.

## Database objects

- `event_ticket_options`: admin-managed ticket options, optional event link, fixed price, optional quantity limit, and availability switch.
- `ticket_purchases`: server-managed pending/paid/failed/refunded ticket purchase records.
- `stream_purchases`: livestream purchase records.
- `media_purchases`: paid media purchase records.
- `stripe_webhook_events`: idempotency ledger for Stripe webhook deliveries.
