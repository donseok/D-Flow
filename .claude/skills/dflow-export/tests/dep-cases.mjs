// dep-cases.mjs — dep-analysis 골든 비교용 입력과 CLI 케이스 정의.
// dep-analysis.test.mjs 와 make-expected-dep.mjs 가 함께 import 한다.
//
// 모든 케이스는 임시 폴더(cwd)에 FILES 를 쓰고 args(상대 경로)로 돌린다. 표준입력이 필요하면 input 에 문자열을 준다.
//  - compare   : 비교할 필드(기본 stdout·status·stderr). python 이 traceback 을 내는 케이스는 ['stdout','status'].
//  - diamonds  : 같은 가지 쌍이 합류점을 둘 이상 공유 → python 출력의 diamond_patterns 순서는 실행마다 달라진다(해시 무작위).
//                node 판은 코드포인트 순으로 고정하므로 이 케이스는 diamond_patterns 를 정렬한 뒤 비교한다.
//  - env       : 양쪽에 같이 주는 환경 변수(WBS_STATE_MACHINE 등).
// 실제 리포 WBS(docs/mdm/wbs.md)를 python wbs-parse.py --tasks-all 로 변환한 스냅숏이 있으면
// (tests/golden/inputs/dep-mdm-tasks-all.json) 그 위에 진행 상태를 덧씌운 변형도 케이스로 만든다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT = path.join(HERE, 'golden', 'inputs', 'dep-mdm-tasks-all.json');

const J = (v) => JSON.stringify(v);
const JI = (v) => JSON.stringify(v, null, 2);
const t = (tsk_id, depends = '-', status = '[ ]', extra = {}) => ({ tsk_id, depends, status, ...extra });

// ---- 입력 -------------------------------------------------------------------

