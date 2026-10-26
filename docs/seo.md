# Search, guide pages and guide analytics

The app lives at `/` and keeps its hash routes. Everything written for search engines, link
previews and AI crawlers is separate and static (decisions.md E-108 to E-112).

## What is published

| URL                                       | What                                                |
| ----------------------------------------- | --------------------------------------------------- |
| `/guides`                                 | Landing page (SoftwareApplication JSON-LD)          |
| `/guides/sign-pdf-online`                 | Sign a PDF online without uploading it              |
| `/guides/free-e-signature`                | Make a free electronic signature                    |
| `/guides/fill-out-pdf-form`               | Fill out a PDF form                                 |
| `/guides/add-signature-to-pdf`            | Add a signature to a PDF                            |
| `/guides/sign-pdf-on-iphone`              | Sign a PDF on iPhone or iPad                        |
| `/guides/sign-pdf-on-android`             | Sign a PDF on Android                               |
| `/guides/sign-pdf-windows`                | Sign a PDF on Windows                               |
| `/guides/sign-pdf-on-mac`                 | Sign a PDF on a Mac                                 |
| `/guides/initials-and-date-on-pdf`        | Add initials and a date                             |
| `/guides/private-offline-pdf-signer`      | A private, offline PDF signer                       |
| `/guides/docusign-alternative-free`       | A free alternative for signing PDFs yourself        |
| `/guides/are-electronic-signatures-legal` | Simple electronic signatures, in plain language     |
| `/robots.txt`, `/sitemap.xml`             | Crawler files (13 URLs in the sitemap)              |
| `/llms.txt`, `/llms-full.txt`             | Summary and full text for AI crawlers (llmstxt.org) |
| `/guides/assets/og-image.png`             | 1200x630 share image used by every page and the app |

Pages are generated at build time by `apps/web/seo/plugin.ts` from `apps/web/seo/content.ts`.
To change a page, edit `content.ts` and rebuild; `src/seo.test.ts` checks titles (70 characters or
fewer), descriptions (160 or fewer), canonicals, JSON-LD, links, the legal wording and the crawler
files. Keep steps and FAQ answers matched to the real UI labels, and keep legal wording to simple
electronic signatures (SPEC Sec 9): never claim advanced (AES) or qualified (QES) signatures, identity
checks or features the app doesn't have.

To regenerate the share image (needs Pillow): `python3 apps/web/seo/make-og-image.py`.

## Routing (render.yaml)

- Files are built as `dist/guides/index.html` and `dist/guides/<slug>/index.html`. Render serves an
  existing file before any rule, but it doesn't document whether `/guides/<slug>` or
  `/guides/<slug>/` serve the folder's `index.html`. So render.yaml has explicit rewrites for
  `/guides`, `/guides/`, `/guides/:slug` and `/guides/:slug/`, above the SPA rule. Both spellings
  return 200 with the same canonical (no trailing slash), so search engines see one URL per page.
  An unknown guide (`/guides/nope`) is a 404, not the app shell.
- Headers: `/guides` and `/guides/*` are `no-cache`; the crawler files are
  `public, max-age=3600`. The CSP and every other header are unchanged and apply to the guides too
  (they use no inline script or style). `src/seo.test.ts` checks that no guide rule can match an
  app path.
- The service worker ignores `/guides`, `/ingest` and the crawler files, and doesn't precache
  them, so it never answers a guide URL with the app. Guides need a connection; the app still
  works offline.

