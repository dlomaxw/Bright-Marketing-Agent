import * as cheerio from 'cheerio';
import type { FetchedPage } from './types';

export interface ParsedPage {
  url: string;
  $: cheerio.CheerioAPI;
  title: string | null;
  metaDescription: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  viewport: string | null;
  headings: { level: number; text: string }[];
  h1: string[];
  text: string;
  links: { href: string; absolute: string | null; text: string; rel: string | null }[];
  images: { src: string; absolute: string | null; alt: string | null; loading: string | null }[];
  scripts: string[];
  forms: { action: string | null; method: string; inputs: number; hasLabels: boolean }[];
  generator: string | null;
  structuredDataTypes: string[];
  bodyBytes: number;
}

const abs = (href: string, base: string): string | null => {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
};

export function parsePage(page: FetchedPage): ParsedPage | null {
  if (!page.html) return null;
  const $ = cheerio.load(page.html);
  const base = page.finalUrl;

  const headings: { level: number; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? 'h6';
    const level = Number(tag.replace(/\D/g, '')) || 6;
    headings.push({ level, text: $(el).text().trim().slice(0, 300) });
  });

  const links: ParsedPage['links'] = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#')) return;
    links.push({
      href,
      absolute: /^(mailto:|tel:|javascript:|whatsapp:)/i.test(href) ? null : abs(href, base),
      text: $(el).text().trim().slice(0, 200),
      rel: $(el).attr('rel') ?? null,
    });
  });

  const images: ParsedPage['images'] = [];
  $('img').each((_, el) => {
    const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim();
    if (!src) return;
    images.push({
      src,
      absolute: src.startsWith('data:') ? null : abs(src, base),
      alt: $(el).attr('alt') ?? null,
      loading: $(el).attr('loading') ?? null,
    });
  });

  const forms: ParsedPage['forms'] = [];
  $('form').each((_, el) => {
    const $f = $(el);
    const inputs = $f.find('input, textarea, select').not('[type=hidden]');
    const labelled = inputs.filter((_i, inp) => {
      const $i = $(inp);
      const id = $i.attr('id');
      return (
        !!$i.attr('aria-label') ||
        !!$i.attr('aria-labelledby') ||
        (!!id && $f.find(`label[for="${id}"]`).length > 0) ||
        $i.parents('label').length > 0
      );
    });
    forms.push({
      action: $f.attr('action') ?? null,
      method: ($f.attr('method') ?? 'get').toLowerCase(),
      inputs: inputs.length,
      hasLabels: inputs.length > 0 && labelled.length === inputs.length,
    });
  });

  const scripts: string[] = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) scripts.push(src);
  });

  const structuredDataTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text());
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(collect);
        if (node && typeof node === 'object') {
          const t = (node as Record<string, unknown>)['@type'];
          if (typeof t === 'string') structuredDataTypes.push(t);
          else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && structuredDataTypes.push(x));
          const graph = (node as Record<string, unknown>)['@graph'];
          if (graph) collect(graph);
        }
      };
      collect(data);
    } catch {
      structuredDataTypes.push('__invalid__');
    }
  });
  $('[itemtype]').each((_, el) => {
    const t = $(el).attr('itemtype');
    if (t) structuredDataTypes.push(t.split('/').pop() ?? t);
  });

  $('script, style, noscript, template, svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  return {
    url: base,
    $,
    title: $('title').first().text().trim() || null,
    metaDescription: $('meta[name="description"]').attr('content')?.trim() ?? null,
    metaRobots: $('meta[name="robots"]').attr('content')?.trim() ?? null,
    canonical: $('link[rel="canonical"]').attr('href')?.trim() ?? null,
    lang: $('html').attr('lang')?.trim() ?? null,
    viewport: $('meta[name="viewport"]').attr('content')?.trim() ?? null,
    headings,
    h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    text,
    links,
    images,
    scripts,
    forms,
    generator: $('meta[name="generator"]').attr('content')?.trim() ?? null,
    structuredDataTypes: [...new Set(structuredDataTypes)],
    bodyBytes: page.bytes,
  };
}

/** Short, redactable snippet used as evidence in reports. */
export function snippet(text: string, needle: string, radius = 120): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + needle.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
