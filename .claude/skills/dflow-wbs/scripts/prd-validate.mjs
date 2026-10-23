#!/usr/bin/env node
// prd-validate.mjs — PRD/TRD 정합성 검사 (python `prd-validate.py` 의 node 이식)
//
// 상류 품질 게이트의 첫 번째 단계. PRD/TRD에 모호 표현·placeholder·누락 섹션이
// 있는지 검출해 다운스트림(/wbs, /dev, /feat)이 모호 요구로 작업하지 않도록 한다.
// 실제 자동 보강은 LLM이 수행하며 — 이 스크립트는 issue를 JSON으로 보고할 뿐이다.
//
// 검출 항목:
//   1. Placeholder    TBD / TODO / ??? / <…>
//   2. Vague metrics  "fast" / "scalable" / "user-friendly" 등 정량 기준 없는 형용사
//   3. Missing sections  acceptance criteria / NFR / constraints / glossary
//
// 서브커맨드:
//   validate --target FILE [--required-sections KEY1,KEY2,...]
//                                   PRD/TRD 정합성 검사 → JSON
//   assumptions-template --target FILE
//                                   ## Assumptions (auto-resolved YYYY-MM-DD) 템플릿 출력
//
// 사용:
//   node prd-validate.mjs validate --target docs/PRD.md
//   node prd-validate.mjs validate --target docs/TRD.md --required-sections "acceptance criteria,NFR,constraints"
//
// 종료 코드:
//   0  ok=true (issue 없음)
//   1  ok=false (issue 1개 이상)
//   2  사용 오류
//
// python 판과 같은 점: 출력 JSON(들여쓰기 2, 한글 그대로)·issue 순서·종료 코드를 바이트까지 맞췄다. python 의 `\b`·`\s`·`\d`·`.lower()`·
//   코드포인트 단위 슬라이스(`[:120]`)를 그대로 따르려고 아래 `B`(유니코드 단어 경계)·`SP`(python 공백)를 직접 정의해 썼다.
//   파일은 BOM 을 남긴 채 읽는다(python `read_text(encoding="utf-8")` 와 같다. 첫 줄이 BOM 으로 시작하면 `^#` 머리글로 보지 않는 것까지 같다).
// python 판과 다른 점(알고 둔 것):
//   - 인자 해석 오류·도움말 문구는 `_shared/node/args.mjs` 의 한국어 문구다(종료 코드 2·0 은 같다).
//   - 잘못된 UTF-8 파일은 python 이 UnicodeDecodeError 로 끝내고 이 판도 예외로 끝난다(종료 코드 1, 문구만 다름).
//   - `assumptions-template` 본문의 호출 예시가 `scripts/decision-log.py list --target docs` 에서
//     `node .claude/skills/dflow-wbs/scripts/decision-log.mjs list --target docs` 로 바뀌었다(python 호출을 문서에 남기지 않으려는 의도. 그 한 줄만 다르다).
//   - 대소문자 무시 비교는 python 처럼 i 를 ı·İ 와 같게 본다(그 밖의 극소수 유니코드 동치는 JS 규칙을 따른다).
//   - `assumptions-template` 의 날짜는 python 판과 같이 현재 UTC 날짜이고 주입 수단이 없다(시험은 날짜를 정규화해 비교).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OK, VIOLATION, USAGE, finish, parseCli } from '../../_shared/node/args.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { splitlinesPy } from '../../_shared/node/pytext.mjs';
import { PY_SPACE_CLASS, pyStrip } from '../../dflow-export/scripts/_pystr.mjs';
import { pyPathStr } from '../../dflow-export/scripts/wbs-validate.mjs';
import { argparse_compat_argv, cp_index, cp_slice, py_read_text } from './_pyio.mjs';

// python 정규식 의미: `\w` = 글자·숫자·밑줄(유니코드), `\b` = 단어 경계, `\s` = python 공백 집합, `\d` = 유니코드 10진 숫자.
const W = '\\p{L}\\p{N}_';
const B = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;
const SP = `[${PY_SPACE_CLASS}]`;
// python re.IGNORECASE 는 i 를 터키어 ı(U+0131)·İ(U+0130)와도 같다고 본다(JS /iu 는 아니다). s·k 는 ſ·K(켈빈)까지 JS 도 같이 본다.
const I = '[iIıİ]';

