# Audit Check Catalogue

Every check is a pure function `(ctx) => Observation[]`. A check never writes a `Finding`; the
classifier in `src/server/findings/classify.ts` does that, and only when the rule's evidence
predicate holds.

## Outcome vocabulary

| `outcome` | Meaning | Produces a finding? |
|---|---|---|
| `pass` | Check ran, condition healthy. | No |
| `issue` | Check ran, condition matched a defined problem pattern. | Yes, via classifier |
| `info` | Check ran, result is contextual only. | Only if a rule maps it |
| `unverifiable` | Check could not run (blocked, timeout, robots-disallowed, DNS failure). | **Never** |
| `skipped` | Not selected, or prerequisite check failed. | Never |

`unverifiable` renders in the UI as **"Unable to verify automatically"** with a *Review manually*
action, exactly as required. No finding, no score contribution, and it can never reach a report.

## Fetch policy (`src/audit/fetcher.ts`)

* `robots.txt` fetched once per host and honoured for the declared user-agent; a `Disallow` yields
  `unverifiable`, never a bypass.
* One concurrent request per host, minimum interval between requests, global timeout per request.
* Redirects followed to a capped depth with the full chain captured as evidence.
* `GET`/`HEAD` only. No form submission, no parameter fuzzing, no path brute-forcing beyond the
  small fixed list of conventional public paths below.
* Identifying User-Agent with a contact URL.
* **Out of scope by policy:** port scanning, version fingerprinting for exploit purposes,
  authentication probing, any request intended to trigger a fault.

## Groups and checks

### `availability` — Availability and hosting

| Code | Observes | Issue condition |
|---|---|---|
| `dns.resolves` | Hostname resolution | No A/AAAA/CNAME record |
| `http.status` | Final status code of the root URL | 4xx or 5xx |
| `http.reachable` | Connection outcome | Connection refused / reset / timeout |
| `https.available` | HTTPS root reachable | HTTPS fails while HTTP succeeds |
| `https.redirect` | HTTP to HTTPS upgrade | HTTP 200 with no upgrade to HTTPS |
| `tls.certificate` | Certificate subject, issuer, validity window | Expired, not-yet-valid, or hostname mismatch |
| `redirect.chain` | Ordered hop list | More than 3 hops, or a loop |
| `redirect.loop` | Cycle detection | Cycle present |
| `page.holding` | Body text against holding-page phrases | "coming soon", "under construction", "site launching" as dominant content |
| `page.parked` | Registrar/parking markers | Parking-page signature |
| `dir.index` | `Index of /` markers on the root or linked paths | Directory listing served |

### `cms` — CMS hygiene

| Code | Observes | Issue condition |
|---|---|---|
| `wp.default_pages` | `/sample-page/`, `/hello-world/`, `/?p=1` | HTTP 200 with default copy present |
| `wp.hello_world` | Post body | "Welcome to WordPress. This is your first post" |
| `wp.readme` | `/readme.html` | Publicly served CMS readme |
| `content.lorem` | Body text | Lorem ipsum passage present |
| `content.demo` | Body text | Theme/demo placeholder markers ("Your Business Tagline", "Demo Content") |
| `content.placeholder_contact` | Contact strings | `example.com` email, `555-…`/`123-456-7890` phone, `Your Address Here` |
| `content.wrong_location` | Address vs configured country | Address country conflicts with the organization record |
| `staging.public` | `staging.`/`dev.`/`test.` subdomain of the same registrable domain | Reachable and indexable |
| `path.residue` | Small fixed list of conventional public paths | Served and publicly listable |

`path.residue` uses a short, fixed, conventional list only. It is not a discovery scanner.

### `seo` — Technical SEO

`title.missing`, `title.duplicate`, `title.length`, `meta.description_missing`,
`meta.description_length`, `heading.h1_missing`, `heading.h1_multiple`, `heading.order`,
`canonical.missing`, `canonical.conflicting`, `robots.txt_missing`, `robots.blocks_all`,
`sitemap.missing`, `sitemap.unreachable`, `indexability.noindex`, `link.internal_broken`,
`schema.missing`, `schema.invalid`, `lang.missing`.

