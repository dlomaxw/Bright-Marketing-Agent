import { obs, type AuditContext, type ObservationDraft } from '../types';
import { parsePage, type ParsedPage } from '../page';

const G = 'seo' as const;

export async function runSeo(ctx: AuditContext): Promise<ObservationDraft[]> {
  const out: ObservationDraft[] = [];
  if (ctx.root.error) return [obs.skipped(G, 'seo.group', 'The home page could not be retrieved.')];

  const parsed = parsePage(ctx.root);
  if (!parsed) {
    return [
      obs.unverifiable(
        G,
        'seo.group',
        `The home page returned ${ctx.root.contentType ?? 'no HTML'}, so markup could not be inspected.`,
        { url: ctx.root.finalUrl },
      ),
    ];
  }
  const url = ctx.root.finalUrl;

  // --- Title ---------------------------------------------------------------
  if (!parsed.title) {
    out.push(
      obs.issue(G, 'title.missing', 'The home page has no <title> element.', {
        url,
        evidence: [{ kind: 'html_snippet', sourceUrl: url, content: '<title> absent from <head>' }],
      }),
    );
  } else {
    const len = parsed.title.length;
    out.push(
      obs.pass(G, 'title.missing', `Title present: "${parsed.title}".`, {
        url,
        rawValue: { title: parsed.title, length: len },
      }),
    );
    if (len < 15 || len > 65) {
      out.push(
        obs.issue(
          G,
          'title.length',
          `The page title is ${len} characters, outside the 15-65 character range that displays fully in search results.`,
          { url, rawValue: { title: parsed.title, length: len } },
        ),
      );
    }
  }

  // --- Meta description ----------------------------------------------------
  if (!parsed.metaDescription) {
    out.push(
      obs.issue(G, 'meta.description_missing', 'The home page has no meta description.', {
        url,
        evidence: [
          { kind: 'html_snippet', sourceUrl: url, content: '<meta name="description"> absent' },
        ],
      }),
    );
  } else {
    const len = parsed.metaDescription.length;
    out.push(
      obs.pass(G, 'meta.description_missing', 'A meta description is present.', {
        url,
        rawValue: { length: len },
      }),
    );
    if (len < 50 || len > 165) {
      out.push(
        obs.issue(
          G,
          'meta.description_length',
          `The meta description is ${len} characters, outside the 50-165 range that displays fully.`,
          { url, rawValue: { length: len, content: parsed.metaDescription } },
        ),
      );
    }
  }

  // --- Headings ------------------------------------------------------------
  if (parsed.h1.length === 0) {
    out.push(
      obs.issue(G, 'heading.h1_missing', 'The home page has no H1 heading.', {
        url,
        rawValue: { headingCount: parsed.headings.length },
      }),
    );
  } else if (parsed.h1.length > 1) {
    out.push(
      obs.issue(
        G,
        'heading.h1_multiple',
        `The home page has ${parsed.h1.length} H1 headings, which weakens the page's primary topic signal.`,
        { url, rawValue: { h1: parsed.h1.slice(0, 5) } },
      ),
    );
  } else {
    out.push(
      obs.pass(G, 'heading.h1_missing', `A single H1 is present: "${parsed.h1[0]}".`, {
        url,
        rawValue: { h1: parsed.h1[0] },
      }),
    );
  }

  const skips = findHeadingSkips(parsed);
  if (skips.length > 0) {
    out.push(
      obs.issue(
        G,
        'heading.order',
        `The heading structure skips ${skips.length} level(s) (for example ${skips[0]}), which affects screen-reader navigation and topic hierarchy.`,
        { url, rawValue: { skips } },
      ),
    );
  }

  // --- Language ------------------------------------------------------------
  if (!parsed.lang) {
    out.push(
      obs.issue(G, 'lang.missing', 'The <html> element has no lang attribute.', { url }),
    );
  }

  // --- Canonical -----------------------------------------------------------
  if (!parsed.canonical) {
    out.push(obs.issue(G, 'canonical.missing', 'The home page declares no canonical URL.', { url }));
  } else {
    let canonicalAbsolute: string | null = null;
    try {
      canonicalAbsolute = new URL(parsed.canonical, url).toString();
    } catch {
      canonicalAbsolute = null;
    }
    if (!canonicalAbsolute) {
      out.push(
        obs.issue(G, 'canonical.conflicting', `The canonical URL "${parsed.canonical}" is not a valid URL.`, {
          url,
          rawValue: { canonical: parsed.canonical },
        }),
      );
    } else if (new URL(canonicalAbsolute).host !== new URL(url).host) {
      out.push(
        obs.issue(
          G,
          'canonical.conflicting',
          `The canonical URL points to a different host (${canonicalAbsolute}).`,
          { url, rawValue: { canonical: canonicalAbsolute } },
        ),
      );
    } else {
      out.push(
        obs.pass(G, 'canonical.missing', `Canonical URL declared: ${canonicalAbsolute}.`, {
          url,
          rawValue: { canonical: canonicalAbsolute },
        }),
      );
    }
  }

  // --- Indexability --------------------------------------------------------
  const robotsMeta = `${parsed.metaRobots ?? ''} ${ctx.root.headers['x-robots-tag'] ?? ''}`;
  if (/noindex/i.test(robotsMeta)) {
    out.push(
      obs.issue(
        G,
        'indexability.noindex',
        'The home page instructs search engines not to index it (noindex).',
        {
          url,
          rawValue: { metaRobots: parsed.metaRobots, header: ctx.root.headers['x-robots-tag'] },
          evidence: [{ kind: 'header', sourceUrl: url, content: robotsMeta.trim() }],
        },
      ),
    );
  }

  // --- robots.txt ----------------------------------------------------------
  if (!ctx.robots.fetched || ctx.robots.body === null) {
    out.push(
      obs.issue(G, 'robots.txt_missing', 'No robots.txt was served at the site root.', {
        url: new URL('/robots.txt', ctx.origin).toString(),
      }),
    );
  } else {
    out.push(
      obs.pass(G, 'robots.txt_missing', 'robots.txt is present.', {
        url: new URL('/robots.txt', ctx.origin).toString(),
      }),
    );
    if (/^\s*disallow:\s*\/\s*$/im.test(ctx.robots.body) && /user-agent:\s*\*/i.test(ctx.robots.body)) {
      out.push(
        obs.issue(
          G,
          'robots.blocks_all',
          'robots.txt contains "Disallow: /" for all crawlers, which asks search engines not to crawl the site.',
          {
            url: new URL('/robots.txt', ctx.origin).toString(),
            evidence: [
              {
                kind: 'html_snippet',
                sourceUrl: new URL('/robots.txt', ctx.origin).toString(),
                content: ctx.robots.body.slice(0, 500),
              },
            ],
          },
        ),
      );
    }
  }

  // --- Sitemap -------------------------------------------------------------
  const declared = ctx.robots.body?.match(/^\s*sitemap:\s*(\S+)/gim)?.map((l) => l.split(/:\s*/).slice(1).join(':').trim()) ?? [];
  const sitemapUrl = declared[0] ?? new URL('/sitemap.xml', ctx.origin).toString();
  const sitemap = await ctx.fetch(sitemapUrl);
  if (!sitemap) {
    out.push(obs.skipped(G, 'sitemap.missing', 'Crawl budget exhausted.', { url: sitemapUrl }));
  } else if (sitemap.error) {
    out.push(
      obs.unverifiable(G, 'sitemap.unreachable', sitemap.error.message, { url: sitemapUrl }),
    );
  } else if (sitemap.status >= 400) {
    out.push(
      obs.issue(
        G,
        'sitemap.missing',
        `No XML sitemap was found (${sitemapUrl} returned HTTP ${sitemap.status}).`,
        { url: sitemapUrl, rawValue: { status: sitemap.status, declaredInRobots: declared.length > 0 } },
      ),
    );
  } else {
    const urlCount = (sitemap.html?.match(/<loc>/gi) ?? []).length;
    out.push(
      obs.pass(G, 'sitemap.missing', `An XML sitemap is published with ${urlCount} URL entries.`, {
        url: sitemap.finalUrl,
        rawValue: { status: sitemap.status, urlCount },
      }),
    );
  }

  // --- Internal links ------------------------------------------------------
  await checkInternalLinks(ctx, parsed, out);

  // --- Structured data -----------------------------------------------------
  if (parsed.structuredDataTypes.includes('__invalid__')) {
    out.push(
      obs.issue(G, 'schema.invalid', 'A JSON-LD structured data block on the page is not valid JSON.', {
        url,
      }),
    );
  } else if (parsed.structuredDataTypes.length === 0) {
    out.push(
      obs.issue(G, 'schema.missing', 'The home page publishes no structured data (schema.org).', {
        url,
      }),
    );
  } else {
    out.push(
      obs.pass(
        G,
        'schema.missing',
        `Structured data present: ${parsed.structuredDataTypes.join(', ')}.`,
        { url, rawValue: { types: parsed.structuredDataTypes } },
      ),
    );
  }

  return out;
}

