import pptxgen from 'pptxgenjs';
import { BRAND } from '@/config/brand';
import { contactLines, logoDataUri } from './brand-assets';

export interface PresentationSlide {
  title: string;
  subtitle?: string;
  bullets?: string[];
  cards?: { title: string; body: string; badge?: string }[];
  table?: { headers: string[]; rows: string[][] };
}

export interface PresentationMeta {
  title: string;
  organization: string;
  date: string;
  preparedBy: string;
  version: number;
}

export async function generatePptx(
  meta: PresentationMeta,
  slides: PresentationSlide[],
): Promise<Buffer> {
  const pptx = new pptxgen();

  pptx.layout = 'LAYOUT_16x9';
  pptx.author = BRAND.companyName;
  pptx.company = BRAND.companyName;
  pptx.title = `${meta.title} - ${meta.organization}`;

  // Theme Colors
  const NAVY = BRAND.navy.replace('#', '');
  const GOLD = BRAND.gold.replace('#', '');
  const BLUE = BRAND.blue.replace('#', '');
  const LIGHT_BG = 'F4F7FA';
  const CARD_BG = 'FFFFFF';
  const TEXT_DARK = '1E293B';
  const TEXT_MUTED = '64748B';

  /**
   * The logo appears on every slide, not just the cover. A deck gets screenshotted,
   * exported to PDF and pasted into other documents a slide at a time, so any
   * slide that travels alone still has to identify who produced it.
   */
  const logo = logoDataUri();

  const stampLogo = (slide: pptxgen.Slide, placement: 'cover' | 'corner') => {
    if (!logo) return;
    const box =
      placement === 'cover'
        ? { x: 0.8, y: 0.55, w: 1.15, h: 1.15 }
        : { x: 12.15, y: 0.32, w: 0.72, h: 0.72 };
    slide.addImage({ data: logo, ...box });
  };

  // --- Title Slide (Dark Cover) --------------------------------------------
  const cover = pptx.addSlide();
  cover.background = { color: NAVY };

  // Top Accent Bar
  cover.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: '100%',
    h: 0.15,
    fill: { color: GOLD },
  });

  stampLogo(cover, 'cover');

  // Company Brand Label
  cover.addText(BRAND.companyName.toUpperCase(), {
    x: 0.8,
    y: logo ? 1.85 : 1.2,
    w: 10,
    h: 0.4,
    fontSize: 14,
    bold: true,
    color: GOLD,
    fontFace: 'Helvetica',
  });

  // Presentation Title
  cover.addText(meta.title, {
    x: 0.8,
    y: logo ? 2.35 : 1.8,
    w: 11,
    h: 1.4,
    fontSize: 34,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Helvetica',
  });

  // Target Organization
  cover.addText(`Prepared for: ${meta.organization}`, {
    x: 0.8,
    y: logo ? 3.75 : 3.5,
    w: 11,
    h: 0.6,
    fontSize: 21,
    color: BLUE,
    fontFace: 'Helvetica',
  });

  // Contact block — on the cover, not only the closing slide, so the deck is
  // actionable the moment it is opened.
  cover.addText(contactLines().join('   ·   '), {
    x: 0.8,
    y: 6.15,
    w: 11.7,
    h: 0.4,
    fontSize: 11,
    color: GOLD,
    fontFace: 'Helvetica',
  });

  // Metadata Footer
  cover.addText(
    `Version ${meta.version}  |  ${meta.date}  |  Prepared by: ${meta.preparedBy}`,
    {
      x: 0.8,
      y: 6.6,
      w: 10,
      h: 0.4,
      fontSize: 11,
      color: '94A3B8',
      fontFace: 'Helvetica',
    },
  );

  // --- Content Slides ------------------------------------------------------
  for (const slideData of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: LIGHT_BG };

    stampLogo(slide, 'corner');

    // Slide Header — narrowed so long titles cannot run under the logo.
    slide.addText(slideData.title, {
      x: 0.8,
      y: 0.5,
      w: 11.1,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: NAVY,
      fontFace: 'Helvetica',
    });

    if (slideData.subtitle) {
      slide.addText(slideData.subtitle, {
        x: 0.8,
        y: 1.1,
        w: 11,
        h: 0.4,
        fontSize: 14,
        color: TEXT_MUTED,
        fontFace: 'Helvetica',
      });
    }

    // Divider Line
    slide.addShape(pptx.ShapeType.line, {
      x: 0.8,
      y: 1.5,
      w: 11.5,
      h: 0,
      line: { color: 'CBD5E1', width: 1 },
    });

    // Content: Cards Grid
    if (slideData.cards && slideData.cards.length > 0) {
      const cardWidth = 3.6;
      const gap = 0.35;

      slideData.cards.slice(0, 3).forEach((card, idx) => {
        const xPos = 0.8 + idx * (cardWidth + gap);

        // Card Container
        slide.addShape(pptx.ShapeType.rect, {
          x: xPos,
          y: 1.8,
          w: cardWidth,
          h: 4.8,
          fill: { color: CARD_BG },
          line: { color: 'E2E8F0', width: 1 },
          rectRadius: 0.1,
        });

        // Badge
        if (card.badge) {
          slide.addText(card.badge.toUpperCase(), {
            x: xPos + 0.2,
            y: 2.0,
            w: cardWidth - 0.4,
            h: 0.3,
            fontSize: 10,
            bold: true,
            color: GOLD,
            fontFace: 'Helvetica',
          });
        }

        // Card Title
        slide.addText(card.title, {
          x: xPos + 0.2,
          y: card.badge ? 2.3 : 2.0,
          w: cardWidth - 0.4,
          h: 0.6,
          fontSize: 16,
          bold: true,
          color: NAVY,
          fontFace: 'Helvetica',
        });

        // Card Body
        slide.addText(card.body, {
          x: xPos + 0.2,
          y: card.badge ? 2.9 : 2.6,
          w: cardWidth - 0.4,
          h: 3.4,
          fontSize: 12,
          color: TEXT_DARK,
          fontFace: 'Helvetica',
          valign: 'top',
        });
      });
    } else if (slideData.bullets && slideData.bullets.length > 0) {
      // Content: Bullets List
      const bulletItems = slideData.bullets.map((b) => ({
        text: b,
        options: { fontSize: 14, color: TEXT_DARK, bullet: true, spaceAfter: 12 },
      }));

      slide.addText(bulletItems, {
        x: 0.8,
        y: 1.8,
        w: 11.5,
        h: 4.8,
        fontFace: 'Helvetica',
        valign: 'top',
      });
    } else if (slideData.table) {
      // Content: Table
      const tableRows = [
        slideData.table.headers.map((h) => ({
          text: h,
          options: { bold: true, color: 'FFFFFF', fill: { color: NAVY }, fontSize: 12 },
        })),
        ...slideData.table.rows.map((row) =>
          row.map((cell) => ({
            text: cell,
            options: { fontSize: 11, color: TEXT_DARK, fill: { color: CARD_BG } },
          })),
        ),
      ];

      slide.addTable(tableRows, {
        x: 0.8,
        y: 1.8,
        w: 11.5,
        h: 4.8,
        border: { pt: 1, color: 'CBD5E1' },
      });
    }

    // Slide Footer — company and contact number on every slide.
    slide.addText(
      `${BRAND.companyName}  ·  ${BRAND.phones.join(' / ')}  ·  ${meta.organization}`,
      {
        x: 0.8,
        y: 7.0,
        w: 11.7,
        h: 0.3,
        fontSize: 9,
        color: TEXT_MUTED,
        fontFace: 'Helvetica',
      },
    );
  }

  // --- Closing slide -------------------------------------------------------
  // A deck that ends on a findings table leaves the reader with nothing to do.
  const closing = pptx.addSlide();
  closing.background = { color: NAVY };
  closing.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.15, fill: { color: GOLD } });
  stampLogo(closing, 'cover');

  closing.addText('Next steps', {
    x: 0.8,
    y: logo ? 2.0 : 1.5,
    w: 11,
    h: 0.8,
    fontSize: 30,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Helvetica',
  });

  closing.addText(
    'We would welcome a short conversation about the observations in this document ' +
      'and which of them are worth acting on first.',
    {
      x: 0.8,
      y: logo ? 2.85 : 2.35,
      w: 10.5,
      h: 0.8,
      fontSize: 15,
      color: 'CBD5E1',
      fontFace: 'Helvetica',
    },
  );

  closing.addText(
    contactLines().map((line, i) => ({
      text: line,
      options: {
        fontSize: i === 0 ? 18 : 14,
        bold: i === 0,
        color: i === 0 ? GOLD : 'FFFFFF',
        breakLine: true,
      },
    })),
    { x: 0.8, y: 4.1, w: 11, h: 2.2, fontFace: 'Helvetica', valign: 'top' },
  );

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}