const SIMPLE = [t('TSK-01-01'), t('TSK-01-02', 'TSK-01-01'), t('TSK-01-03', 'TSK-01-01'), t('TSK-01-04', 'TSK-01-02, TSK-01-03')];
const WITH_DONE = [
  t('TSK-00-01', '-', '[xx]'), t('TSK-00-02', 'TSK-00-01', '[im]'), t('TSK-00-03', '-', '[ ]', { bypassed: true }),
  t('TSK-00-04', '-', '[ ]', { category: 'feat' }), t('TSK-01-01', 'TSK-00-01 TSK-00-02'),
  t('TSK-01-02', 'TSK-00-03,TSK-00-04, TSK-EXTERNAL'), t('TSK-01-03', 'TSK-01-01  TSK-01-02', '[xx] 검수 완료'),
  t('TSK-01-04', 'TSK-01-03', '[dd]'),
];
const CYCLE = [t('A', 'B'), t('B', 'A'), t('C', 'A'), t('D'), t('E', 'D')];
const SELF_DEP = [t('A', 'A'), t('B', 'A')];
const DUP_ID = [t('A'), t('A', 'B'), t('B')];
const DUP_ROOTS = [t('A'), t('A'), t('B', 'A')];
const ID_ALIAS = [{ id: 'X-1', depends: '-', status: '[ ]' }, { id: 'X-2', depends: 'X-1', status: '[ ]' }, { id: 'X-3', depends: 'X-1', status: '[xx]' }];
const NO_ID = [t(''), { depends: '-', status: '[ ]' }, t('A'), { id: '', tsk_id: '', depends: 'A' }];
const KOREAN = [t('TSK-가'), t('TSK-나', 'TSK-가'), t('TSK-다', 'TSK-가'), t('TSK-라', 'TSK-나, TSK-다')];
const ASTRAL = [t('TSK-～'), t('TSK-\u{1F600}'), t('TSK-Z', 'TSK-～, TSK-\u{1F600}')];
const NUMERIC_STR = [t('10'), t('2', '10'), t('1', '2, 10'), t('20', '1'), t('3', '1')];
const ODD_SPACES = [
  t('A'), t('B', 'A　'), t('C', 'A B'), t('D', 'A\u0085B'), t('E', 'A\u001cB'), t('F', 'A  B'),
  t('G', 'A﻿B'), t('H', 'A​B'),
];
const DEPENDS_FORMS = [
  t('A'), t('B', '(none)'), t('C', ''), t('D', '  '), t('E', 'A, -, B'), t('F', ',,A,,'), t('G', '- A'), t('H', 'A,-'), t('I', '(none) A'),
  { tsk_id: 'J', status: '[ ]' }, { tsk_id: 'K', depends: null, status: '[ ]' }, { tsk_id: 'L', depends: 0, status: '[ ]' },
  { tsk_id: 'M', depends: [], status: '[ ]' },
];
const NO_STATUS = [{ tsk_id: 'A' }, { tsk_id: 'B', depends: 'A' }];
const STATUS_FORMS = [
  t('A', '-', '[xx]'), t('B', '-', '[XX]'), t('C', '-', ' [xx] '), t('D', '-', '[ ] [xx]'), t('E', '-', '[im]'),
  t('F', '-', '[im] 구현'), t('G', '-', '[완료]'), t('H', '-', ''), t('I', '-', '[xx'), t('J', '-', ['[xx]']), t('K', '-', { '[xx]': 1 }),
];
const STATUS_NULL = [t('A', '-', null)];
const STATUS_INT = [t('A', '-', 5)];
const STATUS_LIST_NO = [t('A', '-', ['x']), t('B', 'A')];
const BYPASS_FORMS = [
  t('A', '-', '[ ]', { bypassed: 1 }), t('B', '-', '[ ]', { bypassed: 'no' }), t('C', '-', '[ ]', { bypassed: false }),
  t('D', '-', '[ ]', { bypassed: 0 }), t('E', '-', '[ ]', { bypassed: [] }), t('F', '-', '[ ]', { bypassed: [0] }),
  t('G', '-', '[ ]', { bypassed: null }), t('H', '-', '[ ]', { category: 'FEAT' }), t('I', '-', '[ ]', { category: 'feat ' }),
  t('J', '-', '[ ]', { category: 'dev' }), t('K', 'A B C D E F G H I J'),
];
const DEP_LIST = [t('A'), t('B', ['A'])];
const DEP_INT = [t('A'), t('B', 5)];
const DEP_NULL_ONLY_DONE = [t('A', ['x'], '[xx]')]; // 완료 항목의 depends 는 해석하지 않는다
const IDS_NULL = [{ tsk_id: null, id: null, status: '[ ]' }, { tsk_id: null, status: '[ ]', depends: '-' }];
const IDS_NUM = [t(5), t(7, '5'), t(9, '7')];
const ID_LIST = [t(['a'])];
const ID_LIST_DONE = [t(['a'], '-', '[xx]')];
const ID_EMPTY_LIST = [{ tsk_id: [], status: '[ ]' }, t('A')];
const ID_DICT = [t({ a: 1 })];
const NON_DICT_ITEMS = [t('A'), 'B'];
const NON_DICT_NULL = [null];
const NON_DICT_LIST = [[1]];
const NON_DICT_NUM = [5];

// 그래프 지표용
const DIAMOND = [t('A'), t('B', 'A'), t('C', 'A'), t('D', 'B, C')];
const MULTI_MERGE = [t('A'), t('B', 'A'), t('C', 'A'), t('D', 'B, C'), t('E', 'B, C'), t('F', 'B, C')];
const DIAMOND_DUPDEP = [t('A'), t('B', 'A, A'), t('C', 'A'), t('D', 'B, C')];
const TIE_PARENT = [t('A'), t('C', 'A'), t('B', 'A'), t('D', 'C, B')];
const TIE_ENDPOINT = [t('X1'), t('X2', 'X1'), t('Y1'), t('Y2', 'Y1'), t('A1'), t('A2', 'A1')];
const TIE_ROOTS = [t('B'), t('A'), t('C', 'A B')];
const FAN_TIES = [t('R1'), t('R2'), t('R3'), t('S1', 'R1 R2 R3'), t('S2', 'R1 R2 R3'), t('S3', 'R1')];
const CAND_BOTH = [
  t('W'), t('X'), t('Y'), t('Z'), t('T', 'W X Y Z'), t('U1', 'T'), t('U2', 'T'), t('U3', 'T'), t('V', 'W, X, Y, Z, T'),
];
const FANOUT_TOP = [t('H'), ...Array.from({ length: 12 }, (_, i) => t(`K${String(i).padStart(2, '0')}`, 'H')),
  ...Array.from({ length: 4 }, (_, i) => t(`L${i}`, 'K00 K01 K02'))];
