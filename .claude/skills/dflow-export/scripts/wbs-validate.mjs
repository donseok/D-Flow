#!/usr/bin/env node
// wbs-validate.mjs — WBS Task 품질 검사 (python `wbs-validate.py` 의 node 이식)
//
// 상류 품질 게이트의 두 번째 단계. /wbs가 PRD/TRD에서 WBS를 생성한 뒤,
// 각 Task가 acceptance criteria / depends 완결성 / 도메인 매핑 / 정량 기준을
// 갖췄는지 검사한다. 미흡 Task만 LLM이 재작성하도록 안내하는 정보 제공자다.
//
// 검출 항목 per Task:
//   1. acceptance      acceptance criteria 또는 'success criteria' 비고 누락
//   2. depends_unknown depends에 명시된 TSK-ID가 wbs.md에 존재하지 않음
//   3. test_unmapped   domain이 Dev Config에 매핑되지 않음 (e2e/unit 명령 부재)
//   4. vague_action    "구현/배포/검증" 같은 동사가 정량 기준 없이 사용됨
//   5~8 (import 사전 검사 — D'Flow `/wbs/import` 의 toRpcNode 거부 조건을 미리 잡는다. 2026-10)
//   5. missing_title     Task·WP·ACT 헤딩에 제목이 없음 (import: id·title 필수)
//   6. invalid_priority  priority 가 critical|high|medium|low 가 아님 ('-' 와 빈 값은 미지정)
//   7. invalid_schedule  schedule 이 `YYYY-MM-DD ~ YYYY-MM-DD` 또는 `~ YYYY-MM-DD` 가 아니거나 없는 날짜
//   8. invalid_status    status 가 export 가 아는 표기가 아님 (모르면 stage 가 조용히 null 이 된다)
//
// 서브커맨드:
//   validate --wbs FILE [--dev-config-json STR]   WBS 정합성 검사 → JSON
//
// 사용:
//   node wbs-validate.mjs validate --wbs docs/wbs.md
//   node wbs-validate.mjs validate --wbs docs/wbs.md --dev-config-json '{"domains": {"backend": {}}}'
//
// 종료 코드:
//   0  ok=true (issue 없음)
//   1  ok=false (issue 1개 이상)
//   2  사용 오류
//
// python 판과 다른 점(의도한 차이)
//  - 읽을 때 앞의 BOM 을 지운다(python 은 남겨 두어 BOM 바로 뒤 첫 줄이 Task 헤딩이면 놓친다).
//  - 인자 해석 오류·도움말 문구는 `_shared/node/args.mjs` 의 한국어 문구다(종료 코드 2·0 은 같다). argparse 의
//    긴 옵션 접두 축약(`--w`)은 지원하지 않는다.
//  - 잘못된 UTF-8 은 python 이 UnicodeDecodeError 로 끝내지만 node 는 U+FFFD 로 바꿔 읽는다.
//  - `--dev-config-json` 이 객체가 아닌 JSON(`[]`, `"x"` …)일 때 python 은 traceback(종료 코드 1)이고 node 는 같은 종료 코드 1 에
//    TypeError 문구를 낸다(stderr 문구는 다르다).
// 정규식은 python `re` 의 유니코드 의미를 맞추기 위해 `\s`·`\d`·`\b` 를 직접 정의해 쓴다(_pystr.mjs 참고).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readText } from '../../_shared/node/io.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { pyMatch, splitlinesPy } from '../../_shared/node/pytext.mjs';
import { pyReprStr } from '../../_shared/node/pyrepr.mjs';
import { parseCli, finish, OK, VIOLATION, USAGE } from '../../_shared/node/args.mjs';
import { FENCE_RE, _fenced_ranges, _in_ranges, line_start_offsets } from './_wbs_md.mjs';
import { PY_SPACE_CLASS, pyStrip } from './_pystr.mjs';
import { pyJsonLoads, PyJSONDecodeError } from './_pyjson_loads.mjs';
import { STAGE_CODE } from './_wbs_status.mjs';

export { FENCE_RE };

