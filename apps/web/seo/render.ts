/**
 * Renders the guide pages and crawler files to strings (decisions.md E-108..E-112). Pure functions,
 * so seo.test.ts can check them without a build. Pages are plain HTML + one external stylesheet:
 * no inline scripts or styles (the site CSP allows neither), no third-party requests.
 */
import { APP, ORIGIN, PAGES, REPO, pathOf, urlOf, type Page } from './content.ts';
import { GUIDES } from './routes.ts';

/** Date the guide copy last changed (sitemap lastmod). Bump when content.ts changes materially. */
export const LASTMOD = '2026-10-26';
export const OG_IMAGE = `${GUIDES}/assets/og-image.png`;
const OG_ALT = 'DaSignature: sign PDFs privately. Your files never leave your device.';

export interface Assets {
  css: string;
  /** Analytics loader, only when the owner configured a key (plugin.ts). */
  analytics?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a <script type="application/ld+json"> block: no "</script>" can appear. */
const ldJson = (v: unknown) =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const bySlug = new Map(PAGES.map((p) => [p.slug, p]));
export function page(slug: string): Page {
  const p = bySlug.get(slug);
  if (!p) throw new Error(`unknown guide: ${slug}`);
  return p;
}

const LEGAL =
  'DaSignature makes simple electronic signatures. It is not a qualified or advanced electronic signature and is not legal advice.';

export function structuredData(p: Page): object {
  const url = urlOf(p.slug);
  const graph: object[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'DaSignature guides', item: urlOf('') },
        ...(p.slug ? [{ '@type': 'ListItem', position: 2, name: p.h1, item: url }] : []),
      ],
    },
    {
      '@type': 'FAQPage',
      url,
      mainEntity: p.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];
  if (p.howTo)
    graph.push({
      '@type': 'HowTo',
      name: p.howTo.name,
      url,
      tool: { '@type': 'HowToTool', name: 'DaSignature' },
      step: p.howTo.steps.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: s.name,
        text: s.text,
      })),
    });
  if (!p.slug)
    graph.unshift({
      '@type': 'SoftwareApplication',
      name: 'DaSignature',
      url: APP,
      description: p.description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web browser, Windows, Linux, Android',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      isAccessibleForFree: true,
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      image: ORIGIN + OG_IMAGE,
      sameAs: [REPO],
      featureList: [
        'Sign PDFs on your device, nothing uploaded',
        'Draw, type, upload or scan a signature',
        'Initials, date, text, checkbox and full-name fields',
        'Optional audit page with SHA-256 of the original',
        'Works offline; encrypted local storage; optional passcode lock',
      ],
    });
  return { '@context': 'https://schema.org', '@graph': graph };
}

const appLink = (where: string, label: string, cls = 'btn') =>
  `<a class="${cls}" href="/" data-app-link="${where}">${esc(label)}</a>`;

export function renderPage(p: Page, assets: Assets): string {
  const url = urlOf(p.slug);
  const title = esc(p.title);
  const desc = esc(p.description);
  const howTo = p.howTo
    ? `<section aria-labelledby="how"><h2 id="how">${esc(p.howTo.name)}</h2><ol class="steps">${p.howTo.steps
        .map((s) => `<li><h3>${esc(s.name)}</h3><p>${esc(s.text)}</p></li>`)
        .join('')}</ol></section>`
    : '';
  const sections = p.sections
    .map(
      (s) =>
        `<section><h2>${esc(s.h)}</h2>${(s.p ?? []).map((t) => `<p>${esc(t)}</p>`).join('')}${
          s.list ? `<ul>${s.list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
        }</section>`,
    )
    .join('');
  const faqs = `<section aria-labelledby="faq"><h2 id="faq">Frequently asked questions</h2>${p.faqs
    .map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`)
    .join('')}</section>`;
  const related = `<nav aria-labelledby="more" class="related"><h2 id="more">${
    p.slug ? 'More guides' : 'Guides'
  }</h2><ul>${p.related
    .map((s) => {
      const r = page(s);
      return `<li><a href="${pathOf(s)}">${esc(r.h1)}</a><span>${esc(r.description)}</span></li>`;
    })
    .join('')}</ul></nav>`;
  const crumbs = p.slug
    ? `<nav aria-label="Breadcrumb" class="crumbs"><a href="${GUIDES}">Guides</a> <span aria-hidden="true">›</span> <span aria-current="page">${esc(p.h1)}</span></nav>`
    : '';
  const analyticsNote = assets.analytics
    ? '<p>These guide pages count visits with cookieless analytics (PostHog, no cookies or local storage, Do Not Track and Global Privacy Control respected). The DaSignature app itself sends nothing.</p>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#141A3C">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">
<link rel="stylesheet" href="${assets.css}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DaSignature">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}${OG_IMAGE}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${ORIGIN}${OG_IMAGE}">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
<script type="application/ld+json">${ldJson(structuredData(p))}</script>
${assets.analytics ? `<script src="${assets.analytics}" defer></script>\n` : ''}</head>
<body>
<header class="top"><a class="brand" href="${GUIDES}"><img src="/favicon.svg" alt="" width="28" height="28">DaSignature</a>${appLink('header', 'Open the app', 'btn small')}</header>
<main>
${crumbs}<h1>${esc(p.h1)}</h1>
<p class="lead">${esc(p.lead)}</p>
<p class="cta">${appLink('hero', 'Open DaSignature, free', 'btn primary')}<span>No account. Nothing uploaded. Works offline.</span></p>
${howTo}${sections}${faqs}
<p class="cta">${appLink('footer-cta', 'Sign a PDF now', 'btn primary')}</p>
${related}
</main>
<footer>
<p>${esc(LEGAL)} <a href="${pathOf('are-electronic-signatures-legal')}">What this means</a></p>
${analyticsNote}<p><a href="/">Open the app</a> · <a href="${GUIDES}">All guides</a> · <a href="${REPO}">Source code on GitHub</a> (Apache-2.0)</p>
</footer>
</body>
</html>
`;
}

export function sitemap(): string {
  const urls = [APP, ...PAGES.map((p) => urlOf(p.slug))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${LASTMOD}</lastmod></url>`).join('\n')}
