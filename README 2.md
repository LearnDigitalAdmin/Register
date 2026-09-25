# MyRegister — SEO & Landing Page Update

Scope check first: only these 4 files were modified, nothing else in the app was touched —
`index.html`, `public/robots.txt`, `public/sitemap.xml`, `src/pages/Landing.tsx`.
Verified with `tsc -b` (typecheck) and `vite build` (full production build) — both pass clean.
Everything else new is purely additive (new files only).

## How to apply

1. **Modified files** (`modified/`) — replace the same paths in your repo 1:1:
   - `index.html`
   - `public/robots.txt`
   - `public/sitemap.xml`
   - `src/pages/Landing.tsx`

   Or review `CHANGES.diff` and apply with `git apply CHANGES.diff` from your repo root.

2. **New files** (`new/`) — copy into the matching paths. These fix previously-broken
   image references in your own `index.html`/`browserconfig.xml` (they pointed to files
   that didn't exist) — nothing else changes because of them:
   - `public/favicon.ico`
   - `public/og-image.png`
   - `public/llms.txt`
   - `public/screenshots/desktop-dashboard.png`
   - `public/icons/favicon-16x16.png`, `favicon-32x32.png`, `icon-72x72.png`,
     `icon-144x144.png`, `icon-152x152.png`, `apple-touch-icon.png`,
     `apple-touch-icon-180x180.png`, `icon-384x384.png`, `icon-512x512.png`

3. Deploy as normal (`npm run build` → `firebase deploy`). No config, routing, Firebase
   rules, or Cloud Functions were touched.

## What changed and why

### 1. Crawlability (`robots.txt`, `sitemap.xml`, new `llms.txt`)
- **`robots.txt`**: kept your existing rules, added explicit `Allow` blocks for AI
  crawlers/answer engines (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot,
  Bingbot, etc.) so MyRegister can be found and *accurately described* by ChatGPT,
  Claude, Perplexity, and Google's AI Overviews — not just classic search. `/app` stays
  disallowed everywhere (it's auth-gated, no public SEO value).
- **`sitemap.xml`**: refreshed `lastmod` dates, added hreflang + image annotation now
  that `og-image.png` actually exists.
- **`llms.txt`** *(new)*: an emerging convention — a plain-language, machine-readable
  summary of the site for LLMs. This is where I did the heavy lifting on brand
  disambiguation (see below), so an AI assistant asked "what is MyRegister" or "who is
  Samuhia" answers correctly instead of guessing.

### 2. Fixed broken assets (silent bug, found while auditing)
Your `index.html` (and `browserconfig.xml`) already referenced a favicon, an OG image, a
screenshot, and ~9 icon sizes — **none of which existed in the repo.** That's broken
social-media link previews (Facebook/WhatsApp/Slack/X all show nothing), a missing
browser-tab favicon, and Search Console flags for missing icons. I regenerated all of
them from your actual `icon.svg` logo (nothing invented — same book/pencil mark, just
rendered at the sizes already being requested), plus a new branded OG card and a
dashboard-mockup "screenshot" for the SoftwareApplication schema. Zero code changes were
needed for most of these — the `<link>` tags were already correct, they just had nothing
to point to.

### 3. Brand hierarchy, made explicit and consistent
Based on what you told me and what the codebase itself confirms (Paystack processes the
"M-Pesa" payments, `cogvana.co.ke` is the real contact domain, `ContactUs.tsx` already
says "Part of Cogvana"), I standardized on:

> **Cogvana** — the technology company. **Samuhia** — Cogvana's client-facing brand
> (SMS sender ID, WhatsApp contact name, Paystack/M-Pesa checkout name). **MyRegister**
> — the product.

Previously the site called it "Samuhia Businesses, also known as Cogvana," which reads
as two names for one thing rather than a company + its consumer brand. I corrected this
in:
- `index.html`'s Organization/SoftwareApplication/WebSite JSON-LD (`Cogvana` is now the
  entity, `Samuhia` is a nested `Brand`)
- Two new FAQ entries, in both the JSON-LD **and** visibly on the page, that directly
  answer "**Who is Samuhia? Why did I get an SMS from Samuhia?**" — this is a real
  search people will type after receiving your SMS, and it's now capturable.
- The hero copy, a feature card, the pricing section, and the footer — all now name
  Samuhia specifically as the SMS/payment identity, rather than leaving it vague.

### 4. Landing page — hero rewrite + new sections
- **Nav**: added a small "by Samuhia" tag under the logo, plus new anchors for the two
  new sections below.
- **Hero**: tightened the paragraph to say plainly what happens and who it's from — "the
  instant a child is absent or late, their parent gets an SMS — sent from **Samuhia**, a
  name Kenyan parents already trust." Direct, concrete, no vague marketing language.
- **New "How it works" section**: 3 numbered steps (Mark → Samuhia notifies → Reports
  write themselves) right after the hero. This is the single biggest lever for "richly
  intuitive" — it's the kind of structured, scannable content that both a first-time
  visitor and an AI crawler can parse in one pass.
- **New visible FAQ section**: mirrors the JSON-LD FAQPage content on-page (Google's own
  guidance is that structured data should match visible content — this also gives you a
  second, differently-worded shot at the same search intent).
- **Pricing section**: added one line clarifying that the M-Pesa/Paystack prompt will
  show "Samuhia," not a third party — pre-empts a real support question.
- **Footer**: tagline and copyright line now state the Cogvana/Samuhia relationship
  plainly, and the year was bumped to 2026.
- **Semantic HTML**: wrapped the nav in `<header>` and the main content in `<main>` —
  free, safe improvement for accessibility and crawlers, no visual or behavioral change.

Nothing about routing, auth, Firebase, Cloud Functions, pricing logic, or the dashboard
app was touched.
