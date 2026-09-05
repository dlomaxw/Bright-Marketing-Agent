import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  ImageRun,
  Footer,

  WidthType,
  BorderStyle,
} from 'docx';
import { parseBlocks, parseSpans, type Block } from './markdown';
import { BRAND } from '@/config/brand';
import { contactLine, contactLines, logoBuffer } from './brand-assets';

export interface DocumentSection {
  heading: string;
  body: string;
}

export interface DocumentMeta {
  title: string;
  subtitle?: string;
  organization: string;
  version: number;
  status: string;
  preparedBy: string;
  date: Date;
}

const NAVY = BRAND.navy.replace('#', '');
const BLUE = BRAND.blue.replace('#', '');
const GOLD = BRAND.gold.replace('#', '');
const TEXT = BRAND.text.replace('#', '');

function renderBlock(block: Block): (Paragraph | Table)[] {
  switch (block.type) {
    case 'heading': {
      const level =
        block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      return [
        new Paragraph({
          heading: level,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: block.text,
              bold: true,
              color: block.level === 1 ? NAVY : BLUE,
              size: block.level === 1 ? 32 : block.level === 2 ? 26 : 23,
            }),
          ],
        }),
      ];
    }
    case 'paragraph':
      return [
        new Paragraph({
          spacing: { after: 120, line: 300 },
          children: parseSpans(block.text).map(
            (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, color: TEXT, size: 21 }),
          ),
        }),
      ];
    case 'bullet':
      return [
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60, line: 280 },
          children: parseSpans(block.text).map(
            (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, color: TEXT, size: 21 }),
          ),
        }),
      ];
    case 'numbered':
      return [
        new Paragraph({
          spacing: { after: 60, line: 280 },
          indent: { left: 360 },
          children: [
            new TextRun({ text: `${block.index}. `, bold: true, color: BLUE, size: 21 }),
            ...parseSpans(block.text).map(
              (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, color: TEXT, size: 21 }),
            ),
          ],
        }),
      ];
    case 'table': {
      const rows = block.rows.map(
        (cells, rowIndex) =>
          new TableRow({
            tableHeader: block.header && rowIndex === 0,
            children: cells.map(
              (cell) =>
                new TableCell({
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  shading:
                    block.header && rowIndex === 0
                      ? { fill: 'EEF3F8', type: 'clear', color: 'auto' }
                      : undefined,
                  children: [
                    new Paragraph({
                      children: parseSpans(cell).map(
                        (s) =>
                          new TextRun({
                            text: s.text,
                            bold: s.bold || (block.header && rowIndex === 0),
                            italics: s.italic,
                            color: block.header && rowIndex === 0 ? NAVY : TEXT,
                            size: 20,
                          }),
                      ),
                    }),
                  ],
                }),
            ),
          }),
      );
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'D6DEE8' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D6DEE8' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'D6DEE8' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'D6DEE8' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E4EAF2' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E4EAF2' },
          },
        }),
        new Paragraph({ spacing: { after: 160 }, children: [] }),
      ];
    }
    case 'spacer':
    default:
      return [new Paragraph({ children: [] })];
  }
}

export async function renderDocx(meta: DocumentMeta, sections: DocumentSection[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // Cover — logo first, falling back to the wordmark if the file is missing.
  const logo = logoBuffer();
  if (logo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 480, after: 240 },
        children: [
          new ImageRun({
            data: logo,
            transformation: { width: 96, height: 96 },
            type: 'png',
          }),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { before: logo ? 0 : 1200, after: 60 },
      children: [new TextRun({ text: BRAND.companyName.toUpperCase(), bold: true, color: GOLD, size: 22 })],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: meta.title, bold: true, color: NAVY, size: 48 })],
    }),
    new Paragraph({
      spacing: { after: 480 },
      children: [new TextRun({ text: meta.organization, color: BLUE, size: 28 })],
    }),
  );

  children.push(
    ...renderBlock({
      type: 'table',
      header: false,
      rows: [
        ['Document', `${meta.title} (version ${meta.version})`],
        ['Status', meta.status],
        ['Prepared by', meta.preparedBy],
        ['Date', meta.date.toISOString().slice(0, 10)],
      ],
    }),
  );

  children.push(
    new Paragraph({
      spacing: { before: 480 },
      children: [
        new TextRun({
          text: 'This document records publicly observable characteristics of the organisation’s digital presence at the dates and times stated. It is not a security assessment.',
          italics: true,
          color: '5A6B7D',
          size: 18,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 360, after: 40 },
      children: [new TextRun({ text: BRAND.companyName, bold: true, color: NAVY, size: 19 })],
    }),
    ...contactLines()
      .slice(1)
      .map(
        (line) =>
          new Paragraph({
            spacing: { after: 20 },
            children: [new TextRun({ text: line, color: '5A6B7D', size: 17 })],
          }),
      ),
    new Paragraph({ pageBreakBefore: true, children: [] }),
  );

  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 160 },
        children: [new TextRun({ text: section.heading, bold: true, color: NAVY, size: 30 })],
      }),
    );
    for (const block of parseBlocks(section.body)) children.push(...renderBlock(block));
  }

  const doc = new Document({
    creator: BRAND.companyName,
    title: `${meta.title} - ${meta.organization}`,
    description: `Version ${meta.version} (${meta.status})`,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 21, color: TEXT } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        // Contact details on every page, so a printed page that gets separated
        // from the cover can still be traced back to us.
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: contactLine(), color: '8896A6', size: 15 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
