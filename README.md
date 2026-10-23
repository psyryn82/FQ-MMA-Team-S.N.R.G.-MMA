# FQ MMA / Team S.N.R.G. MMA

Static public website hosted from the repository root on GitHub Pages. Browser code uses only the Supabase publishable key. **Never put a Supabase service-role key, Stripe secret, webhook secret, or password in a public file.**

## Current website files

- `index.html`: public website, public event schedule, published fighters and training schedule, media/product listings, signed-in fan chat, and event-ticket checkout.
- `admin.html`: the canonical administrator dashboard. Use `https://fq-snrg-mma.com/admin.html`. It manages homepage content, fighters, events, training schedule, merchandise/media purchase links, public/private uploads, ticket options and purchase records, and the chat inbox.
- `membership.html`: member sign-in/account creation and fan chat. It is not a membership-payment page; event tickets are purchased from the public event listings.
- `docs/TICKET_SALES_SETUP.md`: current ticket-option setup, purchase records, and test-mode safety notes.
- `supabase/functions/create-ticket-checkout/index.ts`: server-side Stripe Checkout for event tickets. Checkout mode follows the Supabase `STRIPE_SECRET_KEY`. The current live-stream configuration has been reported as live-mode; do not complete live checkouts during testing. Verify Stripe mode, webhook delivery, cancellation/expiry, paid access, and refund handling in test mode before relying on fulfillment.
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

Ticket checkout mode follows the server-side `STRIPE_SECRET_KEY`. Confirm the key is in Stripe test mode before testing. Never complete a live checkout for testing.

1. In `admin.html`, create or edit an event. Keep it in Draft while it is only a placeholder. Use Upcoming or Live only for a real event that is ready to be announced.
2. Open **Ticket options**, set the ticket name, description, fixed price, and optional quantity limit.
3. Leave sales off while preparing. Link the option to its event and enable availability only when the event is ready to sell tickets.
4. Use **Ticket purchases** to review records. Pending checkout is not proof of payment; only the signed Stripe webhook can mark a purchase paid.
5. Follow `docs/TICKET_SALES_SETUP.md` for the current ticket flow and testing notes.

**Launch gate:** do not advertise ticket or media checkout as fully verified until test-mode checkout, webhook fulfillment, cancellation/expiry, playback/download authorization, and refund handling have been checked. This repository change does not switch Stripe mode or deploy functions. The site does not yet promise QR codes, printable tickets, or automated entry credentials.

## Event admission vs livestream access

Fight Quest XVI in-person admission is separate from online livestream access: General Admission is $45, VIP Ringside is $85, and the one-time livestream ticket is $35 for live viewing only, with no replay or on-demand access. The in-person prices and venue purchase link are informational and are not processed by the livestream checkout.

## Media, uploads, and chat

- **Fight Media** and **Portfolio Media** keep photo/video originals in private storage for confirmed one-time purchase and authorized download. Uploaded videos use Livepeer for JWT-protected paid on-site playback after processing; the original stays private. Media VOD playback is separate from event livestreams, which are managed under Tickets → Livestream Access.
- The public website reads listing-only fields from `public.public_media_catalog`; private object paths, storage bucket names, and Livepeer asset metadata are not part of that public view.
- `fqmma-private` is the private original bucket. The matching migration sets its per-file limit to 5 GiB, matching the admin uploader. Public listing imagery belongs in `fqmma-media` only when intentionally approved..
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
