# FQ MMA / Team S.N.R.G. MMA

This is a static website: there is no build step and no backend is needed to publish the public site. The homepage uses bundled defaults and shows honest “coming soon” or “not configured” states until real event, fighter, stream, and purchase information is supplied.

## Deploy with GitHub Pages

1. Push or merge the site files to the repository's `main` branch.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/(root)`, then save.
4. Wait for the Pages deployment to finish. Confirm the generated `github.io` address loads over HTTPS.
5. To use `fq-snrg-mma.com`, configure that custom domain in Pages and set the DNS records at the domain provider to the values GitHub Pages specifies. The root `CNAME` file is already included. Enable HTTPS in Pages once DNS verification completes.

The same repository root can be deployed to another static host (for example, Cloudflare Pages or Netlify) with no build command and no publish-directory setting beyond the root directory. Configure the custom domain and HTTPS with that host if you use one.

## Before announcing the site

- Confirm the published page, images, mobile navigation, and custom-domain HTTPS work on a phone and desktop.
- Supply only verified team information, event dates and locations, fighter profiles, official contact details, and real ticket, payment, or stream URLs. The page intentionally does not invent these details.
- Add a real checkout and stream provider before offering paid access. The current site does not process payments, verify purchases, or provide a live stream; the browser-only promo-code UI is not payment or access control.
- Check the repository's **Settings → Pages** deployment status. No hosting or DNS changes are made by this repository.

## Optional Supabase admin

The public site works without Supabase. To enable the optional admin/backend features:

1. Create and configure your own Supabase project.
2. Run `supabase-schema.sql` in its SQL Editor and authorize an administrator as described at the end of that file.
3. Put the project URL and **publishable** key in the `SUPABASE_URL` and `SUPABASE_ANON_KEY` settings near the top of `index.html`, and the corresponding `CONFIG` values in `admin.html`.
4. Never put a Supabase `service_role` key or other secret in either HTML file.

The homepage reads and saves its optional content as JSON in the `site_content` row whose `content_key` is `public`. Admin login, homepage content, fighters, and events use the included schema. Stream delivery, checkout/payment verification, media storage, membership entitlements, and live-chat tables are not configured by this repository and must not be represented as active until their services and server-side authorization are implemented.