const ONE_TASK = [t('ONLY')];
const GS_EXTERNAL = [t('A', 'GHOST'), t('B', 'A, GHOST2')];
const GS_NO_ID = [t(''), { depends: '-' }, t('A'), { id: 'B', depends: 'A' }];
const GS_DEPENDS_ODD = [t('A', ['x'], '[ ]')];
const GS_LONG_CHAIN = Array.from({ length: 60 }, (_, i) => t(`N${String(i).padStart(3, '0')}`, i === 0 ? '-' : `N${String(i - 1).padStart(3, '0')}`));
const GS_WIDE = [t('ROOT'), ...Array.from({ length: 12 }, (_, i) => t(`M${String(i).padStart(2, '0')}`, 'ROOT')), t('SINK', Array.from({ length: 12 }, (_, i) => `M${String(i).padStart(2, '0')}`).join(' '))];

// 기본 모드 + 그래프 지표 양쪽에 돌리는 입력
const SHARED = {
  simple: SIMPLE, 'done-mix': WITH_DONE, cycle: CYCLE, 'self-dep': SELF_DEP, 'dup-id': DUP_ID, 'dup-roots': DUP_ROOTS,
  'id-alias': ID_ALIAS, 'no-id': NO_ID, korean: KOREAN, astral: ASTRAL, 'numeric-str': NUMERIC_STR, 'odd-spaces': ODD_SPACES,
  'depends-forms': DEPENDS_FORMS, 'no-status': NO_STATUS, 'ids-num': IDS_NUM, 'ids-null': IDS_NULL, diamond: DIAMOND,
  'multi-merge': MULTI_MERGE, 'diamond-dupdep': DIAMOND_DUPDEP, 'tie-parent': TIE_PARENT, 'tie-endpoint': TIE_ENDPOINT,
  'tie-roots': TIE_ROOTS, 'fan-ties': FAN_TIES, 'cand-both': CAND_BOTH, 'fanout-top': FANOUT_TOP, 'one-task': ONE_TASK,
  external: GS_EXTERNAL, 'gs-no-id': GS_NO_ID, 'long-chain': GS_LONG_CHAIN, wide: GS_WIDE, 'status-forms': STATUS_FORMS,
  'bypass-forms': BYPASS_FORMS, 'status-list-no': STATUS_LIST_NO, 'dep-null-only-done': DEP_NULL_ONLY_DONE,
};
// python 이 traceback 으로 끝나는 입력(종료 코드 1, stderr 문구는 다름)
const PY_TRACEBACK = {
  'status-null': STATUS_NULL, 'status-int': STATUS_INT, 'depends-list': DEP_LIST, 'depends-int': DEP_INT, 'id-list': ID_LIST,
  'id-list-done': ID_LIST_DONE, 'id-dict': ID_DICT, 'non-dict-item': NON_DICT_ITEMS, 'non-dict-null': NON_DICT_NULL,
  'non-dict-list': NON_DICT_LIST, 'non-dict-num': NON_DICT_NUM, 'gs-depends-list': GS_DEPENDS_ODD,
};
// 같은 가지 쌍이 합류점을 둘 이상 공유해 python 의 diamond_patterns 순서가 실행마다 달라지는 입력
const MULTI_MERGE_IDS = new Set(['multi-merge', 'fanout-top']);
// 기본 모드는 정상인데 그래프 지표 모드에서만 python 이 traceback 으로 끝나는 입력(완료 항목의 depends 를 해석하지 않는 차이)
const GS_TRACEBACK = new Set(['dep-null-only-done']);

// ---- 상태머신 폴더 ------------------------------------------------------------

