// envelope-cases.mjs — wbs-envelope 시험용 입력과 python 인라인 원본(legacy) 문자열.
//
// wbs-envelope.mjs 는 SKILL.md 에 인라인 python 으로 들어 있던 두 코드를 옮긴 것이라 `.py` 파일 원본이 없다.
// 골든 비교 기준이 되는 그 두 코드를 아래 PY_V1·PY_V2 문자열로 그대로 보관한다(경로·값 자리만 토큰으로 바꿈).
//   PY_V1  dflow-export SKILL.md 「3. import 본문 조립」  (project_id + module, indent=2)
//   PY_V2  dflow-wbs-nlevel SKILL.md 「업로드」           (project_id 만, 들여쓰기 없음)
// 이 모듈은 시험(wbs-envelope.test.mjs)과 기대값 생성기(make-expected-envelope.mjs)가 함께 쓴다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCommand, runNode } from '../../_shared/node/proc.mjs';

/** dflow-export/SKILL.md 의 인라인 python (heredoc 본문). __IN__ __OUT__ __UUID__ __MOD__ 는 파이썬 문자열 리터럴로 치환된다. */
export const PY_V1 = `import json
d = json.load(open(__IN__))
d["project_id"] = __UUID__; d["module"] = __MOD__
json.dump(d, open(__OUT__, "w"), ensure_ascii=False, indent=2)
`;

/** dflow-wbs-nlevel/SKILL.md 의 인라인 python. */
export const PY_V2 = `import json; d = json.load(open(__IN__))
d["project_id"] = __UUID__
json.dump(d, open(__OUT__, "w"), ensure_ascii=False)
`;

