import { describe, expect, it } from 'vitest';
import {
  hasUnreadableCharacters,
  parseUmaDirectory,
  repairLigatures,
} from '../src/server/leads/uma-directory';

/**
 * The UMA directory is the product's real starting dataset, so the parser is
 * load-bearing. These fixtures reproduce the exact font-encoding damage the PDF
 * extraction produces, but the companies, people, addresses and contact details
 * are fictional: this repository is public, and the directory lists named
 * individuals at real businesses. The damage is what is under test, not them.
 */

describe('ligature repair', () => {
  it('restores the mangled ligatures the PDF extraction produces', () => {
    expect(repairLigatures('operaƟons')).toBe('operations');
    expect(repairLigatures('BuƩer')).toBe('Butter');
    expect(repairLigatures('Įsh')).toBe('fish');
    expect(repairLigatures('coīee')).toBe('coffee');
    expect(repairLigatures('liŌ')).toBe('lift');
    expect(repairLigatures('cuƫngs')).toBe('cuttings');
    expect(repairLigatures('Ňavors')).toBe('flavors');
    expect(repairLigatures('oĸce')).toBe('office');
    expect(repairLigatures('brighƞoodsuganda')).toBe('brightfoodsuganda');
    expect(repairLigatures('hotloaĩakery')).toBe('hotloafbakery');
  });

  it('normalises typographic punctuation', () => {
    expect(repairLigatures('Uganda’s')).toBe("Uganda's");
    expect(repairLigatures('2024–2026')).toBe('2024-2026');
  });
});

describe('unreadable detection', () => {
  it('flags values that still contain unresolved characters', () => {
    expect(hasUnreadableCharacters('info@example.com')).toBe(false);
    expect(hasUnreadableCharacters('marƟn@example.com')).toBe(true);
  });
});

const SAMPLE = `
NORTHFIELD DAIRY LTD
Plot 1-2, Example Road, Mbarara
P.O.Box: 1341, Mbarara
Tel: +256 700 000 001, +256 (70)0 - 000002
WhatsApp: +256 (70)0 - 000002
Email: manager@northfielddairy.example
Contact Person: Ms. Amina Nakato
Designation: General Manager OperaƟons
Website: www.northfielddairy.example
Products/Services: CollecƟon, processing of milk & milk products
Brands: Example Brand
_______________	______________________________
REACH US TOLL-FREE AT
Tel: +256 800 100 200
Email: help@example.com
_______________	______________________________
RIVERBEND LIMITED
Plot 3-4, Example Road, Industrial area
P.O.Box: 40425, Kampala Tel: +256 (700) - 000004
Email: sales@riverbend.example
Contact Person: Mr. Peter Okello
Designation: Managing Director
Products/Services: Ice cream, yoghurt
_______________	______________________________
BRANDS WE DISTRIBUTE
Tel: +256 700 000 000
_______________	______________________________
BRIGHT FOODS LIMITED
P.O. Box: 5568, Kampala
Tel: +256 700 000 003
Email: marƟn@brighƞoodsuganda.com
Contact Person: Mr. MarƟn Example
Website: www.brighƞoodsuganda.com
Products/Services: non dairy yoghurts
_______________	______________________________

-- 50 of 272 --
`;

describe('directory parsing', () => {
  const entries = parseUmaDirectory(SAMPLE);
  const byName = (needle: string) => entries.find((e) => e.name.includes(needle));

  it('extracts member companies', () => {
    expect(byName('NORTHFIELD DAIRY')).toBeDefined();
    expect(byName('RIVERBEND')).toBeDefined();
    expect(byName('BRIGHT FOODS')).toBeDefined();
  });

  it('rejects advertisement headlines that are also set in capitals', () => {
    expect(byName('REACH US')).toBeUndefined();
    expect(byName('BRANDS WE DISTRIBUTE')).toBeUndefined();
  });

  it('captures the published fields', () => {
    const lakeside = byName('NORTHFIELD DAIRY')!;
    // normalizeUrl serialises a bare host with a trailing slash.
    expect(lakeside.website).toBe('https://www.northfielddairy.example/');
    expect(lakeside.emails).toContain('manager@northfielddairy.example');
    expect(lakeside.contactPerson).toBe('Ms. Amina Nakato');
    // Ligatures repaired inside field values, not just the name.
    expect(lakeside.designation).toBe('General Manager Operations');
    expect(lakeside.productsServices).toContain('Collection');
    expect(lakeside.phones.length).toBeGreaterThan(0);
    expect(lakeside.poBox).toContain('1341');
  });

  it('repairs addresses that were damaged by the source encoding', () => {
    const bright = byName('BRIGHT FOODS')!;
    expect(bright.emails).toContain('martin@brightfoodsuganda.com');
    expect(bright.website).toBe('https://www.brightfoodsuganda.com/');
    expect(bright.unreadableEmails).toEqual([]);
  });

  it('records the page each entry came from, for provenance', () => {
    expect(byName('NORTHFIELD DAIRY')!.page).toBe(50);
  });

  it('never returns an entry with no way to reach the company', () => {
    for (const entry of entries) {
      const reachable =
        entry.phones.length > 0 ||
        entry.emails.length > 0 ||
        entry.website !== null ||
        entry.productsServices !== null;
      expect(reachable, `${entry.name} has no usable detail`).toBe(true);
    }
  });
});

describe('contact safety', () => {
  it('quarantines an email it cannot read rather than importing a broken one', () => {
    // U+0134 is not in the confirmed ligature map, so this must not be guessed.
    const broken = `
ACME PACKAGING LTD
Tel: +256 700 111 222
Email: sales@acmeĴpackaging.com
Products/Services: Packaging
_______________	______________________________
-- 12 of 272 --
`;
    const [entry] = parseUmaDirectory(broken);
    expect(entry).toBeDefined();
    expect(entry!.emails).toEqual([]);
    expect(entry!.unreadableEmails.length).toBe(1);
  });
});