const SM_V6 = {
  states: { '[ ]': { label: '미착수' }, '[as]': {}, '[fp]': {}, '[ip]': {}, '[im]': {}, '[xx]': {} },
};
const SM_KR = { states: { '[ ]': {}, '[완료]': {}, '[xx]': {} }, dependency: { satisfied_states: ['[완료]', '[xx]'] } };
const SM_EXPLICIT_EMPTY = { states: { '[ ]': {}, '[as]': {} }, dependency: { satisfied_states: [] } };
const SM_V5 = { states: { '[ ]': {}, '[dd]': {}, '[im]': {}, '[ts]': {}, '[xx]': {} } };

// ---- 파일 -------------------------------------------------------------------

export const FILES = {
  'sm6/state-machine.json': JI(SM_V6),
  'smkr/state-machine.json': JI(SM_KR),
  'smempty/state-machine.json': JI(SM_EXPLICIT_EMPTY),
  'sm5/state-machine.json': JI(SM_V5),
  'smbad/state-machine.json': '{"states": ',
  'smbom/state-machine.json': `﻿${J(SM_V6)}`,
  'smcrlf/state-machine.json': JI(SM_V6).replace(/\n/g, '\r\n'),
  'nosm/.keep': '',
  'tasks-crlf.json': JI(SIMPLE).replace(/\n/g, '\r\n'),
  'tasks-bom.json': `﻿${JI(SIMPLE)}`,
  'tasks-empty.json': '',
  'tasks-ws.json': ' \n\t \n',
  'tasks-badjson.json': '[{"tsk_id": "A",}]',
  'tasks-simple.json': JI(SIMPLE),
  'tasks-simple-compact.json': J(SIMPLE),
  'tasks-done.json': JI(WITH_DONE),
  '한글/tasks-한글.json': JI(KOREAN),
  'dir.json/.keep': '',
};
for (const [name, items] of Object.entries(SHARED)) FILES[`in/${name}.json`] = JI(items);
for (const [name, items] of Object.entries(PY_TRACEBACK)) FILES[`in/${name}.json`] = JI(items);

// 실제 WBS 스냅숏과 그 변형
let snapshotItems = null;
try {
  snapshotItems = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
} catch {
  snapshotItems = null;
}
export const HAS_SNAPSHOT = Array.isArray(snapshotItems) && snapshotItems.length > 0;
const REAL = [];
if (HAS_SNAPSHOT) {
  const progress = (modes) => snapshotItems.map((it, i) => {
    const o = { ...it };
    if (modes.xx && i % 4 === 0) o.status = '[xx]';
    else if (modes.im && i % 7 === 0) o.status = '[im]';
    if (modes.bypass && i === 5) o.bypassed = true;
    if (modes.feat && i === 9) o.category = 'feat';
    return o;
  });
  FILES['real/mdm-tasks-all.json'] = fs.readFileSync(SNAPSHOT, 'utf8');
  FILES['real/mdm-progress.json'] = JI(progress({ xx: true, im: true, bypass: true, feat: true }));
  FILES['real/mdm-xx-only.json'] = JI(progress({ xx: true }));
  FILES['real/mdm-all-done.json'] = JI(snapshotItems.map((it) => ({ ...it, status: '[xx]' })));
  FILES['real/mdm-reversed.json'] = JI([...snapshotItems].reverse());
  FILES['real/mdm-half.json'] = JI(snapshotItems.filter((_, i) => i % 2 === 0));
  REAL.push('mdm-tasks-all', 'mdm-progress', 'mdm-xx-only', 'mdm-all-done', 'mdm-reversed', 'mdm-half');
}

// ---- CLI 케이스 ---------------------------------------------------------------

const BASE_ENV = {}; // 호출 쪽이 WBS_STATE_MACHINE·CLAUDE_PLUGIN_ROOT 를 비운 상태로 둔다
export const CLI_CASES = [];
const add = (c) => CLI_CASES.push({ env: BASE_ENV, ...c });

