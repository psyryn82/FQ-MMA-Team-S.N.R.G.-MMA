# Stripe Integration TODO

This file is the single source of truth for the remaining Stripe setup and verification work for FQ S.N.R.G. MMA.

## Values to Replace

The following value is a placeholder and must be updated before testing checkout.

**Files containing placeholders:**
- [membership.html](membership.html)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| STRIPE_PUBLISHABLE_KEY | `pk_test_REPLACE_WITH_PUBLISHABLE_KEY` | Replace with the Stripe **test publishable key** (`pk_test_...`) from [Stripe test API keys](https://dashboard.stripe.com/test/apikeys). This is intended to be public; never put a secret key in this file. Before going live, switch to the live publishable key only after completing live-mode setup. |

The Checkout Session `line_items` are generated from the published `membership_plans` rows in Supabase using their current price, currency, name, description, and billing interval. They are not hard-coded placeholder Price IDs. The `mode` is selected from the plan's billing interval: one-time plans use `payment`; monthly/yearly plans use `subscription`.

## Configured Parameters

**Files containing these parameters:**
- [supabase/functions/create-checkout-session/index.ts](supabase/functions/create-checkout-session/index.ts)
- [membership.html](membership.html)

| Parameter | Value |
|-----------|-------|
| ui_mode | `custom` (Stripe SDK is pinned to version 17.7.0, below 21.0.0) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| payment_method_collection | `always`, only for subscription plans |
| submit_type | `pay` |
| name_collection | `{ individual: { enabled: true, optional: true } }` |
| saved_payment_method_options | `{ payment_method_save: "enabled" }` |
| integration_identifier | `custom_embedded_web_0001` |
| Stripe API version | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| Stripe.js | Loaded directly from `https://js.stripe.com/dahlia/stripe.js` |
| Checkout Form beta | `custom_checkout_payment_form_1` |
| Appearance | Night theme, floating labels, condensed inputs, red primary color, Roboto, 4px border radius |

## Setup and Next Steps

1. Replace the placeholder `STRIPE_PUBLISHABLE_KEY` in [membership.html](membership.html) with the test publishable key from Stripe.
2. In Supabase Edge Function secrets, verify the function has the required values set privately: `STRIPE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The webhook also needs `STRIPE_WEBHOOK_SECRET`. Never put secret values in GitHub or browser code.
3. Deploy the updated `create-checkout-session` Edge Function from [supabase/functions/create-checkout-session/index.ts](supabase/functions/create-checkout-session/index.ts) to the existing Supabase project. GitHub commits do not automatically deploy this function unless you have deployment automation configured.
4. Keep Stripe in test mode while testing. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date, any three-digit CVC, and a test postal code. Use only test-mode keys and products.
5. Confirm the embedded form loads from the ticket options page, test a successful payment and a declined test payment, and inspect Supabase function logs and Stripe webhook delivery logs.
6. Confirm that a successful payment updates the correct membership/ticket record. The current webhook implementation expects membership metadata (`user_id` and `plan_id`) on the Checkout Session. The Checkout Studio parameter list did not include those metadata fields, so **fulfillment must be reconciled before relying on paid-ticket access**. Do not launch paid content until the webhook can reliably match the verified Stripe session to the correct pending membership and activate it.
7. Test refunds and subscription status changes if you plan to sell recurring memberships. Review the webhook's refund behavior separately before offering refunds or relying on automatic access revocation.
8. Only after all tests pass, configure live-mode Stripe keys and a live-mode webhook destination, update the public publishable key, and test with a small real transaction.

## Project Structure

- `membership.html`: ticket selection, sign-in, and embedded Stripe Checkout Form.
- `supabase/functions/create-checkout-session/index.ts`: server-side Checkout Session creation and pending membership recording.
- `supabase/functions/stripe-webhook/index.ts`: existing webhook handler; its metadata-based fulfillment expectations need to be reconciled with the Checkout Session fields before launch.

## How the Integration Works

1. A customer signs in on the ticket page.
2. The browser requests a Checkout Session from the Supabase Edge Function using the selected published plan.
3. The server validates the user's Supabase session and retrieves price details from Supabase, then creates a Stripe Checkout Session.
4. The server returns the session's `client_secret`; Stripe.js renders the embedded payment form.
5. Stripe confirms the payment and sends events to the configured webhook.
6. The webhook must verify the Stripe signature and match the paid session to the pending membership before granting ticket or video access. This final fulfillment link still requires verification.

## Testing and Resources

- Stripe test cards: [Stripe testing documentation](https://docs.stripe.com/testing)
- Stripe API keys: [Stripe test API keys](https://dashboard.stripe.com/test/apikeys)
- Stripe support: [https://support.stripe.com](https://support.stripe.com)
- Stripe docs: [https://docs.stripe.com/mcp](https://docs.stripe.com/mcp)
