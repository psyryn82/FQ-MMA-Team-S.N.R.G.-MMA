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

Paid checkout is **not launch-ready** until the database migration, Edge Function secrets, webhook registration, and end-to-end tests below are complete. Start in Stripe test mode.

1. Create/configure a Stripe account in test mode. Do not use live credentials during initial verification.
2. Confirm a recoverable Supabase backup exists, then review and apply `supabase/migrations/20261013_launch_readiness_hardening.sql`. It hardens legacy payment-record privileges, adds webhook idempotency, and creates the private media bucket. It expects the current `memberships` table and Stripe checkout columns from `supabase-schema.sql`.
3. Configure Edge Function secrets in Supabase, never in GitHub HTML:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SITE_URL=https://fq-snrg-mma.com`
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` (confirm the project's Edge Functions environment provides these values).
4. Deploy `create-checkout-session` with JWT verification enabled, `stripe-webhook` with JWT verification disabled, and `create-protected-media-url` with JWT verification enabled. The webhook must verify `Stripe-Signature` against the webhook secret inside the handler. Never disable signature verification.
5. Register a Stripe **test-mode** webhook pointing to the deployed `stripe-webhook` URL and subscribe to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `charge.refunded`
6. Create and publish membership plans in `admin.html`. Test successful, declined, delayed/failed, duplicate webhook, refund, subscription renewal, and subscription payment-failure cases. Confirm a paid checkout activates only the matching user/plan membership and that failed or refunded payments do not retain access.
7. For paid media, upload files to `fqmma-private` under `<membership-plan-uuid>/<filename>`. Use `create-protected-media-url` to issue a five-minute signed URL only after entitlement verification. Do not paste private object URLs into public homepage JSON. A trusted live-stream provider and a player integration that calls the protected URL endpoint are still required before selling live-stream access.
8. Switch to Stripe live credentials only after all test-mode cases pass and a live-mode webhook endpoint is registered and verified. The connected account previously inspected was in test mode; live-mode readiness has not been established.

## Storage, chat, and content notes

- `fqmma-media` is for ordinary public team/event media only. Never upload paid videos or private member information to this bucket.
- `fqmma-private` is for paid media. Upload files beneath the membership plan UUID folder and serve them only through `create-protected-media-url`, which returns a five-minute signed URL after an entitlement check. Never paste private object paths into public homepage JSON.
- The fan chat is shared by signed-in users; chat input is disabled until sign-in. Fan-chat rows are isolated from private support conversations with a channel field and RLS. The admin inbox can still review both kinds of messages.
- Homepage JSON is stored in `site_content` under `content_key='public'`. The admin editor includes a starter template; keep the expected fields: `general`, `disciplines`, `schedule`, `fighters`, `store`, `portfolio`, and `promos`.
- The website still needs real verified team details, event information, product links, privacy/terms content, and a protected stream provider before public launch.
- Never put service-role keys, Stripe keys, webhook secrets, or passwords into `index.html`, `admin.html`, `membership.html`, or any public repository file.

## GitHub Pages deployment

GitHub Pages deploys the root of `main`. The changes on a working branch do not affect the live site until merged. Confirm GitHub Pages status and test on desktop and mobile after deployment.
