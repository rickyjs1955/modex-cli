# Test fixtures

These files are committed binaries used by the source-loader tests. They were
generated programmatically (not downloaded), so they carry no third-party
license and can be regenerated deterministically.

## `sample.pdf`

A minimal single-page PDF-1.4 containing the text `Hello PDF world`,
hand-assembled (catalog → pages → page → content stream → font) with a manual
xref table. Used by `sources.pdf.test.ts`.

Regenerate:

```js
import { writeFileSync } from 'node:fs';
const stream = 'BT /F1 24 Tf 100 700 Td (Hello PDF world) Tj ET';
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync('test/fixtures/sample.pdf', pdf, 'binary');
```

## `sample.epub`

A minimal EPUB 2 (ZIP) with two XHTML chapters, a `content.opf` manifest/spine,
and a `toc.ncx`. The `mimetype` entry is stored uncompressed and first, per the
EPUB spec. Used by `sources.epub.test.ts`.

Regenerate (requires the `zip` CLI): build a directory with `mimetype`,
`META-INF/container.xml`, `OEBPS/content.opf`, `OEBPS/toc.ncx`, and
`OEBPS/ch1.xhtml` + `OEBPS/ch2.xhtml`, then:

```sh
zip -X0 sample.epub mimetype          # store mimetype uncompressed, first
zip -Xr9 sample.epub META-INF OEBPS   # add the rest, deflated
```

Chapter 1 contains "slow down before responding"; chapter 2 contains
"ask the five whys" — the test asserts both survive extraction.