// python 정규식의 유니코드 의미를 JS(u 플래그)로 옮기는 조각
const S = `[${PY_SPACE_CLASS}]`; // \s
const W = '\\p{L}\\p{N}_'; // \w 의 내용
const B = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`; // \b
const D = '\\p{Nd}'; // \d
const LS = '(?<![^\\n])'; // ^ (re.MULTILINE: 문자열 처음 또는 \n 바로 뒤)
const LE = '(?![^\\n])'; // $ (re.MULTILINE: 문자열 끝 또는 \n 바로 앞)

// Task 헤딩: 3단계 `### TSK-XX-YY:` / 4단계 `#### TSK-XX-YY-ZZ:` 겸용.
// 세그먼트 수를 고정하지 않는다 — ACT 계층이 들어가면 세그먼트가 하나 는다.
export const TASK_HEADING_RE = new RegExp(
  `${LS}(?<level>#{3,5})${S}+(?<id>TSK-${D}+(?:-${D}+)+):${S}*(?<title>[^\\n]*)${LE}`, 'gu');

// 블록 경계 계산용 — 모든 헤딩의 위치와 레벨
export const HEADING_RE = new RegExp(`${LS}(#{1,6})${S}`, 'gu');

export const META_LINE_RE = new RegExp(
  `${LS}-${S}*(?<key>[a-zA-Z][a-zA-Z0-9_-]*)${S}*:${S}*(?<val>[^\\n]*?)${S}*${LE}`, 'gu');

export const ACCEPTANCE_HINT_RE = new RegExp(
  `${LS}${S}*(?:#{2,}${S}+|\\*\\*)?(acceptance(?:${S}*criteria)?|수락${S}*기준|완료${S}*조건|성공${S}*기준)${B}`, 'iu');

export const QUANT_HINT_RE = new RegExp(
  `${B}${D}+${S}*(ms|s|sec|seconds?|minutes?|hours?|%|p${D}+|MB|GB|TB|KB|bytes?|` +
  `req(/s)?|qps|tps|rps|users?|MAU|DAU|건|회|개|초|분|시간)${B}`, 'iu');

export const VAGUE_VERBS = ['구현', '배포', '검증', '정리', '개선', '최적화', 'implement', 'deploy', 'verify'];

/**
 * wbs.md를 Task 블록 리스트로 분리.
 *
 * 블록은 '레벨이 자기 이하인 다음 헤딩' 에서 끝난다. 4단계 WBS 에서 Task 는
 * `####`, 하위 절은 `#####` 이므로 하위 절은 블록 안에 남고 `### ACT-`·`## WP-`
 * 는 블록을 닫는다. 펜스 코드 블록(```` ``` ````) 내부의 `# ...` 줄은 코드 주석일
 * 뿐 헤딩이 아니므로 경계 계산(`headings`)에서는 제외한다.
 *
 * Task 탐지(`matches`)에는 펜스 필터를 적용하지 않는다 — 펜스 페어링은 마커를
 * 위치 순으로 단순히 짝짓기 때문에, 닫는 펜스를 빠뜨린 문서에서 그 뒤에 완결된
 * 펜스 쌍이 하나라도 더 있으면 엉뚱하게 짝지어져 그 사이의 실제 Task 헤딩이
 * 통째로 사라질 수 있다(silent undercount). 펜스 안 예시 텍스트가 우연히
 * `#### TSK-...:` 형태여서 phantom Task 로 잡히는 쪽(눈에 보이는 과다 탐지)이,
 * 실제 Task 가 조용히 사라지는 쪽(과소 탐지 + ok:true)보다 훨씬 안전하다.
 *
 * 같은 이유로 Task 헤딩은 펜스 상태와 무관하게 항상 경계(`headings`) 후보에도
 * 포함한다 — 그러지 않으면 미스페어링된 펜스 안의 '탐지는 됐지만 경계 후보에서는
 * 빠진' Task 헤딩이 앞 Task 의 블록을 닫지 못해, 앞 Task 가 뒤 Task 의 메타를
 * 덮어써 missing_acceptance 같은 결함이 가려지고 ok:true 가 나올 수 있다.
 * @param {string} content
 * @returns {{id:string,title:string,line:number,block:string}[]}
 */
export function _split_tasks(content) {
  const fences = _fenced_ranges(content);
  const matches = [...content.matchAll(TASK_HEADING_RE)];
  const task_positions = new Set(matches.map((m) => m.index));
  const headings = [...content.matchAll(HEADING_RE)]
    .filter((m) => task_positions.has(m.index) || !_in_ranges(m.index, fences))
    .map((m) => [m.index, m[1].length]);
  const blocks = [];
  for (const m of matches) {
    const start = m.index;
    const level = m.groups.level.length;
    let end = content.length;
    for (const [pos, hl] of headings) {
      if (pos > start && hl <= level) {
        end = pos;
        break;
      }
    }
    let nl = 0;
    for (let i = content.indexOf('\n'); i !== -1 && i < start; i = content.indexOf('\n', i + 1)) nl++;
    blocks.push({
      id: m.groups.id,
      title: pyStrip(m.groups.title),
      line: nl + 1,
      block: content.slice(start, end),
    });
  }
  return blocks;
}

