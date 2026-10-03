# Resonance Collection — free SEO storefront

A static website generated from your real, live Etsy listings — same Etsy
connection the brand app uses, zero new Etsy app needed. Every product page
links out to its actual Etsy listing to buy; this site never touches
checkout or payments itself.

Hosted free, forever, on **GitHub Pages** — no card, no usage tier to
eventually outgrow, unlike most "free tier" hosting. Static HTML is also
genuinely better for SEO than a server-rendered app: every page is fully
present in the raw HTML a search crawler sees, with no JavaScript render
step required.

## What's actually in each page (verified, tested locally against sample data)

- `<title>` + meta description, truncated cleanly from the real listing
- Canonical URL
- Open Graph + Twitter Card tags (so a shared link gets a real preview image)
- JSON-LD `Product` structured data (price, stock status, image) — what lets
  Google show a price/rating snippet directly in search results
- `sitemap.xml` + `robots.txt`, regenerated every rebuild
- A plain "Buy on Etsy →" link per product, `rel="nofollow"` (correct — no
  paid relationship with Etsy, so no `sponsored` tag)

## Run it locally

```bash
npm run build          # needs an Etsy connection -- see below -- outputs to dist/
npx http-server dist   # or any static server, to preview before pushing
```

### Etsy connection

If you already have `bhippiee-brand-app` connected to Etsy on this same
machine (sibling folder), this script reuses that connection automatically
— nothing else to do. Otherwise, copy `.env.example` to `.env` and fill in
Simplest: `ETSY_CLIENT_ID` (app keystring) + `ETSY_SHOP_NAME` (+ `ETSY_SHARED_SECRET` if shown). Listings are public, so no login token is needed. Fallback: `ETSY_REFRESH_TOKEN` (get it by connecting
Etsy once in the brand app, then copying `refresh_token` out of its
`data/.etsy-token.json`).

## Deploy to GitHub Pages (free, one-time setup)

1. Create a new GitHub repo (public — free Actions minutes are unlimited on
   public repos) and push this folder to it.
2. Repo → **Settings → Pages** → Source: **GitHub Actions**.
3. Repo → **Settings → Secrets and variables → Actions**:
   - **Secrets**: `ETSY_CLIENT_ID`, `ETSY_SHARED_SECRET` (if any); **Variable**: `ETSY_SHOP_NAME`
   - **Variables**: `SITE_URL` (your real `https://<you>.github.io/<repo>`
     URL — GitHub shows you the exact address after step 2),
     `BRAND_NAME` (optional, defaults to "Resonance Collection")
4. Repo → **Actions** tab → run the workflow once manually (or just wait —
   it also runs automatically every push to `main` that touches `build.js`).

That's it — the site is live at the URL from step 3, and `.github/workflows/deploy.yml`
is the **SEO loop**: it reruns on a daily schedule automatically, pulling
whatever's live on Etsy right then and redeploying — new listings, price
changes, and sold-out items all stay current without you touching anything
again. Change the `cron:` line in that file to run more or less often.


## The owl, and the 2026-10-02 review

The homepage opens with the Bhippiee owl: its eyes (and a small head turn)
follow your cursor, or your finger on a phone. It's `owl.js` — no libraries —
and stays still for anyone with "reduce motion" turned on. The pupil
positions were measured on the real logo, not eyeballed. Change the line under
the name with the `TAGLINE` setting (default: "Everything is a vibration form.").

A critical review of the first version found and fixed:
- **Broken links on a normal GitHub Pages address.** Same-site links were
  root-relative (`/styles.css`), which 404 on `you.github.io/repo/`. All links
  now derive from `SITE_URL`, so both a project page and a custom domain work
  (tested at a `/repo/` subpath).
- Full-size Etsy images in the grid (now the 570px version; full size only on
  the product page), and fixed image dimensions so the page doesn't jump.
- External links now `rel="nofollow noopener"`.
- Added: favicon + touch icon, a 404 page, breadcrumbs (with structured data),
  `brand` and `sku` in the Product data, an Organization/WebSite block, sitemap
  `lastmod`, a default share image, a skip-to-content link, focus outlines,
  sold-out handling (page + structured data), and a link to your Etsy shop.
- The logo was 1.4 MB; the site copy is 215 KB, and the baked-in eye highlight
  was painted out so only the moving one shows.

Still true: tested with sample data shaped like Etsy's real response, **not
yet against your live shop**. The tagline is a placeholder for you to word.

## Honest status

Built and tested against synthetic data shaped exactly like Etsy's real API
response (confirmed field names via Etsy's own docs) — HTML output,
JSON-LD, sitemap XML, and the stylesheet were all verified rendering
correctly in a real browser. **Not yet run against your actual live Etsy
listings** — no Etsy connection existed in the environment this was built
in. The first real build against your real shop is the real test; if
something in the output looks off, it's almost certainly a mismatch between
assumed and actual field data, not the generation logic itself.
