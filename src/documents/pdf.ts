import PDFDocument from 'pdfkit';
import { parseBlocks, parseSpans } from './markdown';
import { BRAND } from '@/config/brand';
import { contactLine, contactLines, logoBuffer } from './brand-assets';
import type { DocumentMeta, DocumentSection } from './docx';

/**
 * PDF rendering with pdfkit - pure Node, so the deployment image needs no
 * headless browser. Uses the same Markdown subset as the DOCX renderer, so both
 * exports carry identical content.
 */

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export async function renderPdf(meta: DocumentMeta, sections: DocumentSection[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 24, left: MARGIN, right: MARGIN },
      info: {
        Title: `${meta.title} - ${meta.organization}`,
        Author: BRAND.companyName,
        Subject: `Version ${meta.version} (${meta.status})`,
      },
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // --- Cover --------------------------------------------------------------
    doc.rect(0, 0, PAGE_WIDTH, 8).fill(BRAND.gold);

    // Logo first, with the wordmark falling back to text if it is missing.
    const logo = logoBuffer();
    let coverTop = 140;
    if (logo) {
      try {
        doc.image(logo, MARGIN, 72, { width: 78, height: 78 });
        coverTop = 168;
      } catch {
        // A corrupt image must not fail the export.
      }
    }

    doc.fillColor(BRAND.gold).fontSize(10).font('Helvetica-Bold');
    doc.text(BRAND.companyName.toUpperCase(), MARGIN, coverTop, { characterSpacing: 1.2 });

    doc.fillColor(BRAND.navy).fontSize(30).font('Helvetica-Bold');
    doc.text(meta.title, MARGIN, coverTop + 30, { width: CONTENT_WIDTH });

    doc.moveDown(0.4);
    doc.fillColor(BRAND.blue).fontSize(16).font('Helvetica');
    doc.text(meta.organization, { width: CONTENT_WIDTH });

    doc.moveDown(2);
    const rows: [string, string][] = [
      ['Document', `${meta.title} (version ${meta.version})`],
      ['Status', meta.status],
      ['Prepared by', meta.preparedBy],
      ['Date', meta.date.toISOString().slice(0, 10)],
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.fillColor('#5A6B7D').fontSize(9).font('Helvetica-Bold').text(label.toUpperCase(), MARGIN, y, { width: 120 });
      doc.fillColor(BRAND.text).fontSize(11).font('Helvetica').text(value, MARGIN + 130, y, { width: CONTENT_WIDTH - 130 });
      doc.moveDown(0.6);
    }

    doc.moveDown(2);
    doc.fillColor('#5A6B7D').fontSize(9).font('Helvetica-Oblique');
    doc.text(
      'This document records publicly observable characteristics of the organisation’s digital presence at the dates and times stated. It is not a security assessment.',
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );

    // Contact block, low on the cover page.
    const contactTop = doc.page.height - MARGIN - 96;
    doc
      .moveTo(MARGIN, contactTop - 12)
      .lineTo(MARGIN + 48, contactTop - 12)
      .lineWidth(2)
      .strokeColor(BRAND.gold)
      .stroke();

    doc.fillColor(BRAND.navy).fontSize(9).font('Helvetica-Bold');
    doc.text(BRAND.companyName, MARGIN, contactTop, { width: CONTENT_WIDTH });
    doc.fillColor('#5A6B7D').fontSize(8.5).font('Helvetica');
    for (const line of contactLines().slice(1)) {
      doc.text(line, MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
    }

    // --- Body ---------------------------------------------------------------
    for (const section of sections) {
      doc.addPage();
      heading(doc, section.heading, 1);
      for (const block of parseBlocks(section.body)) {
        switch (block.type) {
          case 'heading':
            heading(doc, block.text, block.level);
            break;
          case 'paragraph':
            richText(doc, block.text, { size: 10.5, indent: 0 });
            doc.moveDown(0.5);
            break;
          case 'bullet':
            bullet(doc, block.text);
            break;
          case 'numbered':
            numbered(doc, block.index, block.text);
            break;
          case 'table':
            table(doc, block.rows, block.header);
            break;
          default:
            doc.moveDown(0.5);
        }
      }

      for (const figure of section.figures ?? []) {
        try {
          const imageWidth = PAGE_WIDTH - MARGIN * 2;
          // 1280x800 captures keep a 5:8 ratio; the caption needs room below.
          const imageHeight = Math.round((imageWidth * 800) / 1280);
          if (doc.y + imageHeight + 40 > doc.page.height - MARGIN) doc.addPage();

          doc.moveDown(0.6);
          doc.image(figure.png, MARGIN, doc.y, { width: imageWidth });
          doc.y += imageHeight + 6;
          doc
            .fontSize(8)
            .fillColor('#6B7280')
            .text(figure.caption, MARGIN, doc.y, { width: imageWidth });
          doc.moveDown(0.8).fillColor('#111827');
        } catch {
          // A corrupt image must not fail the export. The finding's text stands
          // on its own; the picture supports it, it does not carry it.
        }
      }
    }

    // --- Footers ------------------------------------------------------------
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - MARGIN + 2;

      // A thin rule keeps the two footer lines from crowding the body text.
      doc
        .moveTo(MARGIN, footerY - 6)
        .lineTo(PAGE_WIDTH - MARGIN, footerY - 6)
        .lineWidth(0.5)
        .strokeColor('#E4EAF2')
        .stroke();

      doc
        .fillColor('#8896A6')
        .fontSize(7.5)
        .font('Helvetica')
        .text(contactLine(), MARGIN, footerY, {
          width: CONTENT_WIDTH - 40,
          lineBreak: false,
        });
      doc.text(
        `${meta.organization} · ${meta.title} v${meta.version} (${meta.status})`,
        MARGIN,
        footerY + 9,
        { width: CONTENT_WIDTH - 40, lineBreak: false },
      );
      doc.text(`${i - range.start + 1}`, PAGE_WIDTH - MARGIN - 30, footerY + 4, {
        width: 30,
        align: 'right',
        lineBreak: false,
      });
    }

    doc.end();
  });
}