// 표준입력 + 파일 인자 + `-`, 기본·그래프 모드, 상태머신 없음·6상태 docs-dir
for (const name of [...Object.keys(SHARED), ...REAL.map((n) => `real:${n}`)]) {
  const isReal = name.startsWith('real:');
  const rel = isReal ? `real/${name.slice('real:'.length)}.json` : `in/${name}.json`;
  const diamonds = MULTI_MERGE_IDS.has(name) || isReal;
  // 실제 WBS 변형은 그래프 지표 출력이 커서(약 28KB) 기대값 파일이 부풀지 않도록 일부 조합만 둔다
  const graphFull = !isReal || name === 'real:mdm-tasks-all' || name === 'real:mdm-reversed';
  for (const gs of [false, true]) {
    if (isReal && gs && !graphFull) continue;
    const flag = gs ? ['--graph-stats'] : [];
    const compare = gs && GS_TRACEBACK.has(name) ? ['stdout', 'status'] : undefined;
    add({ id: `${rel} 파일${gs ? ' graph' : ''}`, args: [...flag, rel], diamonds, compare });
    if (!isReal || name === 'real:mdm-tasks-all' || (name === 'real:mdm-progress' && !gs)) {
      add({ id: `${rel} stdin${gs ? ' graph' : ''}`, args: [...flag], stdinFile: rel, diamonds, compare });
    }
  }
  add({ id: `${rel} 6상태 docs-dir`, args: ['--docs-dir', 'sm6', rel], diamonds });
  if (!isReal || name === 'real:mdm-progress') {
    add({ id: `${rel} 6상태 docs-dir graph`, args: [rel, '--graph-stats', '--docs-dir', 'sm6'], diamonds, compare: GS_TRACEBACK.has(name) ? ['stdout', 'status'] : undefined });
  }
}
for (const name of Object.keys(PY_TRACEBACK)) {
  for (const gs of [false, true]) {
    add({ id: `in/${name}.json${gs ? ' graph' : ''} (python traceback)`, args: [...(gs ? ['--graph-stats'] : []), `in/${name}.json`], compare: ['stdout', 'status'] });
  }
}

