import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readText, writeText, readJson, writeJson, normalizeText } from '../io.mjs';
import { makeTempDir, runNode } from '../proc.mjs';

const tmp = makeTempDir('dmes-io-test-');
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('readText: BOM 제거와 CRLF·CR 정규화', () => {
  const f = path.join(tmp, 'a.txt');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('가\r\n나\r다\n라', 'utf8')]));
  assert.equal(readText(f), '가\n나\n다\n라');
  assert.equal(normalizeText('﻿x\r\ny'), 'x\ny');
  assert.equal(normalizeText('x\r\ny', { eol: false }), 'x\r\ny');
});

test('writeText: LF 그대로, mkdirp 옵션', () => {
  const f = path.join(tmp, 'deep', 'x', 'b.txt');
  assert.throws(() => writeText(f, 'a'));
  writeText(f, 'a\nb\n', { mkdirp: true });
  assert.equal(fs.readFileSync(f).toString('latin1'), 'a\nb\n');
});

test('writeJson/readJson: 기본 indent 2, 한글 그대로, 끝 개행', () => {
  const f = path.join(tmp, 'c.json');
  writeJson(f, { 이름: '가', list: [], o: {}, n: [1, 2] });
  assert.equal(fs.readFileSync(f, 'utf8'), '{\n  "이름": "가",\n  "list": [],\n  "o": {},\n  "n": [\n    1,\n    2\n  ]\n}\n');
  assert.deepEqual(readJson(f), { 이름: '가', list: [], o: {}, n: [1, 2] });
  writeJson(f, { a: '가' }, { indent: null, ensureAscii: true, trailingNewline: false });
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a": "\\uac00"}');
});

test('readStdinText / readStdinTextSync: CRLF 정규화와 옵션', () => {
  const lib = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'io.mjs')).href;
  const s1 = path.join(tmp, 's1.mjs');
  fs.writeFileSync(s1, `import { readStdinText, readStdinTextSync } from ${JSON.stringify(lib)};
const mode = process.argv[2];
const v = mode === 'sync' ? readStdinTextSync({ normalizeEol: process.argv[3] !== 'raw' }) : await readStdinText({ normalizeEol: process.argv[3] !== 'raw' });
process.stdout.write(JSON.stringify(v));`);
  const input = '﻿가\r\n나\r\n';
  for (const mode of ['async', 'sync']) {
    assert.equal(JSON.parse(runNode(s1, [mode], { input }).stdout), '가\n나\n');
    assert.equal(JSON.parse(runNode(s1, [mode, 'raw'], { input }).stdout), '가\r\n나\r\n');
  }
});