export const PLACEHOLDER_PATTERNS = [
  [new RegExp(`${B}TBD${B}`, 'giu'), 'TBD'],
  [new RegExp(`${B}TODO${B}`, 'giu'), 'TODO'],
  [/\?{3,}/g, '???'],
  [/<[A-Z_][A-Z0-9_ -]{2,}>/g, '<PLACEHOLDER>'],
];

export const VAGUE_TERMS = [
  'fast', 'scalable', 'user-friendly', 'intuitive', 'robust',
  'efficient', 'modern', 'seamless', 'smooth', 'easy',
  'high performance', 'low latency', 'best-in-class',
  'world-class', 'blazing', 'lightning',
  // Korean
  '빠른', '빠르게', '쉬운', '사용자 친화', '직관적', '효율적', '원활',
];

export const DEFAULT_REQUIRED_SECTIONS = [
  'acceptance criteria',
  'non-functional requirements',
  'constraints',
];

// Section name aliases (normalized → list of regex alternatives; python 소스를 JS(u 모드) 소스로 옮긴 것)
export const SECTION_ALIASES = {
  'acceptance criteria': [
    `acceptance${SP}*cr${I}ter${I}a`, `수락${SP}*기준`, `완료${SP}*조건`,
  ],
  'non-functional requirements': [
    `non[\\- ]?funct${I}onal${SP}*requ${I}rements`, `${B}NFR${B}`,
    `비${SP}*기능${SP}*요구`, `성능[/${PY_SPACE_CLASS}]?품질[/${PY_SPACE_CLASS}]?보안`,
  ],
  constraints: [
    `constra${I}nts?`, `제약${SP}*사항`, `제약${SP}*조건`,
  ],
  glossary: ['glossary', `용어${SP}*정의`, '용어집'],
};

export const QUANT_HINT_RE = new RegExp(
  `${B}\\p{Nd}+${SP}*(ms|s|sec|seconds?|m${I}nutes?|hours?|%|p\\p{Nd}+|MB|GB|TB|KB|bytes?|` +
    `req(/s)?|qps|tps|rps|kgs?|users?|MAU|DAU)${B}`,
  'iu',
);

export function _utc_iso_date() {
  return new Date().toISOString().slice(0, 10);
}