</urlset>
`;
}

export function robots(): string {
  return `# DaSignature: every page may be crawled. /ingest/ is an analytics relay, not content.
User-agent: *
Allow: /
Disallow: /ingest/

Sitemap: ${ORIGIN}/sitemap.xml
`;
}

const SUMMARY =
  'DaSignature is a free, open-source (Apache-2.0) app for signing and filling in PDFs on your own device. Files are never uploaded: there are no accounts, no servers and no analytics in the app, and it makes no network requests at runtime. It makes simple electronic signatures (not advanced or qualified ones) and is not legal advice.';

const FACTS = `## Features

- Open any PDF, including password-protected ones (file picker, drag and drop, share sheet, "Open with" on desktop).
- Create signatures and initials by drawing, typing (handwriting fonts), uploading an image (background removal) or scanning with the camera.
- Place signatures, initials, dates, text, checkboxes and the signer's full name; move, resize, rotate, duplicate, set opacity; undo/redo and autosave.
- Fill forms by placing text, date and checkbox fields on top of the page (works on scanned forms too). Existing form fields are shown and can be flattened on export; typing directly into built-in PDF form fields is not supported.
- Export a new signed copy (the original is never modified) with an optional audit page (signer name, time, SHA-256 of the original; never location) and an embedded audit trail. "Check a signed PDF" verifies whether a file is an exact copy exported on that device.
- Encrypted local storage (AES-256-GCM per value; SQLCipher on desktop and Android), optional 6-digit passcode lock with auto-lock, encrypted .dasig backups.
- English and Arabic (right-to-left), light and dark themes, keyboard and screen-reader accessible.

Not included: sending documents to other people for signature, signer email routing, identity verification, certificate-based (PAdES/AES/QES) digital signatures, page merging or reordering, annotations.

## Platforms

- Web app / PWA at ${APP}: current Chrome, Edge, Firefox and Safari (16.4+) on desktop and mobile; installable; works offline after the first visit.
- Windows and Linux (deb, rpm, AppImage) desktop apps and an Android APK, built from the same code; downloads on GitHub releases (${REPO}/releases). Not in Google Play or the App Store.
- macOS and iOS: build from source for now; on Mac, iPhone and iPad use the web app.

## Privacy

- The app makes zero network requests while in use; its Content-Security-Policy allows only same-origin resources. The Android app has no internet permission.
- Documents, signatures and settings stay on the device, encrypted. Nothing is uploaded.
- The public guide pages under ${ORIGIN}${GUIDES} may count visits with cookieless analytics when the site owner enables it; the app itself never does.

## Links

- App: ${APP}
- Source code: ${REPO}
`;

export function llms(): string {
  return `# DaSignature

> ${SUMMARY}

${FACTS}
## Guides

${PAGES.map((p) => `- [${p.h1}](${urlOf(p.slug)}): ${p.description}`).join('\n')}

## Optional

- [Full text of every guide](${ORIGIN}/llms-full.txt)
`;
}

export function llmsFull(): string {
  const body = PAGES.map((p) => {
    const parts = [`## ${p.h1}`, '', `URL: ${urlOf(p.slug)}`, '', p.lead, ''];
    if (p.howTo) {
      parts.push(`### ${p.howTo.name}`, '');
      p.howTo.steps.forEach((s, i) => parts.push(`${String(i + 1)}. ${s.name}: ${s.text}`));
      parts.push('');
    }
    for (const s of p.sections) {
      parts.push(`### ${s.h}`, '');
      for (const t of s.p ?? []) parts.push(t, '');
      if (s.list) parts.push(...s.list.map((t) => `- ${t}`), '');
    }
    parts.push('### Frequently asked questions', '');
    for (const f of p.faqs) parts.push(`Q: ${f.q}`, `A: ${f.a}`, '');
    return parts.join('\n');
  }).join('\n');
  return `# DaSignature: full guide text

> ${SUMMARY}

${FACTS}
${body}`;
}
