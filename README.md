# FQ MMA / Team S.N.R.G. MMA

Static website hosted from the repository root. The Supabase client uses only the project's public publishable key in browser files. Never place a Supabase service-role key or Stripe secret in HTML.

## Website and admin files

- `index.html`: public website, reads public content, published fighters, events, training schedule, and products from Supabase when available.
- `admin.html`: administrator dashboard for homepage JSON, fighters, events, schedule, merchandise, media uploads, membership plans/records, and signed-in-user chat inbox.
- `membership.html`: member sign-in/account creation, published plan list, and Stripe Checkout launcher.
- `supabase-schema.sql`: database tables, row-level security policies, and public media bucket setup.
- `supabase/functions/create-checkout-session/index.ts`: authenticated Stripe Checkout session creation.
- `supabase/functions/stripe-webhook/index.ts`: signed, idempotent Stripe webhook processing for membership status.
- `supabase/functions/create-protected-media-url/index.ts`: issues short-lived URLs for private media only after verifying an active membership for the plan encoded in the file path.
- `supabase/migrations/20261013_launch_readiness_hardening.sql`: hardens payment-record privileges, adds webhook idempotency, and creates a private media bucket.

## Supabase setup

1. Open the project's SQL Editor and run the full `supabase-schema.sql`. Re-running it is designed to be safe.
2. In **Authentication → Sign In Providers**, enable Google and configure the Google OAuth Client ID and Client Secret. Follow [Supabase's official Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).
3. In **Authentication → URL Configuration**, set the Site URL to `https://fq-snrg-mma.com` and add `https://fq-snrg-mma.com/**` and `https://www.fq-snrg-mma.com/**` to the allowed redirect URLs. Add any actual preview/testing URL only while needed.
4. In Google Cloud's OAuth client, add `https://fq-snrg-mma.com` and `https://www.fq-snrg-mma.com` as authorized JavaScript origins. Add the exact Supabase Auth callback URL shown on the Google provider page as an authorized redirect URI.
5. Create or sign in to the intended admin account. In SQL Editor, run:
   ```sql
   insert into public.admin_users (user_id, email)
   select id, email from auth.users
   where lower(email) = lower('fqsnrg.info@gmail.com')
   on conflict (user_id) do update set email = excluded.email;
   ```
   The account must already exist in Supabase Auth. Google and email/password sign-in must resolve to the same intended Auth user ID or the admin record must be updated to the correct ID.
6. In **Authentication → Security and Protection**, enable leaked-password protection if available for the project plan.
7. Open `https://fq-snrg-mma.com/admin.html` after the changes are approved and deployed. Test email/password and Google sign-in, then verify the dashboard rejects non-admin accounts.

## Stripe membership setup

The checkout and webhook function code is in the repository, but **paid checkout is not active until you configure and deploy it**.

1. Create a Stripe account and set up a test-mode product/payment setup as appropriate. First test with Stripe test keys.
2. Deploy `create-checkout-session` as a Supabase Edge Function with JWT verification enabled.
3. Apply `supabase/migrations/20261013_launch_readiness_hardening.sql` after reviewing the diff and confirming a recoverable backup exists. It removes browser-role privileges from legacy `stripe_purchases`, adds webhook event deduplication, and creates a private bucket. It expects the current `memberships` table and Stripe checkout columns from `supabase-schema.sql`.
4. Deploy `stripe-webhook` as an Edge Function with JWT verification disabled, because Stripe calls it directly. The repo's `supabase/config.toml` documents the intended per-function setting. In Stripe's webhook configuration, use the deployed function URL and subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.refunded`
5. Configure Edge Function secrets in Supabase, never in GitHub HTML:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SITE_URL=https://fq-snrg-mma.com`
   - Supabase Edge Functions also need their project URL and anon key available as `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
6. Deploy `create-protected-media-url` with JWT verification enabled. Apply the hardening migration before deploying the webhook, because the webhook uses `stripe_webhook_events` and the payment-intent column.
7. Create and publish membership plans in `admin.html`, then test a checkout using Stripe test cards. Verify successful, failed, duplicate, refunded, and subscription renewal/payment-failure events. Only the signed webhook should change paid checkout status.
6. Switch to Stripe live credentials only after test-mode verification.

The private-media endpoint only signs files stored in `fqmma-private` under `<membership-plan-uuid>/<filename>` and only for admins or users with an active membership for that plan. The current membership records are not, by themselves, a complete protected live-stream paywall. A trusted stream provider and a player integration that calls the protected URL endpoint are still required before selling stream access. Product listings can link to a real external checkout URL; this project does not itself process merchandise payments.

## Storage, chat, and content notes

- `fqmma-media` is for ordinary public team/event media only. Never upload paid videos or private member information to this bucket.
- `fqmma-private` is for paid media. Upload files beneath the membership plan UUID folder and serve them only through `create-protected-media-url`, which returns a five-minute signed URL after an entitlement check. Never paste private object paths into public homepage JSON.
- The fan chat is shared by signed-in users; chat input is disabled until sign-in. Fan-chat rows are isolated from private support conversations with a channel field and RLS. The admin inbox can still review both kinds of messages.
- Homepage JSON is stored in `site_content` under `content_key='public'`. The admin editor includes a starter template; keep the expected fields: `general`, `disciplines`, `schedule`, `fighters`, `store`, `portfolio`, and `promos`.
- The website still needs real verified team details, event information, product links, privacy/terms content, and a protected stream provider before public launch.
- Never put service-role keys, Stripe keys, webhook secrets, or passwords into `index.html`, `admin.html`, `membership.html`, or any public repository file.

## GitHub Pages deployment

GitHub Pages deploys the root of `main`. The changes on a working branch do not affect the live site until merged. Confirm GitHub Pages status and test on desktop and mobile after deployment.