/** 파이썬 문자열 리터럴(큰따옴표). 비 ASCII 는 그대로 둔다(PYTHONUTF8=1 로 실행). */
export function pyLit(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

export function pyCode(variant, { inFile, outFile, uuid, mod }) {
  const tpl = variant === 'v1' ? PY_V1 : PY_V2;
  return tpl
    .replace('__IN__', () => pyLit(inFile))
    .replace('__OUT__', () => pyLit(outFile))
    .replace('__UUID__', () => pyLit(uuid))
    .replace('__MOD__', () => pyLit(mod ?? ''));
}

/** variant 별 node CLI 인자(입출력 경로 제외). */
export function nodeSets(variant, { uuid, mod }) {
  return variant === 'v1'
    ? ['--set', `project_id=${uuid}`, '--set', `module=${mod}`, '--indent', '2']
    : ['--set', `project_id=${uuid}`];
}

const UUID = '3f2b8c1e-5a7d-4e90-9b21-0c6d4a8e1f77';

/**
 * 합성 경계 입력. 각 항목: { id, input: string|Buffer|null(파일 없음), uuid?, mod?, out?: 'file'|'nodir'|'dir' }
 * 같은 입력을 두 variant(v1, v2)로 모두 돌린다.
 */
export function syntheticCases() {
  const j = (s) => s;
  const c = [];
  const add = (id, input, extra = {}) => c.push({ id, input, uuid: UUID, mod: 'MDM', out: 'file', ...extra });

  add('빈 객체', j('{}'));
  add('빈 객체 + 공백 개행', j(' \n{\n}\n\n'));
  add('이미 project_id 가 있는 봉투', j('{"schema_version":"2.1","project_id":"OLD","nodes":[],"module":"OLDMOD","z":1}'));
  add('project_id 만 있고 module 은 새로', j('{"a":1,"project_id":"OLD","b":2}'));
  add('실제 모양 봉투(작은)', j('{"schema_version": "2.1", "source": "docs/x/wbs.md", "nodes": [{"id": "WP-01", "title": "제목", "parent": null, "stage": null, "order": 1, "spec": {"a": [], "b": {}}}]}'));
  add('한글·이모지', j('{"제목":"한글 😀 é 𝒳 \\ud83d\\ude00","😀":"키","\\u00e9":"\\u0000\\u001f\\u007f\\u0080\\u2028\\u2029\\ufeff"}'));
  add('이스케이프', j('{"s":"\\"\\\\\\/\\b\\f\\n\\r\\t","t":"\\u0041\\u00e9\\u4e2d"}'));
  add('큰 정수', j('{"a":12345678901234567890123,"b":9007199254740993,"c":-9007199254740993,"d":9007199254740991,"e":-0,"f":0,"g":[123456789012345678901234567890]}'));
  add('float 표기', j('{"a":1.0,"b":1e5,"c":-0.0,"d":1E400,"e":0.1,"f":1e-7,"g":123456789.123456789,"h":1e16,"i":NaN,"j":Infinity,"k":-Infinity,"l":2.50,"m":1E+2,"n":5e-324,"o":1.7976931348623157e308,"p":[1.0,2,3.5]}'));
  add('정수형 문자열 키', j('{"10":1,"2":2,"1":{"b":1,"3":2,"a":3,"-1":4,"01":5,"4294967295":6},"x":3,"0":0}'));
  add('project_id 가 정수형 키 사이에 있음', j('{"10":1,"project_id":"x","2":2}'));
  add('빈 컨테이너 중첩', j('{"a":[],"b":{},"c":[[],{}],"d":[{"x":[]}],"e":[[[]]]}'));
  add('중복 키', j('{"a":1,"b":2,"a":3,"project_id":"p","c":4,"project_id":"q"}'));
  add('CRLF·탭 들여쓴 입력', j('{\r\n\t"a": 1,\r\n\t"b": [1,\r\n 2]\r\n}\r\n'));
  add('값에 = 가 있는 module', j('{"a":1}'), { mod: 'a=b=c' });
  add('값이 빈 문자열 module', j('{"a":1}'), { mod: '' });
  add('한글·이모지 module', j('{"a":1}'), { mod: '한글😀모듈' });
  add('따옴표·역슬래시 module', j('{"a":1}'), { mod: 'q"uo\\te\'s' });
  add('깊은 중첩', j(`{"a":${'['.repeat(40)}1${']'.repeat(40)},"b":${'{"k":'.repeat(30)}null${'}'.repeat(30)}}`));
  add('큰 배열', j(`{"nodes":[${Array.from({ length: 300 }, (_, i) => `{"id":"T-${i}","order":${i},"w":${i}.5}`).join(',')}]}`));

  // 오류 입력(두 판 모두 종료 코드 1)
  add('오류: 깨진 JSON(값 없음)', j('{"a":'), { error: true });
  add('오류: 깨진 JSON(닫는 괄호 없음)', j('{"a":1'), { error: true });
  add('오류: 따옴표 없는 키', j('{a:1}'), { error: true });
  add('오류: 쉼표 뒤 닫는 괄호', j('{"a":1,}'), { error: true });
  add('오류: 뒤에 쓰레기', j('{} x'), { error: true });
  add('오류: 빈 파일', j(''), { error: true });
  add('오류: 공백만', j(' \n '), { error: true });
  add('오류: BOM 으로 시작', j('﻿{"a":1}'), { error: true });
  add('오류: 최상위 배열', j('[1,2]'), { error: true });
  add('오류: 최상위 문자열', j('"x"'), { error: true });
  add('오류: 최상위 null', j('null'), { error: true });
  add('오류: 최상위 숫자', j('1'), { error: true });
  add('오류: 잘못된 UTF-8', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d]), { error: true });
  add('오류: 입력 파일 없음', null, { error: true });
  add('오류: 출력 폴더 없음', j('{"a":1}'), { error: true, out: 'nodir' });
  add('오류: 출력 경로가 폴더', j('{"a":1}'), { error: true, out: 'dir' });
  // python 은 출력 파일을 먼저 만들고 쓰다 UnicodeEncodeError 로 끝낸다. node 는 파일을 만들지 않는다(둘 다 종료 코드 1).
  add('오류: 짝 없는 서로게이트', j('{"s":"\\ud800"}'), { error: true, loneSurrogate: true });
  add('오류: 짝 없는 서로게이트(낮은 쪽)', j('{"s":"x\\udc00y"}'), { error: true, loneSurrogate: true });
  return c;
}

