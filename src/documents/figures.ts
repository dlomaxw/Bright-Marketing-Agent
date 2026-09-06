import { db } from '@/lib/db';
import { getObject } from '@/server/storage/r2';
import type { DocumentFigure } from './docx';

/**
 * Loads the screenshot evidence behind an organization's client-facing
 * findings, ready to embed in a report or proposal.
 *
 * The caption is the URL and the capture date, not a description. That is what
 * turns a picture into evidence: the reader can open that address and check
 * whether it still looks like this. A caption saying "the homepage has no
 * contact details" would be the claim restated, which the surrounding text
 * already makes.
 *
 * Only evidence of kind `screenshot` with a stored object is returned. Where a
 * page could not be reached nothing was captured and nothing is invented — the
 * document simply carries the finding without a picture, which is honest and
 * still supported by the finding's own recorded evidence.
 */

export interface FigureSource {
  findingId: string;
  reference: string;
  checkCode: string;
}

/** How many images a single document may carry, so exports stay openable. */
const MAX_FIGURES = 8;

export async function loadFindingFigures(
  organizationId: string,
  options: { max?: number } = {},
): Promise<DocumentFigure[]> {
  const max = options.max ?? MAX_FIGURES;

  const evidence = await db.evidence.findMany({
    where: {
      kind: 'screenshot',
      storageRef: { not: null },
      finding: {
        organizationId,
        deletedAt: null,
        clientVisible: true,
      },
    },
    orderBy: { capturedAt: 'desc' },
    take: max * 2, // room to skip any that fail to load
    select: {
      sourceUrl: true,
      capturedAt: true,
      storageRef: true,
      finding: { select: { reference: true, observation_text: true } },
    },
  });

  const figures: DocumentFigure[] = [];
  const seenUrls = new Set<string>();

  for (const item of evidence) {
    if (figures.length >= max) break;
    if (!item.storageRef) continue;

    // One picture per page. Several findings commonly share a URL, and the
    // same screenshot repeated is padding, not evidence.
    const key = item.sourceUrl ?? item.storageRef;
    if (seenUrls.has(key)) continue;

    const png = await getObject(item.storageRef);
    if (!png || png.byteLength === 0) continue;

    seenUrls.add(key);
    const captured = item.capturedAt.toISOString().slice(0, 10);
    figures.push({
      caption: `${item.finding?.reference ? `${item.finding.reference} — ` : ''}${item.sourceUrl ?? 'source not recorded'}, captured ${captured}.`,
      png,
    });
  }

  return figures;
}
