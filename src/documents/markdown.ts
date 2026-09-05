/**
 * A deliberately small Markdown subset shared by the DOCX and PDF renderers.
 * Report and proposal sections are authored in this subset, so both exports
 * produce the same document structure from the same source.
 */

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; text: string; index: number }
  | { type: 'table'; rows: string[][]; header: boolean }
  | { type: 'spacer' };

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let numberedIndex = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      numberedIndex = 0;
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      i += 1;
      continue;
    }

    // Table: a pipe row followed by a separator row.
    if (trimmed.startsWith('|') && lines[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      const rows: string[][] = [];
      const readRow = (raw: string) =>
        raw
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      rows.push(readRow(trimmed));
      i += 2; // skip the separator
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        rows.push(readRow(lines[i]!));
        i += 1;
      }
      blocks.push({ type: 'table', rows, header: true });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      blocks.push({ type: 'bullet', text: bullet[1]! });
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numbered) {
      numberedIndex += 1;
      blocks.push({ type: 'numbered', text: numbered[2]!, index: numberedIndex });
      i += 1;
      continue;
    }

    blocks.push({ type: 'paragraph', text: trimmed });
    i += 1;
  }

  return blocks;
}

/** Splits `**bold**` and `*italic*` runs. Unmatched markers stay literal. */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) spans.push({ text: text.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('**')) spans.push({ text: token.slice(2, -2), bold: true });
    else spans.push({ text: token.slice(1, -1), italic: true });
    last = match.index + token.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.length > 0 ? spans : [{ text }];
}

export function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[-*]\s+/gm, '• ');
}