### `content` — Content and information

`page.thin`, `services.missing`, `about.missing`, `date.stale`, `copyright.stale`,
`contact.page_missing`.

### `performance` — Performance and images

`page.weight`, `image.oversized`, `image.format_legacy`, `image.lazy_missing`,
`image.alt_missing`, `render.blocking_assets`, `cwv.unavailable`.

Core Web Vitals require an authorized PageSpeed Insights key. Without it, `cwv.unavailable`
records `outcome: 'unverifiable'`. **No performance number is ever estimated or inferred.**

### `mobile` — Mobile and accessibility

`viewport.missing`, `viewport.fixed_width`, `tap.target_signals`, `a11y.img_alt`,
`a11y.form_labels`, `a11y.link_text`, `a11y.lang`, `a11y.contrast_declared`, `a11y.skip_link`.

These are static-markup accessibility signals only, not a WCAG conformance audit. The report
labels them as such.

### `conversion` — Conversion

`contact.phone_visible`, `contact.email_visible`, `contact.address_visible`, `form.present`,
`form.action_valid`, `whatsapp.link`, `tel.link`, `booking.present`, `quote.present`,
`analytics.tag_present`, `analytics.events_declared`, `pixel.present`.

### `trust` — Trust

`privacy.page`, `terms.page`, `team.page`, `contact.consistency`, `social.links_present`,
`social.links_broken`.

### `local` — Local discovery signals on the site

`nap.present`, `nap.consistent`, `map.embed`, `hours.published`, `local.landing_pages`,
`schema.localbusiness`.

## Social media review (`social` group)

Platform APIs are used **only** where an authorized token exists in Integrations. Facebook,
Instagram, LinkedIn, X, TikTok and YouTube are all API-gated in this build. With no token
configured, the group produces a **structured manual-review checklist** persisted as
`Observation` rows with `outcome: 'unverifiable'` and `source: 'manual_pending'`, which an auditor
completes in the UI. Completing an item writes `source: 'manual_verified'` with the reviewer and
timestamp.

Checklist items per profile: profile exists · business name correct · username consistent · logo
present · cover present · description present · website link present · website link correct ·
phone present · email present · location present · CTA button present · posting frequency ·
last post date · content consistency · brand consistency · video usage · response options ·
profile completeness · broken links · conversion path present.

Engagement metrics are recorded **only** from an authorized API. They are never scraped and never
estimated.

## Google Business and local (`gbp` group)

With a Google Places/Business API key: name, category, address, phone, website, hours, map
location, rating, review count, review responses, photo count, description, service areas.
Without a key: the same fields become a manual-verification form; each field stores the reviewer,
timestamp and the source URL used. Nothing is auto-filled.

## Severity and confidence defaults

Assigned by rule, then editable by an auditor with the change recorded in `Activity`.

| Pattern | Severity | Confidence |
|---|---|---|
| Site unreachable / DNS failure | critical | high |
| Directory index served | critical | high |
| Holding or parked page at root | critical | high |
| TLS expired or hostname mismatch | critical | high |
| WordPress default page served | high | high |
| Public staging site indexable | high | high |
| Lorem ipsum / demo content | high | high |
| Placeholder contact details | high | high |
| No HTTPS upgrade | high | high |
| Missing title / description | medium | high |
| Broken internal links | medium | high |
| No sitemap / robots | medium | high |
| No analytics tag detected | medium | medium |
| No conversion path (form/tel/WhatsApp) | high | medium |
| Missing alt text | low | high |
| Legacy image formats / oversized images | medium | medium |
| Accessibility markup signals | medium | low |
| Stale copyright year | low | high |
| Social profile incomplete (manual) | medium | high after verification |

Confidence is `medium` or `low` wherever the signal is inferential (heuristic text matching,
markup-only accessibility, third-party tag detection). Low-confidence findings are excluded from
client-facing output by default and must be explicitly promoted by an auditor.