/** Task 블록에서 metadata 라인(- key: val)을 파싱. 키는 소문자, 값은 strip. 삽입순 유지(프로토타입 없는 객체). */
export function _parse_meta(block) {
  const meta = Object.create(null);
  for (const fm of block.matchAll(META_LINE_RE)) {
    meta[pyStrip(fm.groups.key).toLowerCase()] = pyStrip(fm.groups.val);
  }
  return meta;
}

/** Task가 acceptance criteria를 가지는지 (필드 또는 별도 섹션). */
export function _has_acceptance(block, meta) {
  if ('acceptance' in meta && pyStrip(meta.acceptance)) return true;
  if (ACCEPTANCE_HINT_RE.test(block)) return true;
  return false;
}

export function _depends_list(meta) {
  const raw = pyStrip(meta.depends ?? '');
  if (!raw || ['-', 'none', 'n/a'].includes(raw.toLowerCase())) return [];
  // split by comma or whitespace
  const parts = raw.split(new RegExp(`[,${PY_SPACE_CLASS}]+`, 'u'));
  return parts.map(pyStrip).filter((p) => p);
}

// python `a in b` (b 가 dict·list·str 일 때)
function pyIn(key, container) {
  if (Array.isArray(container)) return container.includes(key);
  if (typeof container === 'string') return container.includes(key);
  if (container && typeof container === 'object') return Object.prototype.hasOwnProperty.call(container, key);
  throw new TypeError(`argument of type '${container === null ? 'NoneType' : typeof container}' is not iterable`);
}

/**
 * domain이 dev-config에 매핑되어 단위/E2E 테스트 명령이 있는지.
 * @returns {[boolean, string]}
 */
export function _check_domain_mapping(domain, dev_config) {
  if (!domain || ['-', 'n/a', 'default'].includes(domain.toLowerCase())) {
    // default domain — assume always ok
    return [true, 'default domain'];
  }
  if (dev_config === null || dev_config === undefined) {
    return [true, 'dev-config not provided (skipped)'];
  }
  if (typeof dev_config !== 'object' || Array.isArray(dev_config)) {
    const t = Array.isArray(dev_config) ? 'list' : typeof dev_config === 'string' ? 'str' : typeof dev_config === 'boolean' ? 'bool' : 'int';
    throw new TypeError(`'${t}' object has no attribute 'get'`);
  }
  const domains = Object.prototype.hasOwnProperty.call(dev_config, 'domains') ? dev_config.domains : {};
  if (!pyIn(domain, domains)) {
    return [false, `domain '${domain}' not in dev-config.domains`];
  }
  return [true, 'mapped'];
}

// python `s[:120]` 은 코드포인트 기준이다
const head120 = (s) => {
  const cps = [...s];
  return cps.length <= 120 ? s : cps.slice(0, 120).join('');
};

