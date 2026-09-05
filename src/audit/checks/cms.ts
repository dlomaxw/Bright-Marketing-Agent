import { obs, type AuditContext, type ObservationDraft } from '../types';
import { parsePage, snippet } from '../page';
import { looksLikePlaceholderEmail, looksLikePlaceholderPhone } from '@/lib/normalize';

const G = 'cms' as const;

/**
 * A short, fixed list of conventional public paths. This is not a discovery
 * scanner: nothing is enumerated, brute-forced or guessed beyond these.
 */
const CONVENTIONAL_PATHS = [
  { path: '/sample-page/', code: 'wp.default_pages', label: 'WordPress sample page' },
  { path: '/hello-world/', code: 'wp.hello_world', label: 'WordPress first post' },
  { path: '/readme.html', code: 'wp.readme', label: 'CMS readme file' },
];

const LOREM = /lorem ipsum dolor sit amet|consectetur adipiscing elit|duis aute irure/i;

const DEMO_MARKERS = [
  'your business tagline',
  'your tagline here',
  'lorem ipsum',
  'demo content',
  'this is a demo',
  'insert your text here',
  'your company name',
  'add your text here',
  'placeholder text',
  'edit this text',
  'sample text',
  'welcome to your new website',
];

const WP_DEFAULT_COPY = [
  'welcome to wordpress. this is your first post',
  'this is an example page. it&#8217;s different from a blog post',
  'this is an example page. it’s different from a blog post',
  "this is an example page. it's different from a blog post",
  'as a new wordpress user, you should go to your dashboard',
];