type Doc = PDFKit.PDFDocument;

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > doc.page.height - MARGIN - 24) doc.addPage();
}

function heading(doc: Doc, text: string, level: 1 | 2 | 3): void {
  const size = level === 1 ? 17 : level === 2 ? 13 : 11.5;
  ensureSpace(doc, size + 24);
  doc.moveDown(level === 1 ? 0.2 : 0.8);
  doc
    .fillColor(level === 1 ? BRAND.navy : BRAND.blue)
    .fontSize(size)
    .font('Helvetica-Bold')
    .text(text, MARGIN, doc.y, { width: CONTENT_WIDTH });
  if (level === 1) {
    const y = doc.y + 4;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + 48, y).lineWidth(2).strokeColor(BRAND.gold).stroke();
    doc.y = y + 10;
  } else {
    doc.moveDown(0.35);
  }
}

function richText(doc: Doc, text: string, opts: { size: number; indent: number }): void {
  ensureSpace(doc, opts.size * 2);
  const spans = parseSpans(text);
  doc.fontSize(opts.size).fillColor(BRAND.text);
  const x = MARGIN + opts.indent;
  const width = CONTENT_WIDTH - opts.indent;

  spans.forEach((span, i) => {
    doc.font(span.bold ? 'Helvetica-Bold' : span.italic ? 'Helvetica-Oblique' : 'Helvetica');
    const isLast = i === spans.length - 1;
    doc.text(span.text, i === 0 ? x : undefined, i === 0 ? doc.y : undefined, {
      width,
      continued: !isLast,
      lineGap: 2,
    });
  });
}

function bullet(doc: Doc, text: string): void {
  ensureSpace(doc, 24);
  const y = doc.y;
  doc.fillColor(BRAND.gold).fontSize(10.5).font('Helvetica-Bold').text('•', MARGIN + 4, y, { width: 12 });
  doc.y = y;
  richText(doc, text, { size: 10.5, indent: 20 });
  doc.moveDown(0.2);
}

function numbered(doc: Doc, index: number, text: string): void {
  ensureSpace(doc, 24);
  const y = doc.y;
  doc.fillColor(BRAND.blue).fontSize(10.5).font('Helvetica-Bold').text(`${index}.`, MARGIN + 2, y, { width: 18 });
  doc.y = y;
  richText(doc, text, { size: 10.5, indent: 24 });
  doc.moveDown(0.2);
}

function table(doc: Doc, rows: string[][], header: boolean): void {
  if (rows.length === 0) return;
  const columns = Math.max(...rows.map((r) => r.length));
  const colWidth = CONTENT_WIDTH / columns;
  const padding = 6;

  for (const [rowIndex, cells] of rows.entries()) {
    const isHeader = header && rowIndex === 0;
    doc.fontSize(9.5).font(isHeader ? 'Helvetica-Bold' : 'Helvetica');

    const heights = cells.map((cell) =>
      doc.heightOfString(cell.replace(/\*\*/g, ''), { width: colWidth - padding * 2 }),
    );
    const rowHeight = Math.max(16, ...heights) + padding * 2;
    ensureSpace(doc, rowHeight + 4);

    const top = doc.y;
    if (isHeader) {
      doc.rect(MARGIN, top, CONTENT_WIDTH, rowHeight).fill(BRAND.lightBackground);
    }
    doc.strokeColor('#D6DEE8').lineWidth(0.5);
    doc.rect(MARGIN, top, CONTENT_WIDTH, rowHeight).stroke();

    cells.forEach((cell, colIndex) => {
      const x = MARGIN + colIndex * colWidth;
      if (colIndex > 0) {
        doc.moveTo(x, top).lineTo(x, top + rowHeight).strokeColor('#E4EAF2').stroke();
      }
      doc
        .fillColor(isHeader ? BRAND.navy : BRAND.text)
        .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9.5)
        .text(cell.replace(/\*\*/g, ''), x + padding, top + padding, {
          width: colWidth - padding * 2,
          lineGap: 1,
        });
    });

    doc.y = top + rowHeight;
  }
  doc.moveDown(0.8);
}
