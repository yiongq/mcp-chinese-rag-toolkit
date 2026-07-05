#!/usr/bin/env node
// Generates test/fixtures/sample-gbk.txt — a plain-text file whose bytes are
// GBK-encoded Chinese. Run once, commit the output. No runtime deps.
//
// Node's TextEncoder only emits UTF-8, so a GBK fixture cannot be produced by
// encoding a JS string. Instead the exact GBK byte sequence is hardcoded here
// (each Chinese character is two bytes) so the document-parser test can prove
// the UTF-8 → GBK decode fallback both detects the encoding AND decodes the
// characters correctly. Decoded content: 中文编码测试，你好世界。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 中(D6D0) 文(CEC4) 编(B1E0) 码(C2EB) 测(B2E2) 试(CAD4) ，(A3AC)
// 你(C4E3) 好(BAC3) 世(CAC0) 界(BDE7) 。(A1A3)
const GBK_BYTES = [
  0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xe0, 0xc2, 0xeb, 0xb2, 0xe2, 0xca, 0xd4, 0xa3, 0xac, 0xc4, 0xe3,
  0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7, 0xa1, 0xa3,
];

const outPath = fileURLToPath(new URL('./sample-gbk.txt', import.meta.url));
writeFileSync(outPath, Buffer.from(GBK_BYTES));
console.log(`wrote ${GBK_BYTES.length} bytes -> ${outPath}`);
