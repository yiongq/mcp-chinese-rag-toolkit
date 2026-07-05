#!/usr/bin/env node
// Generates test/fixtures/sample.docx — a minimal, valid Word document with two
// heading levels plus body text. Run once, commit the output.
//
// Used by the document-parser unit test as a self-contained fixture so the
// toolkit's tests run from a standalone clone. The document is a plain OOXML
// package (a ZIP of XML parts); the paragraph styles `Heading1` / `Heading2`
// are what mammoth maps to Markdown `#` / `##`, letting the parsed text feed
// the heading-aware chunker.
//
// The ZIP writer (jszip) is resolved through the docx parser package that is
// already a dependency, so this script needs no extra install of its own.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const JSZip = createRequire(require.resolve('mammoth'))('jszip');

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function paragraph(text, style) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${paragraph('产品使用指南', 'Heading1')}
${paragraph('本文档用于验证多格式解析：Word 文档会被转换成保留标题结构的文本。', null)}
${paragraph('安装步骤', 'Heading2')}
${paragraph('第一步下载安装包，第二步运行安装向导，第三步完成初始化配置。', null)}
</w:body>
</w:document>`;

const zip = new JSZip();
zip.file('[Content_Types].xml', CONTENT_TYPES);
zip.folder('_rels').file('.rels', RELS);
zip.folder('word').file('document.xml', DOCUMENT);

const out = await zip.generateAsync({ type: 'nodebuffer' });
const outPath = fileURLToPath(new URL('./sample.docx', import.meta.url));
writeFileSync(outPath, out);
console.log(`wrote ${out.length} bytes -> ${outPath}`);