**After each deploy that changes routing, check the live site** (the local emulation can't prove
Render's behaviour):

```sh
for u in /guides /guides/ /guides/sign-pdf-online /guides/sign-pdf-online/ /robots.txt /sitemap.xml /llms.txt; do
  curl -s -o /dev/null -w "%{http_code} %{content_type} $u\n" "https://dasignature.onrender.com$u"
done
curl -s https://dasignature.onrender.com/guides/sign-pdf-online | grep -o '<link rel="canonical"[^>]*>'
curl -s -o /dev/null -w "%{http_code}\n" https://dasignature.onrender.com/guides/nope   # 404
```

Expect 200, `text/html` for guides, `text/plain` for `.txt` and an XML type for the sitemap.

## Search engines (owner steps)

### Google Search Console

1. Go to <https://search.google.com/search-console>, Add property, choose **URL prefix** and enter
   `https://dasignature.onrender.com/` (a Domain property needs DNS access, which an onrender.com
   subdomain doesn't give you).
2. Verify with the **HTML tag** method: copy the `<meta name="google-site-verification" ...>` tag
   into the `<head>` of `apps/web/index.html`, commit, push, wait for the deploy, then press Verify.
   (The HTML file method also works: put the file in `apps/web/public/`.) Keep the tag or file
   afterwards; removing it un-verifies the site.
3. Sitemaps, enter `sitemap.xml`, Submit. Then use URL Inspection on `/guides` and Request indexing.

### Bing Webmaster Tools

1. Go to <https://www.bing.com/webmasters>, sign in and either **Import from Google Search Console**
   (quickest, once Google is verified) or add the site and verify with the meta tag
   (`msvalidate.01`) the same way as above.
2. Sitemaps, submit `https://dasignature.onrender.com/sitemap.xml`.

Bing's index also feeds DuckDuckGo, Yahoo and Ecosia, and several AI assistants.

### IndexNow (optional)

IndexNow lets you ping Bing, Yandex, Seznam, Naver and others the moment a URL changes (Google
doesn't use it). It needs a **key file**: a text file named `<key>.txt` at the site root containing
the key, so the engines can confirm you own the site. **No key file is included**; to use IndexNow,
generate a key (for example in Bing Webmaster Tools, or any 8 to 128 hex characters), add
`apps/web/public/<key>.txt` containing only the key, deploy, then submit changed URLs:

```sh
curl "https://api.indexnow.org/indexnow?url=https://dasignature.onrender.com/guides/sign-pdf-online&key=<key>"
```

The key isn't a secret (it is published by design), but it is tied to this host.

### Brave Search

Brave builds its own index, mostly from pages it already knows about. Its form at
<https://search.brave.com/submit-url> only asks Brave to **re-read URLs it already knows**; it
doesn't add new sites. Being in Google and Bing and linked from elsewhere (the GitHub README,
release pages) is what gets new pages found.

### Why a custom domain helps

- An `onrender.com` subdomain is shared hosting: you can't make a Domain property in Search
  Console, and the brand isn't in the URL people see in results.
- Links, rankings and verification belong to the domain; if you ever move host, a domain you own
  keeps them (with redirects), while an `onrender.com` address doesn't.
- It looks more trustworthy in results and link previews.

If you add one (Render, Settings, Custom Domains), change `ORIGIN` in `apps/web/seo/content.ts`,
the `dasignature.onrender.com` mentions in its step text, and the canonical, `og:url` and
`og:image` URLs in `apps/web/index.html`; rebuild, then add the new domain in Search Console and
Bing and submit its sitemap. The onrender.com address keeps working; the new canonicals tell search engines which address to
show.

## Guide-page analytics (optional, owner decision Oct 26)

The app has no analytics and makes no network calls. Only the guide pages under `/guides` may
count visits, and only when you set a key at build time. Without a key the build contains no
analytics code at all. Details and the privacy settings are in decisions.md E-112; in short:
PostHog (self-hosted copy of posthog-js, pinned), no cookies or browser storage (memory only),
no autocapture, no session recording, page views plus a `guide_open_app` event when someone clicks
a link into the app, and nothing at all for visitors with Do Not Track or Global Privacy Control.
Events go to `/ingest/*` on this site, which Render forwards to PostHog, so the CSP is unchanged.

### Owner steps

1. In PostHog (<https://us.posthog.com>, US cloud), create a project (or use an existing one).
2. In the project's Settings, General, copy the **Project API key** (starts with `phc_`; it is
   meant to be public, but don't commit it) and note the region host. For US cloud it is
   `https://us.i.posthog.com`, which is the default.
3. In Render, open the dasignature static site, Environment, and add **`POSTHOG_KEY`** (or
   **`POSTHOG_PROJECT_API_KEY`**; if both are set, `POSTHOG_KEY` wins) with the key. Only for a
   different region or a self-hosted PostHog also set **`POSTHOG_HOST`** (for example
   `https://eu.i.posthog.com`) **and** change the `/ingest/*` destination in `render.yaml` to the
   same host; the build fails with a clear message if they differ.
4. Save, then Manual Deploy, Clear build cache and deploy (environment changes need a new build).
5. Verify:
   - `curl -s https://dasignature.onrender.com/guides | grep -o 'guides/assets/analytics-[^"]*'`
     prints the loader; `curl -s https://dasignature.onrender.com/ | grep -ci posthog` prints `0`.
   - Open `/guides` in a normal browser window (with Do Not Track off), click "Open the app", and
     check PostHog, Activity: a `$pageview` and a `guide_open_app` event appear within a minute or
     two. Visits to the app itself never appear.
6. To turn it off, delete the variable(s) and redeploy.

The build check (`apps/web/seo/isolation.ts`) fails the build if "posthog" appears in any file
outside `dist/guides/`, or anywhere when no key is set. Never commit a real key; tests use a dummy
key.