export async function runCms(ctx: AuditContext): Promise<ObservationDraft[]> {
  const out: ObservationDraft[] = [];
  if (ctx.root.error) {
    return [obs.skipped(G, 'cms.group', 'The home page could not be retrieved.')];
  }

  const rootParsed = parsePage(ctx.root);
  const rootText = rootParsed?.text ?? '';
  const rootLower = rootText.toLowerCase();

  // --- Conventional CMS paths ----------------------------------------------
  for (const entry of CONVENTIONAL_PATHS) {
    const target = new URL(entry.path, ctx.origin).toString();
    const page = await ctx.fetch(target);
    if (!page) {
      out.push(obs.skipped(G, entry.code, 'Crawl budget exhausted.', { url: target }));
      continue;
    }
    if (page.error) {
      out.push(
        page.error.kind === 'robots'
          ? obs.unverifiable(G, entry.code, page.error.message, { url: target })
          : obs.pass(G, entry.code, `${entry.label} is not served (${page.error.message}).`, {
              url: target,
            }),
      );
      continue;
    }
    if (page.status >= 400) {
      out.push(
        obs.pass(G, entry.code, `${entry.label} is not published (HTTP ${page.status}).`, {
          url: target,
          rawValue: { status: page.status },
        }),
      );
      continue;
    }

    const parsed = parsePage(page);
    const text = (parsed?.text ?? '').toLowerCase();
    const matchesDefault = WP_DEFAULT_COPY.some((c) => text.includes(c));

    if (entry.code === 'wp.readme') {
      out.push(
        obs.issue(
          G,
          entry.code,
          `${entry.label} is publicly served at ${entry.path} and returned HTTP ${page.status}.`,
          {
            url: page.finalUrl,
            rawValue: { status: page.status },
            evidence: [
              {
                kind: 'html_snippet',
                sourceUrl: page.finalUrl,
                content: (parsed?.text ?? '').slice(0, 400),
              },
            ],
          },
        ),
      );
      continue;
    }

    if (matchesDefault) {
      out.push(
        obs.issue(
          G,
          entry.code,
          `The public page ${entry.path} returned HTTP ${page.status} and displays default ${entry.label.toLowerCase()} content.`,
          {
            url: page.finalUrl,
            rawValue: { status: page.status, title: parsed?.title ?? null },
            evidence: [
              {
                kind: 'html_snippet',
                sourceUrl: page.finalUrl,
                content: (parsed?.text ?? '').slice(0, 500),
              },
            ],
          },
        ),
      );
    } else {
      out.push(
        obs.info(
          G,
          entry.code,
          `${entry.path} returned HTTP ${page.status} but the content has been replaced.`,
          { url: page.finalUrl, rawValue: { status: page.status } },
        ),
      );
    }
  }

  // --- Placeholder and demo content on the home page ------------------------
  if (LOREM.test(rootText)) {
    out.push(
      obs.issue(G, 'content.lorem', 'Lorem Ipsum placeholder text appears on the home page.', {
        url: ctx.root.finalUrl,
        evidence: [
          {
            kind: 'html_snippet',
            sourceUrl: ctx.root.finalUrl,
            content: snippet(rootText, 'lorem ipsum'),
          },
        ],
      }),
    );
  }

  const demoHit = DEMO_MARKERS.find((m) => m !== 'lorem ipsum' && rootLower.includes(m));
  if (demoHit) {
    out.push(
      obs.issue(
        G,
        'content.demo',
        `The home page contains unedited template text ("${demoHit}").`,
        {
          url: ctx.root.finalUrl,
          rawValue: { marker: demoHit },
          evidence: [
            {
              kind: 'html_snippet',
              sourceUrl: ctx.root.finalUrl,
              content: snippet(rootText, demoHit),
            },
          ],
        },
      ),
    );
  }

  // --- Placeholder contact details -----------------------------------------
  const placeholderPhone = looksLikePlaceholderPhone(rootText);
  const placeholderEmail = looksLikePlaceholderEmail(rootText);
  if (placeholderPhone || placeholderEmail) {
    const parts = [
      placeholderPhone ? 'a placeholder telephone number' : null,
      placeholderEmail ? 'an example email address' : null,
    ].filter(Boolean);
    out.push(
      obs.issue(
        G,
        'content.placeholder_contact',
        `The home page publishes ${parts.join(' and ')}.`,
        {
          url: ctx.root.finalUrl,
          rawValue: { placeholderPhone, placeholderEmail },
          evidence: [
            {
              kind: 'html_snippet',
              sourceUrl: ctx.root.finalUrl,
              content: snippet(rootText, placeholderEmail ? '@example.' : '555'),
            },
          ],
        },
      ),
    );
  }

  // --- Generator disclosure -------------------------------------------------
  if (rootParsed?.generator) {
    out.push(
      obs.info(G, 'cms.generator', `The page declares a generator: ${rootParsed.generator}.`, {
        url: ctx.root.finalUrl,
        rawValue: { generator: rootParsed.generator },
      }),
    );
  }

  // --- Public staging subdomain --------------------------------------------
  // Only the conventional prefixes, only on the same registrable domain.
  const host = new URL(ctx.origin).hostname.replace(/^www\./, '');
  for (const prefix of ['staging', 'dev', 'test']) {
    const candidate = `https://${prefix}.${host}/`;
    const page = await ctx.fetch(candidate);
    if (!page) break; // budget exhausted; stop rather than half-report
    if (page.error || page.status >= 400) {
      out.push(
        obs.pass(G, 'staging.public', `No public site at ${prefix}.${host}.`, { url: candidate }),
      );
      continue;
    }
    const parsed = parsePage(page);
    const noindex = /noindex/i.test(parsed?.metaRobots ?? '');
    out.push(
      noindex
        ? obs.info(
            G,
            'staging.public',
            `A site responds at ${prefix}.${host} (HTTP ${page.status}) but declares noindex.`,
            { url: page.finalUrl, rawValue: { status: page.status, robots: parsed?.metaRobots } },
          )
        : obs.issue(
            G,
            'staging.public',
            `A publicly reachable, indexable site responds at ${prefix}.${host} (HTTP ${page.status}).`,
            {
              url: page.finalUrl,
              rawValue: { status: page.status, title: parsed?.title ?? null },
              evidence: [
                {
                  kind: 'http_response',
                  sourceUrl: page.finalUrl,
                  content: `HTTP ${page.status}\ntitle: ${parsed?.title ?? 'none'}`,
                },
              ],
            },
          ),
    );
  }

  return out;
}