function findHeadingSkips(parsed: ParsedPage): string[] {
  const skips: string[] = [];
  let previous = 0;
  for (const h of parsed.headings) {
    if (previous > 0 && h.level > previous + 1) {
      skips.push(`H${previous} followed by H${h.level}`);
    }
    previous = h.level;
  }
  return skips;
}

async function checkInternalLinks(
  ctx: AuditContext,
  parsed: ParsedPage,
  out: ObservationDraft[],
): Promise<void> {
  const host = new URL(ctx.origin).host;
  const internal = [
    ...new Set(
      parsed.links
        .map((l) => l.absolute)
        .filter((u): u is string => !!u)
        .filter((u) => {
          try {
            return new URL(u).host === host;
          } catch {
            return false;
          }
        })
        .map((u) => u.split('#')[0] as string),
    ),
  ].filter((u) => u !== ctx.root.finalUrl);

  // Sample within budget rather than crawling the whole site.
  const sample = internal.slice(0, 6);
  const broken: { url: string; status: number | string }[] = [];
  let checked = 0;

  for (const link of sample) {
    const res = await ctx.fetch(link, { method: 'HEAD' });
    if (!res) break;
    checked += 1;
    if (res.error) {
      if (res.error.kind !== 'robots') broken.push({ url: link, status: res.error.kind });
      continue;
    }
    if (res.status >= 400) broken.push({ url: link, status: res.status });
  }

  if (checked === 0) {
    out.push(
      obs.skipped(G, 'link.internal_broken', 'No internal links were available to sample.', {
        url: ctx.root.finalUrl,
      }),
    );
    return;
  }

  if (broken.length > 0) {
    out.push(
      obs.issue(
        G,
        'link.internal_broken',
        `${broken.length} of ${checked} sampled internal links did not return a working page.`,
        {
          url: ctx.root.finalUrl,
          rawValue: { checked, broken },
          evidence: [
            {
              kind: 'http_response',
              sourceUrl: ctx.root.finalUrl,
              content: broken.map((b) => `${b.status} ${b.url}`).join('\n'),
            },
          ],
        },
      ),
    );
  } else {
    out.push(
      obs.pass(
        G,
        'link.internal_broken',
        `All ${checked} sampled internal links returned a working page.`,
        { url: ctx.root.finalUrl, rawValue: { checked } },
      ),
    );
  }
}
