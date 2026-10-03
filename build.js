'use strict';
/* Static SEO storefront generator for the Resonance Collection t-shirt
 * brand — pulls real listings from the SAME Etsy connection the brand app
 * already uses, generates plain static HTML (no framework, no build step
 * beyond this script), deployable free-forever on GitHub Pages.
 *
 * Why static, not the existing Node app: GitHub Pages is genuinely free
 * with no usage tier to eventually hit, unlike Railway's execution-based
 * free tier — and static HTML is itself better for SEO (fast load, every
 * page fully present in the raw HTML with no client-side render step a
 * crawler has to execute).
 *
 * The site only LINKS to the real Etsy listing to buy — it never attempts
 * checkout itself. Etsy remains the one place money actually changes hands.
 *
 * Two ways to authenticate, so this works both on your machine and in CI:
 * 1. Local: reuses ../bhippiee-brand-app/data/.etsy-token.json if present.
 * 2. CI (GitHub Actions): ETSY_CLIENT_ID + ETSY_REFRESH_TOKEN as secrets.
 *    Get a refresh token once by connecting Etsy in the brand app locally,
 *    then copying refresh_token out of its data/.etsy-token.json.
 *
 * Run: node build.js   (outputs to dist/)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const BRAND_NAME = process.env.BRAND_NAME || 'Resonance Collection';
const SITE_URL = (process.env.SITE_URL || 'https://example.github.io').replace(/\/$/, '');
const LOCAL_TOKEN_FILE = path.join(ROOT, '..', 'bhippiee-brand-app', 'data', '.etsy-token.json');

/* ---------- tiny .env loader (same pattern as the brand app) ---------- */
(function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();

function httpsCall(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, (r) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(data); } catch (e) {} resolve({ status: r.statusCode, json: j, text: data }); });
    });
    req.on('error', reject);
    req.end();
  });
}
function httpsForm(url, params) {
  const payload = querystring.stringify(params);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) } }, (r) => {
      let data = ''; r.on('data', (c) => (data += c));
      r.on('end', () => { let j = null; try { j = JSON.parse(data); } catch (e) {} resolve({ status: r.statusCode, json: j, text: data }); });
    });
    req.on('error', reject); req.write(payload); req.end();
  });
}

async function getAccessToken() {
  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) throw new Error('ETSY_CLIENT_ID not set (.env locally, or a repo secret in CI)');
  let refreshToken = process.env.ETSY_REFRESH_TOKEN;
  if (!refreshToken && fs.existsSync(LOCAL_TOKEN_FILE)) {
    const tok = JSON.parse(fs.readFileSync(LOCAL_TOKEN_FILE, 'utf8'));
    // Still-fresh access token from the brand app -- use it directly, no refresh call needed.
    if (tok.access_token && tok.at && Date.now() - tok.at < 3500_000) return tok.access_token;
    refreshToken = tok.refresh_token;
  }
  if (!refreshToken) throw new Error('No Etsy connection found. Connect Etsy in the brand app first (creates data/.etsy-token.json), or set ETSY_REFRESH_TOKEN.');
  const r = await httpsForm('https://api.etsy.com/v3/public/oauth/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
  if (!r.json || !r.json.access_token) throw new Error('Etsy token refresh failed: ' + r.text.slice(0, 300));
  return r.json.access_token;
}

// Etsy's x-api-key: the app's keystring. Newer apps need "keystring:shared_secret" (colon-joined);
// set ETSY_SHARED_SECRET to send that form. The keystring alone is what older apps use.
function apiKeyHeader() {
  const keystring = process.env.ETSY_CLIENT_ID;
  if (!keystring) throw new Error('ETSY_CLIENT_ID (the app keystring) is not set (.env locally, or a repo secret in CI)');
  return process.env.ETSY_SHARED_SECRET ? `${keystring}:${process.env.ETSY_SHARED_SECRET}` : keystring;
}

