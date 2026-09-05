import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

const buffer = fs.readFileSync('docs/UMA-Dirrectory-2026.pdf');
const parser = new PDFParse({ data: new Uint8Array(buffer) });
const result = await parser.getText();
await parser.destroy();

console.log('pages:', result.pages?.length ?? 'n/a', 'chars:', result.text.length);
fs.writeFileSync('docs/uma-extracted.txt', result.text);
console.log('---- SAMPLE ----');
console.log(result.text.slice(0, 3000));
