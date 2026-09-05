import { obs, type AuditContext, type ObservationDraft } from '../types';
import { parsePage, type ParsedPage } from '../page';
import { integrations, env } from '@/lib/env';

/**
 * Content, performance, mobile/accessibility, conversion, trust and local
 * signal checks. Grouped in one module because they all read the same parsed
 * home page and share helpers.
 */

function requireParsed(
  ctx: AuditContext,
  group: 'content' | 'performance' | 'mobile' | 'conversion' | 'trust' | 'local',
): { parsed: ParsedPage; url: string } | ObservationDraft[] {
  if (ctx.root.error) {
    return [obs.skipped(group, `${group}.group`, 'The home page could not be retrieved.')];
  }
  const parsed = parsePage(ctx.root);
  if (!parsed) {
    return [
      obs.unverifiable(
        group,
        `${group}.group`,
        'The home page did not return inspectable HTML.',
        { url: ctx.root.finalUrl },
      ),
    ];
  }
  return { parsed, url: ctx.root.finalUrl };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const SERVICE_WORDS = /\b(services?|solutions?|what we do|products?|our work|portfolio|packages?)\b/i;
const ABOUT_WORDS = /\b(about us|about|who we are|our story|our team)\b/i;

export async function runContent(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'content');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'content' as const;

  const words = parsed.text.split(/\s+/).filter(Boolean).length;
  if (words < 120) {
    out.push(
      obs.issue(
        G,
        'page.thin',
        `The home page contains ${words} words of visible text, which gives visitors and search engines little to work with.`,
        { url, rawValue: { words } },
      ),
    );
  } else {
    out.push(obs.pass(G, 'page.thin', `The home page contains ${words} words.`, { url, rawValue: { words } }));
  }

  const linkText = parsed.links.map((l) => l.text).join(' ');
  const haystack = `${linkText} ${parsed.text.slice(0, 4000)}`;

  if (!SERVICE_WORDS.test(haystack)) {
    out.push(
      obs.issue(
        G,
        'services.missing',
        'No services, products or "what we do" section was found on the home page or in its navigation.',
        { url },
      ),
    );
  }
  if (!ABOUT_WORDS.test(haystack)) {
    out.push(
      obs.issue(G, 'about.missing', 'No "about" or company-background section was found.', { url }),
    );
  }

  // Stale copyright year. Only reported when a year is actually published.
  const years = [...parsed.text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)]
    .map((m) => Number(m[1]))
    .filter((y) => y > 1990 && y < 2100);
  const currentYear = ctx.now.getUTCFullYear();
  if (years.length > 0) {
    const newest = Math.max(...years);
    if (newest < currentYear - 1) {
      out.push(
        obs.issue(
          G,
          'copyright.stale',
          `The published copyright year is ${newest}, which suggests the site has not been updated recently.`,
          { url, rawValue: { published: newest, currentYear } },
        ),
      );
    } else {
      out.push(
        obs.pass(G, 'copyright.stale', `The copyright year is ${newest}.`, {
          url,
          rawValue: { published: newest },
        }),
      );
    }
  }

  const hasContactPage = parsed.links.some((l) => /contact|get in touch|enquir/i.test(l.text + l.href));
  out.push(
    hasContactPage
      ? obs.pass(G, 'contact.page_missing', 'A contact page is linked from the home page.', { url })
      : obs.issue(G, 'contact.page_missing', 'No contact page is linked from the home page.', { url }),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Performance and images
// ---------------------------------------------------------------------------

export async function runPerformance(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'performance');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'performance' as const;

  const htmlKb = Math.round(ctx.root.bytes / 1024);
  if (htmlKb > 300) {
    out.push(
      obs.issue(
        G,
        'page.weight',
        `The home page HTML document alone is ${htmlKb} KB before images, scripts or styles.`,
        { url, rawValue: { htmlKb, elapsedMs: ctx.root.elapsedMs } },
      ),
    );
  } else {
    out.push(
      obs.pass(G, 'page.weight', `The home page HTML document is ${htmlKb} KB.`, {
        url,
        rawValue: { htmlKb, elapsedMs: ctx.root.elapsedMs },
      }),
    );
  }

  // Image sizes are measured, not estimated - we request headers for a sample.
  const imageUrls = [...new Set(parsed.images.map((i) => i.absolute).filter((u): u is string => !!u))];
  const sample = imageUrls.slice(0, 6);
  const measured: { url: string; kb: number; type: string | null }[] = [];
  for (const img of sample) {
    const res = await ctx.fetch(img, { method: 'HEAD' });
    if (!res) break;
    if (res.error || res.status >= 400) continue;
    const kb = Math.round((res.bytes || 0) / 1024);
    if (kb > 0) measured.push({ url: img, kb, type: res.contentType });
  }

  const oversized = measured.filter((m) => m.kb > 300);
  if (measured.length === 0) {
    out.push(
      obs.unverifiable(
        G,
        'image.oversized',
        imageUrls.length === 0
          ? 'No images were found on the home page.'
          : 'Image sizes were not disclosed by the server.',
        { url },
      ),
    );
  } else if (oversized.length > 0) {
    out.push(
      obs.issue(
        G,
        'image.oversized',
        `${oversized.length} of ${measured.length} sampled images exceed 300 KB (largest ${Math.max(...oversized.map((o) => o.kb))} KB).`,
        {
          url,
          rawValue: { measured, oversized },
          evidence: [
            {
              kind: 'http_response',
              sourceUrl: url,
              content: oversized.map((o) => `${o.kb} KB  ${o.type ?? ''}  ${o.url}`).join('\n'),
            },
          ],
        },
      ),
    );
  } else {
    out.push(
      obs.pass(
        G,
        'image.oversized',
        `All ${measured.length} sampled images are under 300 KB.`,
        { url, rawValue: { measured } },
      ),
    );
  }

  const legacy = measured.filter((m) => /image\/(jpeg|png|gif|bmp)/i.test(m.type ?? ''));
  if (measured.length > 0) {
    out.push(
      legacy.length === measured.length && measured.length >= 3
        ? obs.issue(
            G,
            'image.format_legacy',
            `All ${measured.length} sampled images use legacy formats. Modern formats such as WebP or AVIF typically reduce image weight substantially.`,
            { url, rawValue: { formats: measured.map((m) => m.type) } },
          )
        : obs.pass(G, 'image.format_legacy', 'At least one modern image format is in use.', {
            url,
            rawValue: { formats: measured.map((m) => m.type) },
          }),
    );
  }

  const withoutLazy = parsed.images.filter((i) => !i.loading);
  if (parsed.images.length >= 6 && withoutLazy.length === parsed.images.length) {
    out.push(
      obs.issue(
        G,
        'image.lazy_missing',
        `None of the ${parsed.images.length} images on the home page declare lazy loading.`,
        { url, rawValue: { images: parsed.images.length } },
      ),
    );
  }

  const blocking = parsed.$('head script[src]:not([async]):not([defer])').length;
  if (blocking > 2) {
    out.push(
      obs.issue(
        G,
        'render.blocking_assets',
        `${blocking} scripts in the document head are neither async nor deferred, which delays first render.`,
        { url, rawValue: { blocking } },
      ),
    );
  }

  // Core Web Vitals require an authorized data source. We never estimate them.
  out.push(
    integrations.pagespeed
      ? obs.info(
          G,
          'cwv.unavailable',
          'A PageSpeed Insights key is configured; field data is collected by the performance integration.',
          { url },
        )
      : obs.unverifiable(
          G,
          'cwv.unavailable',
          'Core Web Vitals require an authorized PageSpeed Insights key. No performance score has been estimated.',
          { url },
        ),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Mobile and accessibility
// ---------------------------------------------------------------------------

export async function runMobile(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'mobile');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'mobile' as const;

  if (!parsed.viewport) {
    out.push(
      obs.issue(
        G,
        'viewport.missing',
        'The page declares no mobile viewport, so mobile browsers render it at desktop width.',
        { url },
      ),
    );
  } else if (/width\s*=\s*\d+/.test(parsed.viewport) && !/device-width/.test(parsed.viewport)) {
    out.push(
      obs.issue(
        G,
        'viewport.fixed_width',
        `The viewport is fixed to a specific width ("${parsed.viewport}") rather than device-width.`,
        { url, rawValue: { viewport: parsed.viewport } },
      ),
    );
  } else {
    out.push(
      obs.pass(G, 'viewport.missing', `A responsive viewport is declared: "${parsed.viewport}".`, {
        url,
        rawValue: { viewport: parsed.viewport },
      }),
    );
  }

  const missingAlt = parsed.images.filter((i) => i.alt === null);
  if (parsed.images.length > 0) {
    out.push(
      missingAlt.length > 0
        ? obs.issue(
            G,
            'a11y.img_alt',
            `${missingAlt.length} of ${parsed.images.length} images on the home page have no alt attribute.`,
            {
              url,
              rawValue: { total: parsed.images.length, missing: missingAlt.length },
              evidence: [
                {
                  kind: 'html_snippet',
                  sourceUrl: url,
                  content: missingAlt.slice(0, 8).map((i) => i.src).join('\n'),
                },
              ],
            },
          )
        : obs.pass(G, 'a11y.img_alt', `All ${parsed.images.length} images declare alt text.`, {
            url,
          }),
    );
  }

  const unlabelled = parsed.forms.filter((f) => f.inputs > 0 && !f.hasLabels);
  if (parsed.forms.length > 0) {
    out.push(
      unlabelled.length > 0
        ? obs.issue(
            G,
            'a11y.form_labels',
            `${unlabelled.length} of ${parsed.forms.length} forms have fields without an associated label.`,
            { url, rawValue: { forms: parsed.forms.length, unlabelled: unlabelled.length } },
          )
        : obs.pass(G, 'a11y.form_labels', 'All form fields have associated labels.', { url }),
    );
  }

  const vagueLinks = parsed.links.filter((l) =>
    /^(click here|here|read more|more|link|this)$/i.test(l.text.trim()),
  );
  if (vagueLinks.length > 2) {
    out.push(
      obs.issue(
        G,
        'a11y.link_text',
        `${vagueLinks.length} links use non-descriptive text such as "click here" or "read more".`,
        { url, rawValue: { count: vagueLinks.length } },
      ),
    );
  }

  if (!parsed.lang) {
    out.push(obs.issue(G, 'a11y.lang', 'No document language is declared for assistive technology.', { url }));
  }

  const hasSkipLink = parsed.links.some((l) => /skip to (main|content)/i.test(l.text));
  out.push(
    hasSkipLink
      ? obs.pass(G, 'a11y.skip_link', 'A skip-to-content link is present.', { url })
      : obs.info(G, 'a11y.skip_link', 'No skip-to-content link was found.', { url }),
  );

  // Be explicit that this is a markup signal review, not a conformance audit.
  out.push(
    obs.unverifiable(
      G,
      'a11y.conformance',
      'Full WCAG conformance requires contrast measurement, keyboard testing and assistive-technology review. Only static markup signals were checked automatically.',
      { url },
    ),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

const ANALYTICS_SIGNATURES: { name: string; pattern: RegExp }[] = [
  { name: 'Google Analytics 4 / gtag', pattern: /googletagmanager\.com\/gtag|gtag\(/i },
  { name: 'Google Tag Manager', pattern: /googletagmanager\.com\/gtm\.js|dataLayer/i },
  { name: 'Google Analytics (Universal)', pattern: /google-analytics\.com\/analytics\.js|ga\(/i },
  { name: 'Meta Pixel', pattern: /connect\.facebook\.net\/.*fbevents\.js|fbq\(/i },
  { name: 'Hotjar', pattern: /static\.hotjar\.com/i },
  { name: 'Microsoft Clarity', pattern: /clarity\.ms/i },
  { name: 'LinkedIn Insight', pattern: /snap\.licdn\.com/i },
  { name: 'TikTok Pixel', pattern: /analytics\.tiktok\.com/i },
];

export async function runConversion(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'conversion');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'conversion' as const;
  const html = ctx.root.html ?? '';

  const telLinks = parsed.links.filter((l) => /^tel:/i.test(l.href));
  const mailLinks = parsed.links.filter((l) => /^mailto:/i.test(l.href));
  const whatsapp = parsed.links.filter((l) => /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(l.href));

  out.push(
    telLinks.length > 0
      ? obs.pass(G, 'tel.link', `${telLinks.length} click-to-call link(s) are present.`, {
          url,
          rawValue: { count: telLinks.length },
        })
      : obs.issue(
          G,
          'tel.link',
          'No click-to-call (tel:) link was found, so mobile visitors cannot dial directly from the page.',
          { url },
        ),
  );

  out.push(
    whatsapp.length > 0
      ? obs.pass(G, 'whatsapp.link', `${whatsapp.length} WhatsApp link(s) are present.`, { url })
      : obs.issue(
          G,
          'whatsapp.link',
          'No WhatsApp contact link was found, which is a common conversion path in this market.',
          { url },
        ),
  );

  const phoneShown = /(\+?\d[\d\s().-]{7,}\d)/.test(parsed.text);
  out.push(
    phoneShown || telLinks.length > 0
      ? obs.pass(G, 'contact.phone_visible', 'A telephone number is visible on the home page.', { url })
      : obs.issue(G, 'contact.phone_visible', 'No telephone number is visible on the home page.', { url }),
  );

  const emailShown = mailLinks.length > 0 || /[\w.+-]+@[\w-]+\.[\w.]{2,}/.test(parsed.text);
  out.push(
    emailShown
      ? obs.pass(G, 'contact.email_visible', 'An email address is visible on the home page.', { url })
      : obs.issue(G, 'contact.email_visible', 'No email address is visible on the home page.', { url }),
  );

  // Forms
  if (parsed.forms.length === 0) {
    out.push(
      obs.issue(
        G,
        'form.present',
        'No enquiry or contact form was found on the home page.',
        { url },
      ),
    );
  } else {
    const realForms = parsed.forms.filter((f) => f.inputs > 0);
    const searchOnly = realForms.length === 0;
    out.push(
      searchOnly
        ? obs.issue(G, 'form.present', 'The only form found on the home page has no visible input fields.', { url })
        : obs.pass(G, 'form.present', `${realForms.length} form(s) with input fields are present.`, {
            url,
            rawValue: { forms: parsed.forms },
          }),
    );
    const broken = realForms.filter((f) => !f.action || f.action.trim() === '' || f.action === '#');
    if (broken.length > 0) {
      out.push(
        obs.issue(
          G,
          'form.action_valid',
          `${broken.length} form(s) have no submission target, so submissions may not reach anyone.`,
          { url, rawValue: { broken } },
        ),
      );
    }
  }

  const booking = parsed.links.some((l) => /book|appointment|schedule|calendly|reserve|quote|enquir/i.test(l.text + l.href));
  out.push(
    booking
      ? obs.pass(G, 'booking.present', 'A booking, quote or enquiry path is linked.', { url })
      : obs.issue(G, 'booking.present', 'No booking, quotation or enquiry path was found.', { url }),
  );

  // Analytics
  const detected = ANALYTICS_SIGNATURES.filter((s) => s.pattern.test(html)).map((s) => s.name);
  out.push(
    detected.length > 0
      ? obs.pass(
          G,
          'analytics.tag_present',
          `Measurement tags detected: ${detected.join(', ')}.`,
          { url, rawValue: { detected } },
        )
      : obs.issue(
          G,
          'analytics.tag_present',
          'No analytics or measurement tag was detected in the home page markup, so visitor behaviour and enquiries may not be measured.',
          { url, rawValue: { detected: [] } },
        ),
  );

  // Whether conversion *events* are configured cannot be seen from markup.
  out.push(
    obs.unverifiable(
      G,
      'analytics.events_declared',
      'Whether conversion events are configured can only be confirmed inside the analytics account. Markup inspection cannot establish it.',
      { url },
    ),
  );

  return out;
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export async function runTrust(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'trust');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'trust' as const;

  const linkBlob = parsed.links.map((l) => `${l.text} ${l.href}`).join(' ');

  const hasPrivacy = /privacy/i.test(linkBlob);
  out.push(
    hasPrivacy
      ? obs.pass(G, 'privacy.page', 'A privacy page is linked.', { url })
      : obs.issue(G, 'privacy.page', 'No privacy policy is linked from the home page.', { url }),
  );

  const hasTerms = /terms|conditions/i.test(linkBlob);
  out.push(
    hasTerms
      ? obs.pass(G, 'terms.page', 'A terms page is linked.', { url })
      : obs.issue(G, 'terms.page', 'No terms and conditions page is linked from the home page.', { url }),
  );

  const hasTeam = /team|our people|leadership|staff|management/i.test(linkBlob + parsed.text.slice(0, 3000));
  out.push(
    hasTeam
      ? obs.pass(G, 'team.page', 'Team or leadership information is referenced.', { url })
      : obs.info(G, 'team.page', 'No team or leadership information was found on the home page.', { url }),
  );

  // Social links present on the site, and whether they resolve.
  const socialLinks = parsed.links
    .map((l) => l.absolute)
    .filter((u): u is string => !!u)
    .filter((u) => /facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com/i.test(u));

  if (socialLinks.length === 0) {
    out.push(
      obs.issue(G, 'social.links_present', 'No social media profiles are linked from the home page.', {
        url,
      }),
    );
  } else {
    out.push(
      obs.pass(
        G,
        'social.links_present',
        `${socialLinks.length} social profile link(s) found on the home page.`,
        { url, rawValue: { links: [...new Set(socialLinks)] } },
      ),
    );
    // Whether the target profile exists is a platform question; social networks
    // block automated checks, so this is flagged for manual review rather than
    // guessed.
    out.push(
      obs.unverifiable(
        G,
        'social.links_broken',
        'Social platforms block automated profile checks. Confirm each linked profile manually in the Social review tab.',
        { url, rawValue: { links: [...new Set(socialLinks)] } },
      ),
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Local signals on the website
// ---------------------------------------------------------------------------

export async function runLocal(ctx: AuditContext): Promise<ObservationDraft[]> {
  const ready = requireParsed(ctx, 'local');
  if (Array.isArray(ready)) return ready;
  const { parsed, url } = ready;
  const out: ObservationDraft[] = [];
  const G = 'local' as const;

  const text = parsed.text;
  const hasPhone = /(\+?\d[\d\s().-]{7,}\d)/.test(text);
  const cityMentioned = ctx.city ? new RegExp(ctx.city, 'i').test(text) : false;
  const countryMentioned = new RegExp(ctx.country, 'i').test(text);
  const hasAddressWords = /\b(plot|street|road|avenue|building|floor|p\.?o\.? box|suite)\b/i.test(text);

  const napParts = [hasPhone, hasAddressWords, cityMentioned || countryMentioned].filter(Boolean).length;
  if (napParts === 3) {
    out.push(
      obs.pass(G, 'nap.present', 'Name, address and phone details are all published on the home page.', {
        url,
      }),
    );
  } else {
    out.push(
      obs.issue(
        G,
        'nap.present',
        `Only ${napParts} of the three local business signals (address, telephone, location) were found on the home page.`,
        {
          url,
          rawValue: { hasPhone, hasAddressWords, cityMentioned, countryMentioned },
        },
      ),
    );
  }

  if (ctx.city && !cityMentioned && countryMentioned) {
    out.push(
      obs.info(
        G,
        'nap.consistent',
        `The home page mentions ${ctx.country} but not the recorded city (${ctx.city}).`,
        { url },
      ),
    );
  }

  const hasMap = /google\.com\/maps|maps\.google|openstreetmap|mapbox/i.test(ctx.root.html ?? '');
  out.push(
    hasMap
      ? obs.pass(G, 'map.embed', 'A map is embedded or linked on the home page.', { url })
      : obs.issue(G, 'map.embed', 'No map or directions link was found on the home page.', { url }),
  );

  const hasHours = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*[-–:]\s*|opening hours|business hours|working hours/i.test(text);
  out.push(
    hasHours
      ? obs.pass(G, 'hours.published', 'Opening hours are published on the home page.', { url })
      : obs.issue(G, 'hours.published', 'No opening hours were found on the home page.', { url }),
  );

  const hasLocalBusinessSchema = parsed.structuredDataTypes.some((t) =>
    /LocalBusiness|Organization|Store|ProfessionalService/i.test(t),
  );
  out.push(
    hasLocalBusinessSchema
      ? obs.pass(G, 'schema.localbusiness', 'LocalBusiness or Organization structured data is published.', {
          url,
          rawValue: { types: parsed.structuredDataTypes },
        })
      : obs.issue(
          G,
          'schema.localbusiness',
          'No LocalBusiness or Organization structured data was found, so search engines have no machine-readable business details.',
          { url },
        ),
  );

  return out;
}

/** Exposed for the settings screen so administrators can see what is detected. */
export const ANALYTICS_VENDORS = ANALYTICS_SIGNATURES.map((s) => s.name);
export const performanceIntegrationConfigured = () => integrations.pagespeed;
export const auditUserAgent = () => env.AUDIT_USER_AGENT;
