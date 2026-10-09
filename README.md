# FQ MMA / Team S.N.R.G. MMA - Live Stream Site

Static site (no build step). Files: `index.html` plus 3 images. Keep them in the same folder.

## 1. Edit your settings
Open `index.html`, find `const CONFIG`, and fill in:
- `passUrl`: your stream pass purchase link
- `embedHtml`: your YoloCast player embed code
- `supportEmail`, `mediaUrl`, `sponsorUrl`

Also search the file for `[` to find placeholders (About text, prices, fighters).

## 2. Host it on GitHub Pages (free)
1. Create a free account at github.com and click New repository (name it e.g. `fqmma-live`, set Public).
2. Click "uploading an existing file" and drag in ALL files from this folder. Commit.
3. Go to Settings > Pages. Under Branch choose `main` and `/ (root)`. Save.
4. After about a minute your site is live at `https://YOURNAME.github.io/fqmma-live/`.

## Other free hosts
Netlify Drop (drag the folder onto app.netlify.com/drop) or Cloudflare Pages work the same way.

## Custom domain (optional)
Settings > Pages > Custom domain, then add the DNS records your domain provider shows.
