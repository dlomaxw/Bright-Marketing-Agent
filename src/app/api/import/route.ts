import type { NextRequest } from 'next/server';
import { apiHandler, badRequest, ok } from '@/lib/api';
import { requirePermission } from '@/server/auth/guard';
import { importCsv } from '@/server/leads/import';
import { parseCsvTable, suggestMapping } from '@/lib/csv';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Accepts a CSV upload. XLSX is converted to CSV by the user before upload in
 * this build - see docs/USER_GUIDE.md; the mapper is identical either way.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requirePermission('org.import');
  const form = await req.formData();

  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Attach a CSV file.');
  if (file.size > MAX_BYTES) throw badRequest('The file is larger than 5 MB.');

  const text = await file.text();
  const table = parseCsvTable(text);
  if (table.rows.length === 0) throw badRequest('The file contains no data rows.');
  if (table.rows.length > 5000) throw badRequest('Import at most 5000 rows at a time.');

  const dryRun = form.get('dryRun') === 'true';
  const mergeDuplicates = form.get('mergeDuplicates') === 'true';
  const markAsDemoData = form.get('markAsDemoData') === 'true';

  let mapping: Record<string, string | null> | undefined;
  const rawMapping = form.get('mapping');
  if (typeof rawMapping === 'string' && rawMapping.trim()) {
    try {
      mapping = JSON.parse(rawMapping) as Record<string, string | null>;
    } catch {
      throw badRequest('The column mapping is not valid JSON.');
    }
  }

  const summary = await importCsv(text, {
    mapping,
    mergeDuplicates,
    markAsDemoData,
    actorId: user.id,
    ownerId: user.id,
    dryRun,
  });

  return ok({ ...summary, headers: table.headers, suggestedMapping: suggestMapping(table.headers) });
});
