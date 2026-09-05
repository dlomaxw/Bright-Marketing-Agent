import { parseBlocks, parseSpans } from '@/documents/markdown';

/**
 * Renders the Markdown subset used by reports and proposals into HTML for the
 * on-screen preview.
 *
 * Every piece of text is HTML-escaped BEFORE any markup is added, so a report
 * section can never inject markup into the page — the content originates from
 * audited websites and from AI drafts, neither of which is trusted.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const inline = (text: string): string =>
  parseSpans(text)
    .map((span) => {
      const safe = escapeHtml(span.text);
      if (span.bold) return `<strong>${safe}</strong>`;
      if (span.italic) return `<em>${safe}</em>`;
      return safe;
    })
    .join('');

export function renderMarkdown(markdown: string): string {
  const blocks = parseBlocks(markdown);
  const html: string[] = [];

  let listType: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const openList = (type: 'ul' | 'ol') => {
    if (listType !== type) {
      closeList();
      html.push(`<${type}>`);
      listType = type;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        closeList();
        html.push(`<h${block.level}>${inline(block.text)}</h${block.level}>`);
        break;
      case 'paragraph':
        closeList();
        html.push(`<p>${inline(block.text)}</p>`);
        break;
      case 'bullet':
        openList('ul');
        html.push(`<li>${inline(block.text)}</li>`);
        break;
      case 'numbered':
        openList('ol');
        html.push(`<li>${inline(block.text)}</li>`);
        break;
      case 'table': {
        closeList();
        const [head, ...rest] = block.rows;
        html.push('<table>');
        if (block.header && head) {
          html.push(`<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`);
        }
        html.push('<tbody>');
        for (const row of block.header ? rest : block.rows) {
          html.push(`<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
        }
        html.push('</tbody></table>');
        break;
      }
      default:
        break;
    }
  }
  closeList();
  return html.join('\n');
}
