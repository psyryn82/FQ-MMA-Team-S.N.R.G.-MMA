# Stripe integration status and launch checklist

This document describes the current FQ S.N.R.G. MMA payment architecture. The site does **not** sell memberships or recurring plans. Current payment paths are one-time event tickets, livestream access, and eligible paid media.

## Current checkout functions

- `supabase/functions/create-ticket-checkout/index.ts`: one-time event ticket checkout.
- `supabase/functions/create-stream-checkout/index.ts`: one-time livestream checkout.
- `supabase/functions/create-media-checkout/index.ts`: one-time paid photo/video checkout for eligible private media.
- `supabase/functions/stripe-webhook/index.ts`: verifies Stripe signatures and records eligible completed payments and related status changes.
- `supabase/functions/create-checkout-session/index.ts`: retired legacy membership endpoint. It returns HTTP 410 and is not used for public ticket sales.

The three active checkout functions use the server-side `STRIPE_SECRET_KEY` to determine Stripe mode. The code no longer hard-codes a test-only key requirement. A live deployment will create live sessions only if the secret configured in Supabase is a live secret key. Never put a Stripe secret key in GitHub, HTML, JavaScript, screenshots, or chat.

## Required Supabase Edge Function secrets

Configure these in the Supabase project's Edge Function secrets, not in repository files:

- `STRIPE_SECRET_KEY`: use the matching Stripe mode for the intended environment. Live payments require a key beginning with `sk_live_`.
- `STRIPE_WEBHOOK_SECRET`: signing secret for the webhook endpoint registered in that same Stripe mode.
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- Any other environment values explicitly read by the active function, such as `SITE_URL`, where applicable.

The public browser Supabase key is not a Stripe secret and must never be confused with the Stripe secret key. Do not share secret values. The key prefix can be checked privately without copying the key into a message.

## Stripe webhook

Endpoint:
`https://dmcbbavsxyxrxuuzraiu.supabase.co/functions/v1/stripe-webhook`

The endpoint must be registered in Stripe for the same mode as `STRIPE_SECRET_KEY`. A live Stripe key must be paired with the live-mode webhook signing secret, not a test-mode signing secret. The handler verifies `stripe-signature` and uses the `stripe_webhook_events` ledger for event idempotency. The handler supports ticket, stream, and media purchase metadata, as well as relevant checkout expiry/failure and refund events.

A configured secret alone does not prove delivery is working. Confirm successful delivery in Stripe's webhook event log and confirm the corresponding purchase status in Supabase after a controlled test.

## Safe launch and verification checklist

1. Confirm the deployed versions of `create-ticket-checkout`, `create-stream-checkout`, `create-media-checkout`, and `stripe-webhook` are active in the intended Supabase project.
2. Confirm privately that `STRIPE_SECRET_KEY` is the intended mode. Do not paste it into chat or commit it.
3. Confirm the webhook URL above is configured in the same Stripe mode and its signing secret is stored as `STRIPE_WEBHOOK_SECRET`.
4. First create a checkout session and verify the Stripe-hosted checkout page is in the intended mode. Opening checkout does not itself charge a customer, but completing it does.
5. Use Stripe test mode and test cards for test transactions. Do not use a real card or complete a live payment as a test without explicit authorization.
6. After a completed test payment, verify the signed webhook delivery and that only the matching purchase is marked paid. Also verify cancellation/expiry and refund behavior before relying on fulfillment.
7. For media, confirm the item is published, has a confirmed positive price, and uses the configured private storage path. Free/contact-only media follows a separate flow.
8. Confirm the public event/ticket option is linked to the intended event, sales are enabled, the displayed price is correct, and quantity limits are appropriate.
9. Do not claim end-to-end live payment readiness until the live key mode, live webhook delivery, purchase fulfillment, and refund behavior have been verified.

## Important limits

- A successful redirect to the site is not proof of payment. Purchase status must come from the verified Stripe webhook.
- A pending checkout is not a paid ticket or media entitlement.
- The website does not automatically issue QR codes or printable event-entry credentials unless a separate feature is implemented and tested.
- GitHub changes do not automatically deploy Supabase Edge Functions unless deployment automation is configured. Verify the active function version after each function deployment.
- The legacy membership endpoint is intentionally retired; do not restore membership-based checkout as part of the one-time ticket flow.

## Official references

- [Stripe testing](https://docs.stripe.com/testing)
- [Stripe API keys](https://dashboard.stripe.com/apikeys)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