export const VARIANTS = ['v1', 'v2'];

/**
 * 케이스 한 건을 `dir` 안에 준비한다: in.json 을 쓰고(input 이 null 이면 안 씀) 출력 경로를 정한다.
 * out: 'file' → dir/out.json, 'nodir' → dir/없는폴더/out.json(폴더를 만들지 않음), 'dir' → dir/out.json 이 이미 폴더.
 */
export function prepare(c, dir) {
  const inFile = path.join(dir, 'in.json');
  if (c.input !== null) fs.writeFileSync(inFile, c.input);
  let outFile = path.join(dir, 'out.json');
  if (c.out === 'nodir') outFile = path.join(dir, 'missing-dir', 'out.json');
  if (c.out === 'dir') fs.mkdirSync(outFile);
  return { inFile, outFile };
}

/** python 인라인 원본을 그대로 실행한다. pythonCmd 는 findPython() 결과. */
export function runLegacy(pythonCmd, variant, c, dir) {
  const { inFile, outFile } = prepare(c, dir);
  const code = pyCode(variant, { inFile, outFile, uuid: c.uuid, mod: c.mod });
  const r = runCommand(pythonCmd, ['-B', '-c', code], {
    cwd: dir,
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
  });
  return { ...r, outFile };
}

/** node 판을 실행한다. */
export function runEnvelope(script, variant, c, dir) {
  const { inFile, outFile } = prepare(c, dir);
  const r = runNode(script, ['--in', inFile, '--out', outFile, ...nodeSets(variant, c)], { cwd: dir });
  return { ...r, outFile };
}

/** 출력 파일 바이트(없으면 null). */
export function readOut(outFile) {
  try {
    return fs.statSync(outFile).isFile() ? fs.readFileSync(outFile) : null;
  } catch {
    return null;
  }
}

/**
 * nlevel export 샘플(동결 입력 문서를 wbs-nlevel-parse.mjs export 로 변환한 결과) 3종.
 *  - skeleton-sample.md(골격, tests/golden/inputs 의 동결 문서)
 *  - PL_MD + 골격 SKEL_MIN(attach_ref 조립, nlevel-cases.mjs 의 시험 문서)
 *  - SKEL_MIN 단독(골격 모드)
 * contract-sample.md 는 검증 오류(미선언 접두어 등)가 있는 문서라 export 가 막혀 쓰지 않는다.
 * @param {string} work 문서를 쓸 임시 폴더(이미 있어야 함)
 * @returns {Promise<Array<{id:string,input:string,uuid:string,mod:string,out:string}>>}
 */
export async function nlevelInputs(work) {
  const nl = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dflow-wbs-nlevel');
  const script = path.join(nl, 'scripts', 'wbs-nlevel-parse.mjs');
  const { PL_MD, SKEL_MIN } = await import(pathToFileURL(path.join(nl, 'tests', 'nlevel-cases.mjs')).href);
  const inputsDir = path.join(nl, 'tests', 'golden', 'inputs');
  fs.writeFileSync(path.join(work, 'pl.md'), PL_MD, 'utf8');
  fs.writeFileSync(path.join(work, 'skel-min.md'), SKEL_MIN, 'utf8');
  const runs = [
    ['nlevel skeleton-sample export', ['export', '--wbs', path.join(inputsDir, 'skeleton-sample.md')]],
    ['nlevel PL_MD + skeleton(attach_ref)', ['export', '--wbs', path.join(work, 'pl.md'), '--skeleton', path.join(work, 'skel-min.md')]],
    ['nlevel SKEL_MIN 골격', ['export', '--wbs', path.join(work, 'skel-min.md')]],
  ];
  const out = [];
  for (const [id, args] of runs) {
    const r = runNode(script, args, { cwd: work });
    if (r.status !== 0) throw new Error(`${id}: wbs-nlevel-parse export 실패 (${r.status}) ${r.stderr}`);
    out.push({ id, input: r.stdout, uuid: UUID, mod: 'MOD-1', out: 'file' });
  }
  return out;
}