for (const name of ['sm5', 'smkr', 'smempty', 'nosm']) {
  for (const input of ['tasks-done.json', 'tasks-empty.json']) {
    add({ id: `docs-dir ${name} ${input}`, args: ['--docs-dir', name, input] });
    add({ id: `docs-dir ${name} ${input} graph`, args: ['--graph-stats', '--docs-dir', name, input] });
  }
}
for (const name of ['smbad', 'smbom', 'smcrlf']) {
  add({ id: `docs-dir ${name}`, args: ['--docs-dir', name, 'tasks-done.json'] });
  add({ id: `docs-dir ${name} 빈 입력`, args: ['--docs-dir', name, 'tasks-empty.json'] });
}
add({ id: 'docs-dir 6상태 상태 문자열 변형', args: ['--docs-dir', 'sm6', 'in/status-forms.json'] });
add({ id: 'docs-dir 한글 충족 상태', args: ['--docs-dir', 'smkr', 'in/status-forms.json'] });
add({ id: 'docs-dir 빈 충족 목록', args: ['--docs-dir', 'smempty', 'in/status-forms.json'] });
add({ id: 'docs-dir 6상태 done-mix', args: ['--docs-dir', 'sm6', 'in/done-mix.json'] });
add({ id: 'docs-dir 6상태 빈 입력 stdin', args: ['--docs-dir', 'sm6'], input: '' });
add({ id: 'docs-dir 한글 충족 빈 입력 stdin (ensure_ascii)', args: ['--docs-dir', 'smkr'], input: '' });
add({ id: 'WBS_STATE_MACHINE 환경 변수 6상태', args: ['in/done-mix.json'], env: { WBS_STATE_MACHINE: 'sm6/state-machine.json' } });
add({ id: 'WBS_STATE_MACHINE 환경 변수 한글', args: ['in/done-mix.json'], env: { WBS_STATE_MACHINE: 'smkr/state-machine.json' } });
add({ id: 'WBS_STATE_MACHINE 환경 변수는 --docs-dir 없으면 쓰지 않음', args: ['in/status-forms.json'], env: { WBS_STATE_MACHINE: 'smkr/state-machine.json' } });
add({ id: '--docs-dir 없는 폴더', args: ['--docs-dir', 'nope', 'in/done-mix.json'] });
add({ id: '--docs-dir 빈 문자열', args: ['--docs-dir', '', 'in/done-mix.json'] });
add({ id: '--docs-dir 점', args: ['--docs-dir', '.', 'in/done-mix.json'] });
add({ id: '--docs-dir 뒤에 값 없음', args: ['in/done-mix.json', '--docs-dir'] });
add({ id: '--docs-dir 만', args: ['--docs-dir'] });
add({ id: '--graph-stats 뒤 --docs-dir 값 없음', args: ['--docs-dir', '--graph-stats'] });
add({ id: '--docs-dir 값이 --graph-stats', args: ['in/done-mix.json', '--docs-dir', '--graph-stats'] });
add({ id: '--docs-dir 두 번(둘째는 파일 경로로 취급)', args: ['--docs-dir', 'sm6', '--docs-dir', 'sm5', 'in/done-mix.json'] });
add({ id: '--graph-stats 두 번', args: ['--graph-stats', 'in/diamond.json', '--graph-stats'] });
add({ id: '--graph-stats 가 파일 뒤', args: ['in/diamond.json', '--graph-stats'] });
add({ id: '--docs-dir 이 파일 뒤', args: ['in/done-mix.json', '--docs-dir', 'sm6'] });
add({ id: '--docs-dir=값 형태는 파일 경로로 취급', args: ['--docs-dir=sm6'] });
add({ id: '없는 파일', args: ['nope.json'] });
add({ id: '없는 파일 graph', args: ['--graph-stats', 'nope.json'] });
add({ id: '없는 한글 파일(출력은 그대로)', args: ['없음/없음.json'] });
add({ id: '폴더를 파일로', args: ['dir.json'] });
add({ id: '빈 문자열 파일', args: [''] });
add({ id: '--help 는 파일 경로로 취급', args: ['--help'] });
add({ id: '-h 는 파일 경로로 취급', args: ['-h'] });
add({ id: '알 수 없는 옵션은 파일 경로로 취급', args: ['--foo'] });
add({ id: '- 는 표준입력', args: ['-'], input: J(SIMPLE) });
add({ id: '- 와 --graph-stats', args: ['-', '--graph-stats'], input: J(SIMPLE) });
add({ id: '첫 인자가 - 이면 뒤 인자는 무시', args: ['-', 'nope.json'], input: J(SIMPLE) });
add({ id: '파일 둘이면 첫째만', args: ['tasks-simple.json', 'nope.json'] });
add({ id: '한글 경로', args: ['한글/tasks-한글.json'] });
add({ id: '한글 경로 graph', args: ['한글/tasks-한글.json', '--graph-stats'] });
add({ id: 'CRLF 파일', args: ['tasks-crlf.json'] });
add({ id: 'CRLF 파일 graph', args: ['--graph-stats', 'tasks-crlf.json'] });
add({ id: 'BOM 파일', args: ['tasks-bom.json'] });
add({ id: 'BOM 파일 graph', args: ['--graph-stats', 'tasks-bom.json'] });
add({ id: '빈 파일', args: ['tasks-empty.json'] });
add({ id: '빈 파일 graph', args: ['--graph-stats', 'tasks-empty.json'] });
add({ id: '공백뿐인 파일', args: ['tasks-ws.json'] });
add({ id: '공백뿐인 파일 graph', args: ['--graph-stats', 'tasks-ws.json'] });
add({ id: '잘못된 JSON 파일', args: ['tasks-badjson.json'] });
add({ id: '잘못된 JSON 파일 graph', args: ['--graph-stats', 'tasks-badjson.json'] });
add({ id: '압축 JSON 파일', args: ['tasks-simple-compact.json'] });

