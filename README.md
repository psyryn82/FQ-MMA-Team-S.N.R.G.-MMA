# FQ MMA / Team S.N.R.G. MMA

Static public website hosted from the repository root on GitHub Pages. Browser code uses only the Supabase publishable key. **Never put a Supabase service-role key, Stripe secret, webhook secret, or password in a public file.**

## Current website files

- `index.html`: public website, public event schedule, published fighters and training schedule, media/product listings, signed-in fan chat, and event-ticket checkout.
- `admin.html`: the canonical administrator dashboard. Use `https://fq-snrg-mma.com/admin.html`. It manages homepage content, fighters, events, training schedule, merchandise/media purchase links, public/private uploads, ticket options and purchase records, and the chat inbox.
- `docs/TICKET_SALES_SETUP.md`: current ticket-option setup, purchase records, and test-mode safety notes.
- `supabase/functions/create-ticket-checkout/index.ts`: server-side, test-mode-only Stripe Checkout creation for event tickets.
- `supabase/functions/stripe-webhook/index.ts`: signed Stripe webhook processing. Ticket purchases are marked paid only after verified Stripe payment.
- `supabase/migrations/`: database changes. Review the actual live migration history before applying any migration.

The public homepage and the admin dashboard are separate pages. The homepage's admin button and Ctrl+Shift+A shortcut route to the same canonical dashboard.

## Current live configuration

The live Supabase project is already connected to the website. Google sign-in and the approved administrator record have been configured. Do not rerun the old full schema file or copy old membership setup instructions into the live project without reviewing the current database and migrations first.

For an administrator to sign in:
1. Open `https://fq-snrg-mma.com/admin.html`.
2. Use email/password or Google sign-in.
3. The authenticated Supabase user ID must have an approved row in `public.admin_users`. A Google account that signs in successfully is not automatically an administrator.
4. Never add a service-role key to the dashboard. Admin authorization is enforced by Supabase Auth and row-level security.

For a fresh environment, configure Google under **Authentication → Sign In Providers**, set the Supabase Site URL to `https://fq-snrg-mma.com`, and allow the exact production redirect URLs. Add the website origins and the Supabase callback URL to the Google OAuth client as required by Supabase's [Google sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Event ticket sales

Ticket checkout is deliberately restricted to a Stripe **test secret key** (`sk_test_...`). The checkout function rejects live Stripe keys.

1. In `admin.html`, create or edit an event. Keep it in Draft while it is only a placeholder. Use Upcoming or Live only for a real event that is ready to be announced.
2. Open **Ticket options**, set the ticket name, description, fixed price, and optional quantity limit.
3. Leave sales off while preparing. Link the option to its event and enable availability only when the event is ready to sell tickets.
4. Use **Ticket purchases** to review records. Pending checkout is not proof of payment; only the signed Stripe webhook can mark a purchase paid.
5. Follow `docs/TICKET_SALES_SETUP.md` for the current ticket flow and testing notes.

**Do not enable Stripe live mode yet.** The ticket flow still needs a complete test-mode checkout/webhook/refund verification, and the site does not yet issue QR codes, printable tickets, or automated entry credentials.

## Media, uploads, and chat

- **Media & purchase links** publishes public listings with an external purchase URL. The customer completes the purchase through that external provider; this site does not currently fulfill paid downloads.
- `fqmma-media` is for public team/event imagery.
- `fqmma-private` is an admin-only archive. Private archive uploads are not automatically sold or delivered to customers.
- Fan chat is for signed-in users. The admin inbox can review messages according to the database RLS policies.
- Homepage content is stored in `public.site_content` under `content_key = 'public'`. The editor expects JSON containing `general`, `disciplines`, `schedule`, `fighters`, `store`, `portfolio`, and `promos`. Validate JSON before saving.

## Deferred work and launch gates

- **Live-stream checkout and playback are parked for later.** Keep stream sales disabled. Do not change provider credentials, playback settings, or stream purchase code while working on unrelated website fixes.
- The old membership checkout and membership-based private-media delivery are retired. Do not deploy or follow legacy membership instructions from old commits. Legacy files/tables may remain for compatibility, but they are not the current purchase flow.
- Before public launch, verify the ticket checkout and webhook in Stripe test mode, review event content and external purchase links, confirm privacy/terms/contact information, and test the website and admin dashboard on desktop and mobile.
- Keep all server-side secrets in Supabase Edge Function secrets. Never commit them to GitHub.

## GitHub Pages deployment

GitHub Pages serves the repository root from `main`. Changes on other branches do not affect the public site until merged. After a site change, confirm the deployed page reflects the latest commit and check the relevant desktop/mobile layout.
