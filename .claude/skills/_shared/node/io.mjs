// 파일·표준입력 입출력 헬퍼. python 의 universal newlines(읽을 때 CRLF→LF)와
// 윈도우 python 의 write_text(CRLF 로 기록) 함정을 없앤다: 읽기는 정규화, 쓰기는 LF 그대로.

import fs from 'node:fs';
import path from 'node:path';
import { pyJsonDumps } from './pyjson.mjs';

/** 앞의 BOM 제거 + `\r\n`·`\r` 을 `\n` 으로 정규화한다. */
export function normalizeText(text, { eol = true } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return eol ? text.replace(/\r\n?/g, '\n') : text;
}

/** UTF-8 로 읽고 BOM 을 제거하며 줄끝을 LF 로 통일한다 (BOM 제거는 python 의 utf-8-sig 와 같다. 일반 utf-8 읽기는 BOM 을 남기므로 이쪽이 의도된 개선이다). */
export function readText(file) {
  return normalizeText(fs.readFileSync(file, 'utf8'));
}

/** UTF-8 로 쓴다. 줄끝 변환 없음(LF 는 LF). mkdirp 이면 부모 폴더를 만든다. */
export function writeText(file, text, { mkdirp = false } = {}) {
  if (mkdirp) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

/**
 * json.dump 와 같은 형식으로 쓴다(기본 indent=2, ensure_ascii=False, 끝 개행 있음).
 * indent=null 이면 python 기본 구분자(`", "`, `": "`).
 */
export function writeJson(file, value, { indent = 2, ensureAscii = false, trailingNewline = true, sortKeys = false, mkdirp = false } = {}) {
  const body = pyJsonDumps(value, { indent, ensureAscii, sortKeys });
  writeText(file, trailingNewline ? body + '\n' : body, { mkdirp });
}

function decodeStdin(chunks, normalizeEol) {
  return normalizeText(Buffer.concat(chunks).toString('utf8'), { eol: normalizeEol });
}

/** 표준입력 전체를 UTF-8 로 읽는다(비동기). BOM 제거, normalizeEol(기본 true)이면 CRLF→LF. */
export async function readStdinText({ normalizeEol = true } = {}) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return decodeStdin(chunks, normalizeEol);
}

/** readStdinText 의 동기판. 파이프·리다이렉트 입력용(대화형 tty 는 EOF 까지 블록된다). */
export function readStdinTextSync({ normalizeEol = true } = {}) {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN') { // 비차단 입력: 잠깐 쉬고 재시도
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      if (e.code === 'EOF') break; // 윈도우에서 닫힌 파이프
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return decodeStdin(chunks, normalizeEol);
}