/** Task 본문에서 모호 동사가 정량 기준 없이 사용된 줄을 반환. */
export function _has_quant_or_vague(block) {
  const issues = [];
  for (const line of splitlinesPy(block)) {
    // Skip metadata lines
    if (pyMatch(META_LINE_RE, line)) continue;
    if (QUANT_HINT_RE.test(line)) continue;
    const lower = line.toLowerCase();
    for (const verb of VAGUE_VERBS) {
      if (lower.includes(verb) || line.includes(verb)) {
        issues.push({
          type: 'vague_action',
          verb,
          context: head120(pyStrip(line)),
        });
        break;
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// import 사전 검사 — D-Flow src/lib/agent/wbsImport.ts toRpcNode 의 거부 조건을 미리 잡는다.
// 값은 export(wbs-parse.mjs)가 읽는 방식 그대로 읽는다: 블록 안에서 `- 키:` 로 시작하는 첫 줄, 앞뒤 공백 제거,
// 빈 값과 '-' 는 미지정. 그래서 META_LINE_RE 로 읽는 위 검사들과 값이 다를 수 있다.
// ---------------------------------------------------------------------------

export const IMPORT_PRIORITIES = ['critical', 'high', 'medium', 'low'];
// import 의 SCHEDULE_RE / SCHEDULE_END_ONLY_RE 와 같다(JS \d 는 ASCII 숫자만).
const SCHEDULE_RANGE_RE = /^(\d{4})-(\d{2})-(\d{2})\s*~\s*(\d{4})-(\d{2})-(\d{2})$/;
const SCHEDULE_END_RE = /^~\s*(\d{4})-(\d{2})-(\d{2})$/;

/** export 의 get_field 와 같은 규칙: `- 키:` 로 시작하는 첫 줄의 값. 없으면 ''. */
function firstField(block, name) {
  const pattern = `- ${name}:`;
  for (const line of splitlinesPy(block)) {
    if (line.startsWith(pattern)) return pyStrip(line.slice(pattern.length));
  }
  return '';
}

/** 빈 값과 '-' 는 null (export 의 _nullify). */
function nullable(v) {
  const t = pyStrip(v || '');
  return !t || t === '-' ? null : t;
}

function validDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = m === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return d <= dim;
}

/** schedule 값 검사. 문제가 없으면 null, 있으면 사유 문장. */
export function _schedule_problem(raw) {
  const v = nullable(raw);
  if (v === null) return null;
  const r = SCHEDULE_RANGE_RE.exec(v);
  if (r) {
    if (!validDate(r[1], r[2], r[3]) || !validDate(r[4], r[5], r[6])) return `schedule 에 없는 날짜가 있음: ${v}`;
    return null;
  }
  const e = SCHEDULE_END_RE.exec(v);
  if (e) return validDate(e[1], e[2], e[3]) ? null : `schedule 에 없는 날짜가 있음: ${v}`;
  return `schedule 형식 오류: ${v} (YYYY-MM-DD ~ YYYY-MM-DD 또는 ~ YYYY-MM-DD)`;
}

/** Task 블록 하나의 import 사전 검사. */
export function _import_task_issues(b) {
  const issues = [];
  const at = { task: b.id, line: b.line };
  // TASK_HEADING_RE 의 제목 칸은 \s 가 개행을 삼켜 빈 제목이면 다음 줄을 제목으로 잡는다 — 헤딩 첫 줄만 다시 본다.
  const head = splitlinesPy(b.block)[0] ?? '';
  const hm = /^[^:]*:(.*)$/u.exec(head);
  if (!pyStrip(hm ? hm[1] : '')) issues.push({ ...at, type: 'missing_title', detail: 'Task 헤딩에 제목이 없음 (import: id·title 필수)' });
  const priority = nullable(firstField(b.block, 'priority'));
  if (priority !== null && !IMPORT_PRIORITIES.includes(priority)) {
    issues.push({ ...at, type: 'invalid_priority', detail: `priority ${pyReprStr(priority)} 는 critical|high|medium|low 가 아님` });
  }
  const sp = _schedule_problem(firstField(b.block, 'schedule'));
  if (sp) issues.push({ ...at, type: 'invalid_schedule', detail: sp });
  const status = firstField(b.block, 'status');
  if (status && !STAGE_CODE.has(status)) {
    issues.push({ ...at, type: 'invalid_status', detail: `status ${pyReprStr(status)} 는 알 수 없는 표기 — ${[...STAGE_CODE.keys()].join(' ')} 중 하나` });
  }
  return issues;
}

const WP_HEADING_RE = new RegExp(`^##${S}+(WP-${D}+):${S}*([^\\n]*)$`, 'u');
const ACT_HEADING_RE = new RegExp(`^###${S}+(ACT-${D}+(?:-${D}+)+):${S}*([^\\n]*)$`, 'u');

/** WP·ACT 헤딩의 제목 누락, WP 의 schedule 형식. 펜스 안의 줄은 건너뛴다. */
export function _import_group_issues(content) {
  const issues = [];
  const lines = splitlinesPy(content);
  const fences = _fenced_ranges(content);
  const offsets = line_start_offsets(content);
  for (let i = 0; i < lines.length; i++) {
    if (_in_ranges(offsets[i], fences)) continue;
    const wp = WP_HEADING_RE.exec(lines[i]);
    const act = wp ? null : ACT_HEADING_RE.exec(lines[i]);
    const m = wp || act;
    if (!m) continue;
    const at = { task: m[1], line: i + 1 };
    if (!pyStrip(m[2])) issues.push({ ...at, type: 'missing_title', detail: `${wp ? 'WP' : 'ACT'} 헤딩에 제목이 없음 (import: id·title 필수)` });
    if (wp) {
      const meta = [];
      for (let k = i + 1; k < lines.length && !lines[k].startsWith('#'); k++) meta.push(lines[k]);
      const sp = _schedule_problem(firstField(meta.join('\n'), 'schedule'));
      if (sp) issues.push({ ...at, type: 'invalid_schedule', detail: sp });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export function validate_wbs(content, dev_config = null) {
  const blocks = _split_tasks(content);
  const all_ids = new Set(blocks.map((b) => b.id));
  const issues = [];

  for (const b of blocks) {
    const meta = _parse_meta(b.block);
    const tid = b.id;
    const line = b.line;

    // 1. acceptance
    if (!_has_acceptance(b.block, meta)) {
      issues.push({
        task: tid, line,
        type: 'missing_acceptance',
        detail: "no 'acceptance' field or '수락 기준/Acceptance' subsection",
      });
    }

    // 2. depends completeness
    for (const dep of _depends_list(meta)) {
      if (!all_ids.has(dep)) {
        issues.push({
          task: tid, line,
          type: 'depends_unknown',
          detail: `depends references ${pyReprStr(dep)} which is not in WBS`,
        });
      }
    }

    // 3. domain mapping
    const domain = meta.domain ?? '';
    const [ok, reason] = _check_domain_mapping(domain, dev_config);
    if (!ok) {
      issues.push({
        task: tid, line,
        type: 'test_unmapped',
        detail: reason,
      });
    }

    // 4. vague verbs
    // Only count up to first 3 to avoid noise
    const vague = _has_quant_or_vague(b.block).slice(0, 3);
    for (const v of vague) {
      issues.push({
        task: tid, line,
        type: 'vague_action',
        verb: v.verb,
        context: v.context,
      });
    }

    // 5~8. import 사전 검사
    issues.push(..._import_task_issues(b));
  }
  issues.push(..._import_group_issues(content));

  const summary = {};
  for (const it of issues) {
    summary[it.type] = (summary[it.type] ?? 0) + 1;
  }
  summary.total = issues.length;
  summary.task_count = blocks.length;

  return {
    ok: issues.length === 0,
    summary,
    issues,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

// python `str(pathlib.Path(p))`: 빈 성분·`.` 제거, 연속 슬래시 정리, 빈 경로는 `.`
export function pyPathStr(p) {
  const win = process.platform === 'win32';
  const s = win ? p.replace(/\\/g, '/') : p;
  let lead = '';
  if (s.startsWith('/')) lead = s.startsWith('//') && !s.startsWith('///') ? '//' : '/';
  const r = lead + s.split('/').filter((x) => x !== '' && x !== '.').join('/');
  const out = r === '' ? '.' : r;
  return win ? out.replace(/\//g, '\\') : out;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const SPEC = {
  prog: 'wbs-validate.mjs',
  description: 'WBS Task 품질 검사',
  commands: {
    validate: {
      options: {
        wbs: { type: 'string', required: true },
        'dev-config-json': { type: 'string' },
      },
    },
  },
};

/**
 * 종료 코드를 돌려준다(process.exit 는 부르지 않는다). 사용 오류면 args.mjs 가 stderr 에 쓰고 2 를 돌려준다.
 * @param {string[]} [argv]
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argv, SPEC);
  if (!cli) return Number(process.exitCode ?? USAGE);

  if (cli.command === 'validate') {
    const wbs = cli.values.wbs;
    const p = pyPathStr(wbs);
    if (!isFile(wbs)) {
      process.stderr.write(`${pyJsonDumps({ ok: false, error: `wbs not found: ${p}` })}\n`);
      return USAGE;
    }
    const content = readText(wbs);
    let dev_config = null;
    const raw = cli.values['dev-config-json'];
    if (raw) {
      try {
        dev_config = pyJsonLoads(raw);
      } catch (e) {
        if (!(e instanceof PyJSONDecodeError)) throw e;
        process.stderr.write(`${pyJsonDumps({ ok: false, error: `--dev-config-json parse error: ${e.message}` })}\n`);
        return USAGE;
      }
    }
    const result = validate_wbs(content, dev_config);
    result.target = p;
    process.stdout.write(`${pyJsonDumps(result, { indent: 2, ensureAscii: false })}\n`);
    return result.ok ? OK : VIOLATION;
  }

  return VIOLATION;
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMain()) finish(main());