// python `re.escape` 대신: 정규식 구문 문자만 막는다(u 모드는 그 밖의 `\-`·`\ ` 같은 이스케이프를 허용하지 않는다).
// 대소문자 무시 비교에서 i 는 python 처럼 ı·İ 와도 같게 둔다(위 `I`).
function reEscape(s) {
  return s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&').replace(/[iIıİ]/g, I);
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

export function find_placeholders(content) {
  const issues = [];
  splitlinesPy(content).forEach((line, i) => {
    const line_no = i + 1;
    // Skip code blocks (heuristic — would need tokenizer for full accuracy)
    for (const [pattern, label] of PLACEHOLDER_PATTERNS) {
      for (const m of line.matchAll(pattern)) {
        issues.push({
          type: 'placeholder',
          label,
          line: line_no,
          match: m[0],
          context: cp_slice(pyStrip(line), 0, 120),
        });
      }
    }
  });
  return issues;
}

/** 모호 형용사가 정량 hint 없이 등장하는 줄을 검출. */
export function find_vague_metrics(content) {
  const issues = [];
  splitlinesPy(content).forEach((line, i) => {
    const line_no = i + 1;
    const lower = line.toLowerCase();
    // If line has any quantitative hint (numbers + units), accept it
    if (QUANT_HINT_RE.test(line)) return;
    for (const term of VAGUE_TERMS) {
      const termLower = term.toLowerCase();
      if (lower.includes(termLower)) {
        const pos = cp_index(lower, lower.indexOf(termLower));
        const termLen = Array.from(term).length;
        issues.push({
          type: 'vague_metric',
          term,
          line: line_no,
          match: cp_slice(line, pos, pos + termLen),
          context: cp_slice(pyStrip(line), 0, 120),
        });
        break; // one issue per line
      }
    }
  });
  return issues;
}

/** 필수 섹션 헤더가 존재하는지 (대소문자/언어 무관) 검사. */
export function find_missing_sections(content, required) {
  const issues = [];
  for (const canonical of required) {
    const aliases = Object.hasOwn(SECTION_ALIASES, canonical) ? SECTION_ALIASES[canonical] : [reEscape(canonical)];
    // Match any heading line: ^#{1,6}\s+...alias...
    let found = false;
    for (const alias of aliases) {
      const pattern = new RegExp(`(?<![^\\n])#{1,6}${SP}+[^\\n]*${B}(?:${alias})${B}`, 'iu');
      if (pattern.test(content)) {
        found = true;
        break;
      }
    }
    if (!found) {
      issues.push({ type: 'missing_section', section: canonical });
    }
  }
  return issues;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function validate_file(file, required_sections) {
  if (!isFile(file)) {
    return {
      ok: false,
      error: `file not found: ${pyPathStr(file)}`,
      issues: [],
    };
  }
  const content = py_read_text(file);
  const placeholders = find_placeholders(content);
  const vague = find_vague_metrics(content);
  const missing = find_missing_sections(content, required_sections);
  const issues = [...placeholders, ...vague, ...missing];
  return {
    ok: issues.length === 0,
    target: pyPathStr(file),
    summary: {
      placeholder_count: placeholders.length,
      vague_count: vague.length,
      missing_section_count: missing.length,
      total: issues.length,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Assumptions template
// ---------------------------------------------------------------------------

export const ASSUMPTIONS_TEMPLATE = `\
## Assumptions (auto-resolved {date})

> 이 섹션은 dev-plugin의 자율 결정으로 보강된 가정 목록이다. 원본 PRD/TRD가 명시하지 않은 항목을 합리적으로 채워 넣은 결과로, 사후 변경이 필요하면 PRD를 수정한 뒤 \`/wbs\`를 재실행한다.
>
> 각 항목은 \`docs/decisions.md\`에도 entry가 추가되어 있다 (\`node .claude/skills/dflow-wbs/scripts/decision-log.mjs list --target docs\` 로 확인 가능).

- (placeholder) 보강된 가정을 한 줄씩 기록
`;

export function assumptions_template() {
  return ASSUMPTIONS_TEMPLATE.replace('{date}', _utc_iso_date());
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const SPEC = {
  prog: 'prd-validate.mjs',
  description: 'PRD/TRD 정합성 검사',
  commands: {
    validate: {
      options: {
        target: { type: 'string', required: true },
        'required-sections': { type: 'string', default: DEFAULT_REQUIRED_SECTIONS.join(',') },
      },
    },
    'assumptions-template': { options: { target: { type: 'string' } } },
  },
};

const OPTION_KINDS = Object.fromEntries(
  Object.entries(SPEC.commands).map(([c, s]) => [c, Object.fromEntries(Object.entries(s.options).map(([n, o]) => [n, o.type]))]),
);

/**
 * 종료 코드를 돌려준다(process.exit 는 부르지 않는다). 사용 오류면 args.mjs 가 stderr 에 쓰고 2 를 돌려준다.
 * @param {string[]} [argv]
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argparse_compat_argv(argv, OPTION_KINDS), SPEC);
  if (!cli) return Number(process.exitCode ?? USAGE);

  if (cli.command === 'validate') {
    const required = cli.values['required-sections']
      .split(',')
      .map((s) => pyStrip(s))
      .filter((s) => s);
    const result = validate_file(cli.values.target, required);
    process.stdout.write(`${pyJsonDumps(result, { indent: 2, ensureAscii: false })}\n`);
    return result.ok ? OK : VIOLATION;
  }

  if (cli.command === 'assumptions-template') {
    process.stdout.write(`${assumptions_template()}\n`);
    return OK;
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
