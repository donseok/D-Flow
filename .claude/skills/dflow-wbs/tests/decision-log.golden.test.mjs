// decision-log 골든 비교(공용 도구 `_shared/node/goldentool.mjs` 사용): 서로 다른 임시 저장소에서 python 판과 node 판을 같은 인자로 돌려
// stdout·stderr·종료 코드와 저장소에 남은 파일 전체(바이트)를 비교한다. 사용 예는 adr-write/tests/golden.test.mjs.
//
// 시각: 두 판 모두 CLI 로 시각을 주입할 수 없다. goldentool 은 파일을 바이트로 비교하므로, 이 파일은 시각을 2026-10-07T00:00:00Z 로 고정하는
// 시험 전용 래퍼로 두 판을 돈다(python: env.dir 에 만드는 `decision-log-fixed.py`, node: decision-log-fixed-time.mjs).
// goldentool 은 명령 하나를 한 번 돌린다(cwd 지정·시각 정규화 없음). 여러 단계·교차 실행·상대 경로·시각 정규화가 필요한 사례는
// decision-log.test.mjs(case-runner.mjs)가 맡는다. python 이 없으면(윈도우) 전부 skip 된다.

import fs from 'node:fs';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { goldenToolTest } from '../../_shared/node/goldentool.mjs';
import { legacyEnv } from './legacy-env-decision-prd.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = legacyEnv();
after(() => env.cleanup());

const legacy = path.join(env.dir, 'decision-log-fixed.py');
fs.writeFileSync(
  legacy,
  [
    'import importlib.util, os, sys',
    "here = os.path.dirname(os.path.abspath(__file__))",
    "spec = importlib.util.spec_from_file_location('dl', os.path.join(here, 'decision-log.py'))",
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    "m._utc_iso = lambda: '2026-10-07T00:00:00Z'",
    'sys.exit(m.main())',
    '',
  ].join('\n'),
);
const script = path.join(HERE, 'decision-log-fixed-time.mjs');

const DEC = 'decisions.md';
const HEADER = '# Decisions Log — TSK-01\n\n> Append-only audit trail of autonomous decisions made during DDTR/feat/wbs cycles.\n> Edit prior entries forbidden — record reversals as new entries instead.\n\n';
const BLOCK = (n, extra = '') => `## D-${n} (2026-01-01T00:00:00Z)\n- **Phase**: design\n- **Decision needed**: n\n- **Decision made**: m\n- **Rationale**: r\n${extra}`;

/** files: {'docs/tasks/TSK-01/decisions.md': 본문} 를 임시 저장소에 만든다. */
const seed = (files = {}) => (root) => {
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
};
const TSK = (root) => path.join(root, 'docs', 'tasks', 'TSK-01');
const append = (rest = [], base = {}) => (root) => {
  const b = { phase: 'design', needed: 'N', made: 'M', rationale: 'R', ...base };
  return ['append', '--target', TSK(root), '--phase', b.phase, '--decision-needed', b.needed, '--decision-made', b.made, '--rationale', b.rationale, ...rest];
};
const f = `docs/tasks/TSK-01/${DEC}`;

const cases = {
  'append: 새 파일': { setup: seed(), args: append() },
  'append: 선택 필드·한글': { setup: seed(), args: append(['--reversible', 'no', '--source', '파일.ts:3'], { needed: '결정 😀', made: '- 값' }) },
  'append: 라벨 덮어쓰기': { setup: seed(), args: append(['--scope-label', '내 라벨']) },
  'append: 기존 파일 이어 붙임': { setup: seed({ [f]: HEADER + BLOCK('001') }), args: append([], { phase: 'build' }) },
  'append: 끝 개행 없는 기존 파일': { setup: seed({ [f]: HEADER + BLOCK('001').trimEnd() }), args: append() },
  'append: CRLF 기존 파일': { setup: seed({ [f]: (HEADER + BLOCK('001')).replace(/\n/g, '\r\n') }), args: append() },
  'append: BOM 기존 파일': { setup: seed({ [f]: `﻿${HEADER}${BLOCK('001')}` }), args: append() },
  'append: 번호 건너뜀·0 앞붙임': { setup: seed({ [f]: HEADER + BLOCK('0007') + '\n' + BLOCK('003') }), args: append() },
  'append: 빈 필드(검증 오류 2)': { setup: seed(), args: append([], { rationale: '  ' }) },
  'append: python 만 공백으로 보는 값': { setup: seed(), args: append([], { made: '\x1c\x85' }) },
  'append: 접두 축약 옵션': { setup: seed(), args: (root) => ['append', '--target', TSK(root), '--phase', 'test', '--decision-n', 'a', '--decision-m', 'b', '--rat', 'c'] },
  'append: 값이 - 로 시작': { setup: seed(), args: append([], { needed: '- 항목', made: '-1', rationale: '--x y' }) },
  'list: 정상': { setup: seed({ [f]: HEADER + BLOCK('001', '- **Reversible**: yes\n') + '\n' + BLOCK('002') }), args: (root) => ['list', '--target', TSK(root)] },
  'list: 파일 없음': { setup: seed(), args: (root) => ['list', '--target', TSK(root)] },
  'validate: 정상': { setup: seed({ [f]: HEADER + BLOCK('001') }), args: (root) => ['validate', '--target', TSK(root)] },
  'validate: 위반(끊김·필드·phase·reversible)': {
    setup: seed({ [f]: BLOCK('002') + '\n## D-003 (t)\n- **Phase**: deploy\n- **Reversible**: Yes\n' }),
    args: (root) => ['validate', '--target', TSK(root)],
  },
  'validate: 파일 없음': { setup: seed(), args: (root) => ['validate', '--target', TSK(root)] },
};

for (const [name, c] of Object.entries(cases)) {
  goldenToolTest(`goldentool: ${name}`, { legacy, script, rootFlag: null, ...c });
}

// argparse 와 문구가 다른 사용 오류는 종료 코드만 비교한다.
const usage = {
  '사용 오류: 인자 없음': [],
  '사용 오류: 알 수 없는 명령': ['bogus'],
  '사용 오류: 알 수 없는 phase': (root) => ['append', '--target', TSK(root), '--phase', 'deploy', '--decision-needed', 'a', '--decision-made', 'b', '--rationale', 'c'],
  '사용 오류: target 없음': ['list'],
  '사용 오류: -foo 값': (root) => ['append', '--target', TSK(root), '--phase', 'design', '--decision-needed', 'a', '--decision-made', 'b', '--rationale', '-foo'],
};
for (const [name, args] of Object.entries(usage)) {
  goldenToolTest(`goldentool: ${name}`, { legacy, script, rootFlag: null, setup: seed(), args, statusOnly: true });
}
