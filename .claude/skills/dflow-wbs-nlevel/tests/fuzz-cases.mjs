// fuzz-cases.mjs — 시드 고정 무작위 입력(골든 비교용). 같은 시드는 언제나 같은 문서를 만든다.
//  - randomLineDocs: 헤딩·체크 항목·필드·주석·펜스·CRLF·BOM 을 무작위로 섞은 문서(대부분 검증 오류 → 오류 경로 비교)
//  - treeDocs: 검증을 통과하는 트리(WP·Task·STK·토큰·depends·날짜 파생) → export 본문까지 비교
// 명령은 문서마다 validate 1 + export 2(attach-ref, 재실행). 시험이 python legacy 와 node 판의 출력을 직접 비교한다.

import { LEVELS7, CREDITS } from './nlevel-cases.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function cases(prefix, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const rel = `docs/${prefix}${k}.md`;
    out.push({ id: `${prefix}${k} | validate`, args: ['validate', '--wbs', rel] });
    out.push({ id: `${prefix}${k} | export`, args: ['export', '--wbs', rel, '--attach-ref', 'a/b'] });
    out.push({ id: `${prefix}${k} | export again`, args: ['export', '--wbs', rel, '--attach-ref', 'a/b'] });
  }
  return out;
}

export function randomLineDocs(seed, count) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const pref = ['PH', 'SYS', 'SUB', 'WP', 'ACT', 'TSK', 'STK', 'ZZ'];
  const toks = ['', '  @홍길동', '  @a b', '  w:3', '  w:2.5', '  w:1.2.3', '  w:0', '  ~2026-11-14', '  ~2026-02-30', '  ~2026-12-31',
    '  2026-11-01~2026-11-20', '  credit:if', '  credit:zzz', '  if-id:IF-1', '  30%', '  ~2026-11-14 ~2026-12-01', ' w:５'];
  const fields = ['category: dev', 'domain: backend', 'priority: high', 'tags: a, b', 'depends: ID-X', 'requirements: 요건', 'acceptance: a / b',
    'prd-ref: x', 'entry-point: y', 'model: m', 'foo: bar', 'category:', 'Tags: x'];
  const ids = [];
  const mkId = () => `${pick(pref)}-${pick(['OP', 'A', 'B', '한글'])}-${Math.floor(R() * 4)}`;
  const line = () => {
    const r = R();
    if (r < 0.18) { const i = mkId(); ids.push(i); return `${'#'.repeat(2 + Math.floor(R() * 3))} ${i}: 제목${pick(toks)}`; }
    if (r < 0.5) { const i = mkId(); ids.push(i); return `${' '.repeat(pick([0, 0, 2, 2, 4, 1]))}- [${pick([' ', ' ', ' ', 'x', 'M'])}] ${i}: 항목${pick(toks)}`; }
    if (r < 0.62) return `${' '.repeat(pick([2, 2, 4]))}- ${pick(fields).replace('ID-X', ids.length ? pick(ids) : 'ID-X')}`;
    if (r < 0.66) return '<!-- 주석 -->';
    if (r < 0.68) return '<!--';
    if (r < 0.70) return '-->';
    if (r < 0.73) return '';
    if (r < 0.76) return '```';
    if (r < 0.79) return `- [ ] ID 없는 항목${pick(toks)}`;
    if (r < 0.81) return '# 문서 제목';
    return `메모 ${pick(['텍스트', '- 아님', '\t- [ ] TSK-A-0: 탭'])}`;
  };
  const front = () => {
    let f = '---\n';
    f += pick(['module: m\n', '', 'module:\n']);
    f += pick(['attach: PH-03/SYS-OP\n', 'attach: PH-03/SUB-OP\n', '', 'attach:\n']);
    f += pick(['start_date: 2026-09-01\n', '', 'start-date: 2026-08-31\n']);
    f += pick([LEVELS7, LEVELS7, 'levels:\n  - { name: A, prefix: WP, progress: rollup }\n  - { name: B, prefix: TSK, progress: input }\n', '']);
    f += pick([CREDITS, '', 'credits: x\n']);
    return `${f}---\n`;
  };
  const files = {};
  for (let k = 0; k < count; k++) {
    ids.length = 0;
    const lines = [];
    const len = 3 + Math.floor(R() * 25);
    for (let i = 0; i < len; i++) lines.push(line());
    let text = front() + lines.join('\n') + pick(['\n', '', '\n\n']);
    if (R() < 0.15) text = text.replace(/\n/g, '\r\n');
    if (R() < 0.05) text = `﻿${text}`;
    files[`docs/rl${k}.md`] = text;
  }
  return { files, cases: cases('rl', count) };
}

export function treeDocs(seed, count) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const dates = ['2026-09-04', '2026-09-05', '2026-09-07', '2026-10-31', '2026-12-31', '2028-02-29', '2027-01-01', '2026-11-14'];
  const D = () => pick(dates);
  const files = {};
  for (let k = 0; k < count; k++) {
    const tasks = [];
    const out = ['---', 'module: mes-op', 'attach: PH-03/SYS-OP', pick(['start_date: 2026-09-01', 'start-date: 2026-09-03', '']),
      LEVELS7.trimEnd(), CREDITS.trimEnd(), '---', '', '## SUB-OP-1: 입측'];
    const nWp = 1 + Math.floor(R() * 4);
    for (let w = 0; w < nWp; w++) {
      out.push(`### WP-OP-${w}: 묶음 ${w}`);
      if (R() < 0.4) out.push(`#### ACT-OP-${w}: 액티비티`);
      const nt = Math.floor(R() * 5);
      for (let t = 0; t < nt; t++) {
        const id = `TSK-OP-${w}-${t}`;
        tasks.push(id);
        const tk = [pick(['', '', ' @담당자', ' @a']), pick(['', '  w:1', '  w:2.5', '  w:3', '  w:0.1', '  w:10']),
          pick(['', `  ~${D()}`, `  ~${D()}`, `  ${D()}~${D()}`]), pick(['', '', '  credit:if', '  credit:default', '  credit:nope']),
          pick(['', '', `  if-id:IF-${t}`])].join('');
        out.push(`- [${R() < 0.1 ? 'M' : ' '}] ${id}: 작업 ${w}-${t}${tk}`);
        if (R() < 0.5) out.push(`  - depends: ${tasks.length > 1 && R() < 0.8 ? pick(tasks) : 'TSK-NOPE'}${R() < 0.3 ? `, ${pick(tasks)}` : ''}`);
        if (R() < 0.4) out.push(`  - category: ${pick(['dev', 'defect', 'infra'])}`);
        if (R() < 0.3) out.push(`  - tags: ${pick(['a, b', 'x', '', 'p,q ,r'])}`);
        if (R() < 0.3) out.push(`  - acceptance: ${pick(['가 / 나', '하나', ' / '])}`);
        if (R() < 0.3) out.push(`  - requirements: ${pick(['요건 한 줄', '"인용"', '\\ 역슬래시'])}`);
        const ns = Math.floor(R() * 3);
        for (let s = 0; s < ns; s++) out.push(`  - [${R() < 0.5 ? 'x' : ' '}] STK-OP-${w}-${t}-${s}: 점검 ${s}`);
      }
    }
    let text = `${out.join('\n')}\n`;
    if (R() < 0.1) text = text.replace(/\n/g, '\r\n');
    files[`docs/tr${k}.md`] = text;
  }
  return { files, cases: cases('tr', count) };
}
