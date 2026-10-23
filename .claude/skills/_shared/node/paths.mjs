// 경로 헬퍼. 경로 조작은 node:path 로 하고, 비교·출력용 문자열만 toPosix 로 통일한다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareCodePoint } from './pytext.mjs';

/** 역슬래시를 슬래시로 바꾼다(윈도우 경로를 비교·출력용으로 통일). */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

/** startDir 에서 위로 올라가며 name 파일·폴더를 찾아 전체 경로를 돌려준다(없으면 null). */
export function findUp(startDir, name) {
  let dir = path.resolve(startDir);
  for (;;) {
    const cand = path.join(dir, name);
    if (fs.existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `.git` 폴더 또는 파일(워크트리)이 있는 가장 가까운 상위 폴더. 없으면 null. */
export function repoRootFrom(startDir) {
  const g = findUp(startDir, '.git');
  return g === null ? null : path.dirname(g);
}

/** `~`, `~/x`, `~\x` 를 홈 폴더로 펼친다. */
export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * root 아래를 재귀 열거해 항상 같은 순서로 돌려준다. python `sorted(Path.rglob('*'))` 대응.
 *  - order 'path'(기본): python Path 비교와 같게 "경로 성분별" 코드포인트 순. 폴더 안은 폴더 바로 뒤에 나온다
 *    (`a/b` 가 `a-c` 보다 앞). 'string': 루트 기준 상대 경로 문자열(슬래시)을 통째로 코드포인트 순 비교
 *    (python `sorted(str(p) …)` 대응, `a-c` 가 `a/b` 보다 앞).
 *  - localeCompare 는 쓰지 않는다. 윈도우 python 은 Path 비교가 대소문자 무시지만 여기는 항상 대소문자 구분.
 * @param {string} root
 * @param {{skipDirs?: string[]|((name:string, full:string)=>boolean), extensions?: string[]|null,
 *          followSymlinks?: boolean, includeDirs?: boolean, order?: 'path'|'string', skipUnreadable?: boolean}} [opts]
 *   skipDirs: 들어가지 않을 폴더 이름(기본 없음), extensions: ['.md'] 처럼 마지막 확장자 일치(대소문자 구분),
 *   followSymlinks: 폴더 심볼릭 링크를 따라 들어갈지(기본 false, 순환은 realpath 로 차단),
 *   includeDirs: 폴더도 결과에 포함(기본 false, 파일만),
 *   skipUnreadable: 권한이 없어 못 여는 폴더(EACCES·EPERM)를 건너뜀(기본 false = 예외 전파. python rglob 은 건너뛴다).
 * @returns {string[]} path.join(root, 상대경로) 형태의 경로
 */
export function walkSorted(root, { skipDirs = [], extensions = null, followSymlinks = false, includeDirs = false, order = 'path', skipUnreadable = false } = {}) {
  const skip = typeof skipDirs === 'function' ? skipDirs : (n) => skipDirs.includes(n);
  const exts = extensions ? new Set(extensions) : null;
  const out = [];
  const seen = new Set();

  const visit = (dir, rel) => {
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (seen.has(real)) return; // 심볼릭 순환 방지
    seen.add(real);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (skipUnreadable && (err.code === 'EACCES' || err.code === 'EPERM')) return;
      throw err;
    }
    entries.sort((a, b) => compareCodePoint(a.name, b.name));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        let st = null;
        try { st = fs.statSync(full); } catch { /* 끊어진 링크는 건너뜀 */ }
        if (!st) continue;
        if (st.isDirectory()) {
          // python rglob 처럼 심링크 폴더 자체는 목록에 넣되, followSymlinks 가 아니면 안으로 들어가지 않는다
          if (!followSymlinks) { if (includeDirs && !skip(e.name, full)) out.push({ full, rel: relPath }); continue; }
          isDir = true;
        }
        else isFile = st.isFile();
      }
      if (isDir) {
        if (skip(e.name, full)) continue;
        if (includeDirs) out.push({ full, rel: relPath });
        visit(full, relPath);
      } else if (isFile) {
        if (exts && !exts.has(path.extname(e.name))) continue;
        out.push({ full, rel: relPath });
      }
    }
    seen.delete(real);
  };
  visit(root, '');
  if (order === 'string') out.sort((a, b) => compareCodePoint(a.rel, b.rel));
  return out.map((x) => x.full);
}
