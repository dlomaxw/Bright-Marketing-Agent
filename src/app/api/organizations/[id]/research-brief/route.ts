import type { NextRequest } from 'next/server';
import { apiHandler, notFound, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { buildResearchBrief } from '@/server/reports/research-brief';
import { renderPdf } from '@/documents/pdf';
import { parseBlocks } from '@/documents/markdown';

type Ctx = { params: Promise<{ id: string }> };

/**
 * The internal research brief: everything the audit found, including what has
 * not been reviewed yet.
 *
 * `?format=pdf` renders it. It is watermarked as internal in the body text,
 * because a PDF is the format most likely to be forwarded by accident.
 */
export const GET = apiHandler<Ctx>(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const user = await requirePermission('audit.read');

  const brief = await buildResearchBrief(id);
  if (!brief) throw notFound('Organization');

  if (req.nextUrl.searchParams.get('format') !== 'pdf') {
    return ok(brief);
  }

  // Split the markdown into sections the renderer understands: each `##` starts
  // a new one.
  const blocks = parseBlocks(brief.markdown);
  const sections: { heading: string; body: string }[] = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 2) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n') });
      current = { heading: block.text, body: [] };
      continue;
    }
    if (block.type === 'heading' && block.level === 1) continue; // the title
    if (!current) current = { heading: 'Overview', body: [] };

    if (block.type === 'heading') current.body.push(`### ${block.text}`);
    else if (block.type === 'bullet') current.body.push(`- ${block.text}`);
    else if (block.type === 'numbered') current.body.push(`${block.index}. ${block.text}`);
    else if (block.type === 'table') {
      current.body.push(`| ${block.rows[0]?.join(' | ') ?? ''} |`);
      current.body.push(`| ${(block.rows[0] ?? []).map(() => '---').join(' | ')} |`);
      for (const row of block.rows.slice(1)) current.body.push(`| ${row.join(' | ')} |`);
    } else if (block.type === 'paragraph') current.body.push(block.text);
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n') });

  const buffer = await renderPdf(
    {
      title: 'Research brief (internal)',
      organization: brief.organizationName,
      version: 1,
      status: 'internal working document',
      preparedBy: user.name,
      date: new Date(brief.generatedAt),
    },
    sections,
  );

  const safeName = brief.organizationName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="research-brief-INTERNAL-${safeName}.pdf"`,
      'cache-control': 'no-store',
    },
  });
});