// [이름, 표준입력 본문, python 이 traceback 으로 끝나는지]
const STDIN_CASES = [
  ['빈 stdin', ''],
  ['공백 stdin', '  \n\t\r\n '],
  ['배열 []', '[]'],
  ['객체 {}', '{}'],
  ['객체 {"a":1}', '{"a":1}', true],
  ['빈 문자열 JSON', '""'],
  ['문자열 JSON', '"abc"', true],
  ['숫자 JSON', '5', true],
  ['null JSON', 'null', true],
  ['true JSON', 'true', true],
  ['배열 앞뒤 공백', '  \n [] \n '],
  ['BOM stdin', `﻿${J(SIMPLE)}`],
  ['BOM 뒤 공백', `﻿  ${J(SIMPLE)}`],
  ['전각 공백 둘러쌈', `　${J(SIMPLE)}　`],
  ['줄 구분자 U+2028 둘러쌈', ` ${J(SIMPLE)} `],
  ['NEL 둘러쌈', `\u0085${J(SIMPLE)}\u0085`],
  ['잘못된 JSON 쉼표', '[{"tsk_id": "A",}]'],
  ['잘못된 JSON 따옴표', "[{'tsk_id': 'A'}]"],
  ['잘못된 JSON 잘림', '[{"tsk_id": "A"'],
  ['잘못된 JSON 여분', '[] x'],
  ['잘못된 JSON 한글 위치', '[{"tsk_id": "가나다", "x": }]'],
  ['잘못된 JSON 줄바꿈 위치', '[\n  {"tsk_id": "A"},\n  {oops}\n]'],
  ['NaN depends', '[{"tsk_id": "A", "depends": NaN}]', true],
  ['Infinity 필드', '[{"tsk_id": "A", "n": Infinity}]'],
  ['CRLF stdin', JI(SIMPLE).replace(/\n/g, '\r\n')],
  ['유니코드 이스케이프 id', '[{"tsk_id": "\\u0041\\ud83d\\ude00", "depends": "-"}]'],
  ['큰 정수 필드', '[{"tsk_id": "A", "depends": "-", "n": 12345678901234567890}]'],
  ['소수 필드', '[{"tsk_id": "A", "depends": "-", "n": 1.5}]'],
  ['중복 키', '[{"tsk_id": "A", "tsk_id": "B", "depends": "-"}]'],
  ['키 없는 항목들', '[{}, {}, {"tsk_id": "A"}]'],
  ['중첩 배열', '[[{"tsk_id": "A"}]]', true],
];
for (const [id, text, tb] of STDIN_CASES) {
  for (const gs of [false, true]) {
    add({ id: `stdin ${id}${gs ? ' graph' : ''}`, args: gs ? ['--graph-stats'] : [], input: text, compare: tb ? ['stdout', 'status'] : undefined });
  }
}

export const DIAMOND_CASE_IDS = new Set(CLI_CASES.filter((c) => c.diamonds).map((c) => c.id));

/** 케이스 하나를 돌릴 인자·입력·환경(양쪽 공통). */
export function caseInput(c) {
  if (c.stdinFile) return FILES[c.stdinFile];
  return c.input;
}

/**
 * python 출력의 diamond_patterns 를 node 판의 순서로 바꾼다. python 은 같은 (apex, branches) 안에서 합류점(merge)을
 * set 교집합 순서(해시 무작위)로 내므로, 연속한 같은 (apex, branches) 묶음 안을 merge 코드포인트 순으로 정렬하면
 * node 판의 루프 순서와 정확히 같아진다. 나머지 바이트는 그대로 두고 비교하려고 python 쪽만 바꾼다.
 * 안전장치: 파싱한 값을 원래 방식(indent 2, ensure_ascii=False)으로 다시 직렬화해 원문과 같지 않으면(= 이 변환이 바이트를
 * 바꿀 수 있으면) 변환하지 않고 원문을 돌려준다 — 그러면 바이트 비교가 그대로 실패한다.
 */
export function toNodeDiamondOrder(pythonStdout, { pyJsonDumps, compareCodePoint }) {
  let obj;
  try {
    obj = JSON.parse(pythonStdout);
  } catch {
    return pythonStdout;
  }
  if (!obj || !Array.isArray(obj.diamond_patterns)) return pythonStdout;
  const dump = (v) => `${pyJsonDumps(v, { indent: 2, ensureAscii: false })}\n`;
  if (dump(obj) !== pythonStdout) return pythonStdout;
  const out = [];
  let i = 0;
  const list = obj.diamond_patterns;
  while (i < list.length) {
    let j = i + 1;
    const key = JSON.stringify([list[i].apex, list[i].branches]);
    while (j < list.length && JSON.stringify([list[j].apex, list[j].branches]) === key) j++;
    out.push(...list.slice(i, j).sort((x, y) => compareCodePoint(x.merge, y.merge)));
    i = j;
  }
  obj.diamond_patterns = out;
  return dump(obj);
}