// SIMPLE PATH (2026-10-03): a shop's active listings are public, so with just the app key and the
// shop's name there is no login token to fetch, store, or rotate. `call` is injectable for testing.
async function fetchPublic(apiKey, shopName, call = httpsCall) {
  const headers = { 'x-api-key': apiKey };
  const shops = await call(`https://api.etsy.com/v3/application/shops?shop_name=${encodeURIComponent(shopName)}`, { headers });
  const shop = shops.json && shops.json.results && shops.json.results[0];
  if (!shop) throw new Error(`Etsy shop "${shopName}" not found, or the key was refused (HTTP ${shops.status}): ${String(shops.text).slice(0, 200)}`);
  const listings = await call(
    `https://api.etsy.com/v3/application/shops/${shop.shop_id}/listings/active?limit=100&includes=Images`, { headers });
  if (!listings.json || !listings.json.results) throw new Error(`Etsy listings fetch failed (HTTP ${listings.status}): ${String(listings.text).slice(0, 200)}`);
  return { shop, listings: listings.json.results };
}

// FALLBACK: the login-token path, if the public one is refused or no shop name is set.
async function fetchWithOAuth() {
  const accessToken = await getAccessToken();
  const headers = { 'x-api-key': apiKeyHeader(), Authorization: 'Bearer ' + accessToken };
  const me = await httpsCall('https://api.etsy.com/v3/application/users/me', { headers });
  if (!me.json || !me.json.user_id) throw new Error('Etsy /users/me failed: ' + me.text.slice(0, 300));
  const shops = await httpsCall(`https://api.etsy.com/v3/application/users/${me.json.user_id}/shops`, { headers });
  const shop = shops.json && (shops.json.results ? shops.json.results[0] : shops.json.shop_id ? shops.json : null);
  if (!shop) throw new Error('No Etsy shop found for this account');
  const listings = await httpsCall(
    `https://api.etsy.com/v3/application/shops/${shop.shop_id}/listings/active?limit=100&includes=Images`, { headers });
  if (!listings.json || !listings.json.results) throw new Error('Etsy listings fetch failed: ' + listings.text.slice(0, 300));
  return { shop, listings: listings.json.results };
}

async function fetchListings() {
  const apiKey = apiKeyHeader();
  const shopName = process.env.ETSY_SHOP_NAME;
  if (shopName) {
    try { return await fetchPublic(apiKey, shopName); }
    catch (e) {
      if (!(process.env.ETSY_REFRESH_TOKEN || fs.existsSync(LOCAL_TOKEN_FILE))) throw e;
      console.warn('Public fetch failed (' + e.message + ') -- falling back to the login-token path.');
    }
  }
  return fetchWithOAuth();
}

