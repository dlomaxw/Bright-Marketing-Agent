import { describe, expect, it } from 'vitest';
import {
  hasUnreadableCharacters,
  parseUmaDirectory,
  repairLigatures,
} from '../src/server/leads/uma-directory';

/**
 * The UMA directory is the product's real starting dataset, so the parser is
 * load-bearing. These fixtures are trimmed from the actual extracted text,
 * including its font-encoding damage.
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
    expect(repairLigatures('smarƞoodsuganda')).toBe('smartfoodsuganda');
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
LAKESIDE DAIRY LTD
Plot 4-8, Ntengye close road Mbarara
P.O.Box: 1341, Mbarara
Tel: +256 756 111 199, +256 (75)6 - 807872
WhatsApp: +256 (75)6 - 807872
Email: sriharireddy@lakesidedairy.net
Contact Person: Mr. Srihari Reddy
Designation: General Manager OperaƟons
Website: www.lakesidedairy.net
Products/Services: CollecƟon, processing of milk & milk products
Brands: Dairy Top
_______________	______________________________
REACH US TOLL-FREE AT
Tel: +256 800 100 200
Email: help@example.com
_______________	______________________________
PONDERS LIMITED
Plot 10-12, Mulwana Road, Industrial area
P.O.Box: 40425, Kampala Tel: +256 (414) - 255253
Email: snowmans@live.com
Contact Person: Mr. Adim Kamil
Designation: Managing Director
Products/Services: Ice cream, yoghurt
_______________	______________________________
BRANDS WE DISTRIBUTE
Tel: +256 700 000 000
_______________	______________________________
SMART FOODS LIMITED
P.O. Box: 5568, Kampala
Tel: +256 702 285608
Email: marƟn@smarƞoodsuganda.com
Contact Person: Mr. MarƟn Ssali
Website: www.smarƞoodsuganda.com
Products/Services: non dairy yoghurts
_______________	______________________________

-- 50 of 272 --
`;

describe('directory parsing', () => {
  const entries = parseUmaDirectory(SAMPLE);
  const byName = (needle: string) => entries.find((e) => e.name.includes(needle));

  it('extracts member companies', () => {
    expect(byName('LAKESIDE DAIRY')).toBeDefined();
    expect(byName('PONDERS')).toBeDefined();
    expect(byName('SMART FOODS')).toBeDefined();
  });

  it('rejects advertisement headlines that are also set in capitals', () => {
    expect(byName('REACH US')).toBeUndefined();
    expect(byName('BRANDS WE DISTRIBUTE')).toBeUndefined();
  });

  it('captures the published fields', () => {
    const lakeside = byName('LAKESIDE DAIRY')!;
    // normalizeUrl serialises a bare host with a trailing slash.
    expect(lakeside.website).toBe('https://www.lakesidedairy.net/');
    expect(lakeside.emails).toContain('sriharireddy@lakesidedairy.net');
    expect(lakeside.contactPerson).toBe('Mr. Srihari Reddy');
    // Ligatures repaired inside field values, not just the name.
    expect(lakeside.designation).toBe('General Manager Operations');
    expect(lakeside.productsServices).toContain('Collection');
    expect(lakeside.phones.length).toBeGreaterThan(0);
    expect(lakeside.poBox).toContain('1341');
  });

  it('repairs addresses that were damaged by the source encoding', () => {
    const smart = byName('SMART FOODS')!;
    expect(smart.emails).toContain('martin@smartfoodsuganda.com');
    expect(smart.website).toBe('https://www.smartfoodsuganda.com/');
    expect(smart.unreadableEmails).toEqual([]);
  });

  it('records the page each entry came from, for provenance', () => {
    expect(byName('LAKESIDE DAIRY')!.page).toBe(50);
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