/* ---------- SEO-first HTML templates ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const money = (p) => p ? (p.amount / p.divisor).toFixed(2) + ' ' + p.currency_code : '';
const metaDescription = (text, max = 155) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
};

// REVIEW FIX #1: on a normal GitHub Pages address (you.github.io/repo/) the site lives under
// /repo/, so root-relative links like "/styles.css" 404. BASE is '' on a custom domain and
// '/repo' on a project page, derived from SITE_URL, and every same-site link goes through link().
const BASE = new URL(SITE_URL).pathname.replace(/\/$/, '');
const link = (p) => BASE + p;
const LOGO_URL = `${SITE_URL}/assets/logo-640.png`;
const TAGLINE = process.env.TAGLINE || 'Everything is a vibration form.';
let SHOP_URL = '';   // set from the real Etsy shop in writeSite()

// REVIEW FIX #3: the grid was loading full-size Etsy images (several MB per page). Use Etsy's
// 570px version for thumbnails and the full one only on the product page.
const imgOf = (l, size) => { const im = l.images && l.images[0]; return im ? (im[size] || im.url_fullxfull) : null; };
const productUrl = (l) => `${SITE_URL}/products/${slugify(l.title)}-${l.listing_id}.html`;

function pageShell({ title, description, canonical, ogImage, bodyHtml, jsonLd, scripts = '', noindex = false }) {
  const ld = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b0d10">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" type="image/png" href="${link('/assets/favicon.png')}">
<link rel="apple-touch-icon" href="${link('/assets/apple-touch-icon.png')}">
<link rel="preconnect" href="https://i.etsystatic.com" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(BRAND_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage || LOGO_URL)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="${link('/styles.css')}">
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header><a href="${link('/')}" class="brand">${esc(BRAND_NAME)}</a>${SHOP_URL ? `<a class="shoplink" href="${esc(SHOP_URL)}" rel="noopener" target="_blank">Etsy shop ↗</a>` : ''}</header>
<main id="main">${bodyHtml}</main>
<footer><p>${esc(BRAND_NAME)} — every item links out to its real Etsy listing to purchase.${SHOP_URL ? ` <a href="${esc(SHOP_URL)}" rel="noopener" target="_blank">Visit the Etsy shop</a>.` : ''}</p></footer>
${scripts}
</body>
</html>`;
}

function productPage(listing) {
  const img = imgOf(listing, 'url_fullxfull');
  const title = `${listing.title} — ${BRAND_NAME}`;
  const url = productUrl(listing);
  const soldOut = !(listing.quantity > 0);
  const jsonLd = [
    {
      '@context': 'https://schema.org/', '@type': 'Product', name: listing.title, sku: String(listing.listing_id),
      brand: { '@type': 'Brand', name: BRAND_NAME },
      description: metaDescription(listing.description, 500), image: img ? [img] : undefined,
      offers: { '@type': 'Offer', priceCurrency: listing.price && listing.price.currency_code,
        price: listing.price ? (listing.price.amount / listing.price.divisor).toFixed(2) : undefined,
        availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock', url: listing.url },
    },
    { '@context': 'https://schema.org/', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: BRAND_NAME, item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: listing.title, item: url } ] },
  ];
  const body = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="${link('/')}">${esc(BRAND_NAME)}</a> › <span>${esc(listing.title)}</span></nav>
    <article class="product">
      ${img ? `<img src="${esc(img)}" alt="${esc(listing.title)}" width="570" height="570">` : ''}
      <h1>${esc(listing.title)}</h1>
      <p class="price">${esc(money(listing.price))}</p>
      <p class="desc">${esc(listing.description || '').slice(0, 1500)}</p>
      ${soldOut ? '<p class="soldout">Sold out right now.</p>' : ''}
      <a class="buy" href="${esc(listing.url)}" rel="nofollow noopener" target="_blank">${soldOut ? 'See it on Etsy' : 'Buy on Etsy'} →</a>
    </article>`;
  return { url, html: pageShell({ title, description: metaDescription(listing.description) || `${listing.title} from ${BRAND_NAME}.`,
    canonical: url, ogImage: img, bodyHtml: body, jsonLd }) };
}

function indexPage(listings) {
  const url = `${SITE_URL}/`;
  const grid = listings.map((l) => {
    const img = imgOf(l, 'url_570xN');
    return `<a class="card" href="${link('/products/' + slugify(l.title) + '-' + l.listing_id + '.html')}">
      ${img ? `<img src="${esc(img)}" alt="${esc(l.title)}" width="570" height="570" loading="lazy">` : ''}
      <h2>${esc(l.title)}</h2><p class="price">${esc(money(l.price))}</p></a>`;
  }).join('\n');
  const jsonLd = [
    { '@context': 'https://schema.org/', '@type': 'WebSite', name: BRAND_NAME, url },
    { '@context': 'https://schema.org/', '@type': 'Organization', name: BRAND_NAME, url, logo: LOGO_URL },
  ];
  const hero = `
    <section class="hero">
      <div class="owl-wrap" id="owl">
        <img src="${link('/assets/logo-640.png')}" alt="Bhippiee owl logo" width="640" height="640" fetchpriority="high">
        <i class="glint" id="glintL" aria-hidden="true"></i><i class="glint" id="glintR" aria-hidden="true"></i>
      </div>
      <h1>${esc(BRAND_NAME)}</h1>
      <p class="tagline">${esc(TAGLINE)}</p>
    </section>`;
  return pageShell({
    title: `${BRAND_NAME} — vibration-inspired t-shirts`,
    description: `${BRAND_NAME}: ${listings.length} t-shirt designs. ${TAGLINE} Every piece links straight to its Etsy listing.`,
    canonical: url, ogImage: LOGO_URL,
    bodyHtml: `${hero}<h2 class="section">The collection</h2><div class="grid">${grid}</div>`, jsonLd,
    scripts: `<script src="${link('/owl.js')}" defer></script>`,
  });
}

function sitemap(pages) {
  const today = new Date().toISOString().slice(0, 10);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join('\n') + `\n</urlset>`;
}
const ROBOTS = (sitemapUrl) => `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`;
const STYLES = `:root{color-scheme:dark light;--bg:#0b0d10;--fg:#eee;--muted:#9aa;--accent:#7dd3c0}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;margin:0;line-height:1.5}
a{color:var(--accent)}a:focus-visible,.buy:focus-visible,.card:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip{position:absolute;left:-999px;top:0;background:#000;color:#fff;padding:8px 12px;z-index:10}.skip:focus{left:8px;top:8px}
header{padding:16px 24px;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;gap:12px}
.brand{color:var(--fg);text-decoration:none;font-weight:700;font-size:1.2rem}.shoplink{font-size:.9rem;text-decoration:none}
main{max-width:900px;margin:0 auto;padding:24px}
.hero{text-align:center;padding:12px 0 28px}.hero h1{margin:16px 0 4px;font-size:1.8rem}.tagline{color:var(--muted);margin:0}
.owl-wrap{position:relative;width:min(320px,70vw);aspect-ratio:1;margin:0 auto;border-radius:24px;overflow:hidden;background:#f6f2e2;will-change:transform;transition:transform .12s ease-out}
.owl-wrap img{width:100%;height:100%;display:block}
.glint{position:absolute;width:3.4%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fffdf5,#e8e0c8 70%);pointer-events:none;transition:transform .08s ease-out;left:33.2%;top:38.6%;transform:translate(-50%,-50%)}
h2.section{font-size:1.1rem;color:var(--muted);font-weight:600;margin:8px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.card{color:inherit;text-decoration:none;border:1px solid #222;border-radius:8px;overflow:hidden;display:block}
.card img,article.product img{width:100%;height:auto;aspect-ratio:1;object-fit:cover;display:block}
.card h2{font-size:1rem;margin:8px 12px 2px}.card .price{margin:0 12px 10px;color:var(--accent)}
.crumbs{font-size:.85rem;color:var(--muted);margin-bottom:12px}.crumbs a{color:var(--muted)}
article.product{max-width:500px;margin:0 auto}article.product .price{color:var(--accent);font-size:1.2rem}
.desc{white-space:pre-line}.soldout{color:#e9a}
.buy{display:inline-block;margin-top:12px;padding:12px 20px;background:var(--accent);color:#000;text-decoration:none;border-radius:6px;font-weight:700}
footer{text-align:center;color:var(--muted);padding:24px;font-size:.85rem}
@media (prefers-reduced-motion:reduce){.owl-wrap,.glint{transition:none}}`;
const PAGE_404 = () => pageShell({ title: `Page not found — ${BRAND_NAME}`, description: 'That page does not exist.',
  canonical: `${SITE_URL}/404.html`, noindex: true,
  bodyHtml: `<h1>Page not found</h1><p>That page does not exist. <a href="${link('/')}">Back to the collection</a>.</p>` });

// Writes the whole site to outDir. Split out of build() so it can be tested with sample listings.
function writeSite(listings, shop, outDir = DIST) {
  SHOP_URL = (shop && shop.url) || '';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'products'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
  const pageUrls = [`${SITE_URL}/`];
  for (const l of listings) {
    const { url, html } = productPage(l);
    fs.writeFileSync(path.join(outDir, 'products', path.basename(url)), html);
    pageUrls.push(url);
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(listings));
  fs.writeFileSync(path.join(outDir, '404.html'), PAGE_404());
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap(pageUrls));
  fs.writeFileSync(path.join(outDir, 'robots.txt'), ROBOTS(`${SITE_URL}/sitemap.xml`));
  fs.writeFileSync(path.join(outDir, 'styles.css'), STYLES);
  fs.copyFileSync(path.join(ROOT, 'owl.js'), path.join(outDir, 'owl.js'));
  for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(outDir, 'assets', f));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), ''); // GitHub Pages: don't run Jekyll over this
  return pageUrls.length;
}

async function build() {
  const { shop, listings } = await fetchListings();
  console.log(`Fetched ${listings.length} active listings from shop "${shop.shop_name}".`);
  const n = writeSite(listings, shop);
  console.log(`Built ${listings.length} product pages + index + 404 + sitemap.xml (${n} URLs) -> dist/`);
}

if (require.main === module) build().catch((e) => { console.error('Build failed:', e.message); process.exit(1); });
module.exports = { build, fetchListings, fetchPublic, apiKeyHeader, writeSite, productPage, indexPage, sitemap };
