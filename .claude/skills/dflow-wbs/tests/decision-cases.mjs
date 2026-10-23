// decision-cases.mjs — decision-log 골든·기대값·교차 시험이 함께 쓰는 사례 목록.
// 사례 모양과 정규화 규칙은 case-runner.mjs 머리말 참고. 시각(`<TS>`)은 출력에서 지우고 비교한다.
// 시험 시점의 python 판 결과는 golden/expected/decision-log.json 에 박혀 있고, make-expected-decision-prd.mjs 가 만든다.

const T = '{ROOT}/docs/tasks/TSK-01';
const DEC = 'decisions.md';

const entry = (id, ts, fields) =>
  `## D-${id} (${ts})\n` + Object.entries(fields).map(([k, v]) => `- **${k}**: ${v}`).join('\n') + '\n';
const ok4 = { Phase: 'design', 'Decision needed': 'n', 'Decision made': 'm', Rationale: 'r' };
const HEADER = '# Decisions Log — TSK-01\n\n> Append-only audit trail of autonomous decisions made during DDTR/feat/wbs cycles.\n> Edit prior entries forbidden — record reversals as new entries instead.\n\n';

/** append 인자. extra 로 옵션을 덧붙이거나 base 로 필수 값을 바꾼다. */
export function ap(target, extra = [], base = {}) {
  const b = { phase: 'design', needed: 'N', made: 'M', rationale: 'R', ...base };
  return ['append', '--target', target, '--phase', b.phase, '--decision-needed', b.needed, '--decision-made', b.made, '--rationale', b.rationale, ...extra];
}
const step = (args, extra = {}) => ({ args, ...extra });
/** 마지막에 읽기 명령 두 개(list·validate)를 붙인다 — 기대값 "읽기 확인" 시험이 이 꼬리를 다시 돌린다. */
const fin = (target, impls = [undefined, undefined]) => [
  step(['list', '--target', target], { impl: impls[0] }),
  step(['validate', '--target', target], { impl: impls[1] }),
];

const dir = (rel) => `{ROOT}/${rel}`;

export const CASES = [
  // --- append: 새 파일·라벨 도출 ---
  { id: 'append: 새 파일(tasks 라벨)', steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: features 라벨', steps: [step(ap(dir('docs/features/auth'))), ...fin(dir('docs/features/auth'))] },
  { id: 'append: 프로젝트 라벨(docs)', steps: [step(ap(dir('docs'))), ...fin(dir('docs'))] },
  { id: 'append: tasks 가 마지막 성분이면 features 로(없으면 project)', steps: [step(ap(dir('proj/tasks'))), ...fin(dir('proj/tasks'))] },
  { id: 'append: tasks 와 features 가 모두 있으면 tasks 우선', steps: [step(ap(dir('features/x/tasks/TSK-9'))), ...fin(dir('features/x/tasks/TSK-9'))] },
  { id: 'append: tasks 가 두 번이면 첫 번째', steps: [step(ap(dir('tasks/a/tasks/b'))), ...fin(dir('tasks/a/tasks/b'))] },
  { id: 'append: features 가 마지막 성분이면 project', steps: [step(ap(dir('docs/features'))), ...fin(dir('docs/features'))] },
  { id: 'append: --scope-label 로 라벨 덮어쓰기(한글)', steps: [step(ap(T, ['--scope-label', '라벨 재정의 — ✓'])), ...fin(T)] },
  { id: 'append: --scope-label 빈 문자열은 도출 라벨로', steps: [step(ap(T, ['--scope-label', ''])), ...fin(T)] },
  { id: 'append: 한글 디렉터리 이름·이모지 본문', steps: [step(ap(dir('docs/tasks/작업-가나다'), [], { needed: '결정 😀 필요', made: '결정 ✓', rationale: '근거 한글 ①②' })), ...fin(dir('docs/tasks/작업-가나다'))] },
  { id: 'append: 선택 필드 reversible=no·source', steps: [step(ap(T, ['--reversible', 'no', '--source', 'src/a.ts:12'])), ...fin(T)] },
  { id: 'append: source 에 한글·콜론·공백', steps: [step(ap(T, ['--source', '파일: 위치 abc  def'])), ...fin(T)] },
  { id: 'append: 여러 번 이어 붙임(번호 증가·선택 필드 섞임)', steps: [
    step(ap(T)),
    step(ap(T, ['--reversible', 'yes'], { phase: 'build' })),
    step(ap(T, ['--source', 's'], { phase: 'test' })),
    step(ap(T, ['--reversible', 'no', '--source', 'x'], { phase: 'wbs-resolve' })),
    ...fin(T),
  ] },
  { id: 'append: 모든 phase', steps: [
    ...['design', 'build', 'test', 'refactor', 'wbs', 'wbs-resolve', 'feat-intake', 'prd-resolve', 'dev-team-merge'].map((p) => step(ap(T, [], { phase: p }))),
    ...fin(T),
  ] },
  { id: 'append: 12건이면 D-012', steps: [...Array.from({ length: 12 }, () => step(ap(T))), ...fin(T)] },

  // --- append: 기존 파일 위에 ---
  { id: 'append: 끝 개행 없는 기존 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('001', '2026-01-01T00:00:00Z', ok4).trimEnd() }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 번호가 건너뛴 기존 파일은 최댓값+1', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('001', '2026-01-01T00:00:00Z', ok4) + '\n' + entry('003', '2026-01-02T00:00:00Z', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 순서가 뒤섞이고 0 이 앞선 번호(D-0007)', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('0007', '2026-01-01T00:00:00Z', ok4) + '\n' + entry('002', '2026-01-02T00:00:00Z', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 큰 번호(D-998 → D-999 → D-1000)', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('998', 'x', ok4) }, steps: [step(ap(T)), step(ap(T)), ...fin(T)] },
  { id: 'append: 빈 decisions.md', files: { [`docs/tasks/TSK-01/${DEC}`]: '' }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 개행만 있는 decisions.md', files: { [`docs/tasks/TSK-01/${DEC}`]: '\n\n' }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 머리글만 있는 기존 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: CRLF 기존 파일(LF 로 정규화되어 다시 쓰임)', files: { [`docs/tasks/TSK-01/${DEC}`]: (HEADER + entry('001', '2026-01-01T00:00:00Z', ok4)).replace(/\n/g, '\r\n') }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 낱개 CR 줄끝 기존 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: (HEADER + entry('001', '2026-01-01T00:00:00Z', ok4)).replace(/\n/g, '\r') }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: BOM 으로 시작하는 기존 파일(첫 블록이 머리글 줄 뒤에 있음)', files: { [`docs/tasks/TSK-01/${DEC}`]: '﻿' + HEADER + entry('001', '2026-01-01T00:00:00Z', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: BOM 바로 뒤가 블록 머리인 파일(첫 블록을 못 알아봄)', files: { [`docs/tasks/TSK-01/${DEC}`]: '﻿' + entry('001', '2026-01-01T00:00:00Z', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 전각 숫자 번호(D-００２)도 번호로 읽음', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('００２', 'x', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 아랍 인도 숫자 번호', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('٣', 'x', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 수학 굵은 숫자 번호(비 BMP)', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('\u{1D7D1}', 'x', ok4) }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 머리 줄 끝 공백·유니코드 공백', files: { [`docs/tasks/TSK-01/${DEC}`]: `${HEADER}## D-001 (t)  　\n- **Phase**: design\n` }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 머리 줄 뒤 U+2028(python 의 \\s 는 먹음)', files: { [`docs/tasks/TSK-01/${DEC}`]: `${HEADER}## D-001 (t) \n- **Phase**: design\n` }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 머리 형식이 아닌 줄만 있는 기존 파일(번호 1부터)', files: { [`docs/tasks/TSK-01/${DEC}`]: '# 메모\n\n## D-1 (x) 뒤에 글자\n##D-002 (x)\n' }, steps: [step(ap(T)), ...fin(T)] },
  { id: 'append: 상대 경로 target(cwd=저장소)', steps: [step(ap('docs/tasks/TSK-07')), step(ap('docs/tasks/TSK-07')), ...fin('docs/tasks/TSK-07')] },
  { id: 'append: ./·// 가 섞인 target', steps: [step(ap('./docs//tasks/./TSK-08/')), ...fin('docs/tasks/TSK-08')] },
  { id: 'append: 빈 문자열 target 은 현재 폴더', steps: [step(ap('')), step(['list', '--target', '']), step(['validate', '--target', ''])] },
  { id: 'append: .. 가 든 target(경로 문자열은 그대로 출력)', steps: [step(ap('docs/x/../tasks/TSK-09')), ...fin('docs/tasks/TSK-09')] },
  { id: 'append: cwd 를 하위 폴더로, target 은 .', files: { 'work/tasks/keep.txt': '' }, steps: [step(ap('.'), { cwd: 'work/tasks' }), step(['list', '--target', '.'], { cwd: 'work/tasks' })] },
  { id: 'append: 값에 개행이 든 경우(형식이 깨지지만 같게)', steps: [step(ap(T, [], { needed: '첫줄\n## D-009 (x)\n- **Phase**: bad' })), ...fin(T)] },
  { id: 'append: 값 앞뒤 공백 보존', steps: [step(ap(T, [], { needed: '  앞뒤  ', made: '\tM\t', rationale: ' R ' })), ...fin(T)] },
  { id: 'append: 값이 - 로 시작(공백 포함)', steps: [step(ap(T, [], { needed: '- 항목 하나', made: '-> 화살표 결정', rationale: '--rationale 같은 문구 포함' })), ...fin(T)] },
  { id: 'append: 값이 음수 모양(-1)', steps: [step(ap(T, [], { needed: '-1', made: '-2.5', rationale: '-.5' })), ...fin(T)] },
  { id: 'append: 값이 - 한 글자', steps: [step(ap(T, [], { needed: '-', made: '-', rationale: '-' })), ...fin(T)] },
  { id: 'append: --옵션=값 형태(값에 = 와 - 시작 허용)', steps: [step(['append', `--target=${T}`, '--phase=build', '--decision-needed=a=b', '--decision-made=- c d', '--rationale=r']), ...fin(T)] },
  { id: 'append: --rationale= 빈 값은 오류', steps: [step(['append', `--target=${T}`, '--phase=build', '--decision-needed=a', '--decision-made=b', '--rationale='])] },
  { id: 'append: 옵션 접두 축약(--decision-n, --rat, --rev)', steps: [step(['append', '--target', T, '--phase', 'test', '--decision-n', 'a', '--decision-m', 'b', '--rat', 'c', '--rev', 'yes', '--sou', 'z']), ...fin(T)] },
  { id: 'append: 모호한 접두 축약(--decision)은 사용 오류', steps: [step(['append', '--target', T, '--phase', 'test', '--decision', 'a', '--decision-made', 'b', '--rationale', 'c'], { statusOnly: true })] },

  // --- append: 오류 ---
  { id: 'append 오류: 빈 decision-needed', steps: [step(ap(T, [], { needed: '' })), ...fin(T)] },
  { id: 'append 오류: 공백뿐인 decision-made', steps: [step(ap(T, [], { made: '   \t' })), ...fin(T)] },
  { id: 'append 오류: 전각 공백뿐인 rationale', steps: [step(ap(T, [], { rationale: '　　' })), ...fin(T)] },
  { id: 'append 오류: python 만 공백으로 보는 \\x1c·\\x85 뿐인 값', steps: [step(ap(T, [], { rationale: '\x1c\x85' })), ...fin(T)] },
  { id: 'append: JS 만 공백으로 보는 U+FEFF 뿐인 값은 통과', steps: [step(ap(T, [], { rationale: '﻿' })), ...fin(T)] },
  { id: 'append 오류: 오류 뒤 다시 정상 append', steps: [step(ap(T, [], { needed: ' ' })), step(ap(T)), ...fin(T)] },
  { id: '사용 오류: 알 수 없는 phase', steps: [step(ap(T, [], { phase: 'deploy' }), { statusOnly: true })] },
  { id: '사용 오류: 잘못된 reversible', steps: [step(ap(T, ['--reversible', 'maybe']), { statusOnly: true })] },
  { id: '사용 오류: target 없음', steps: [step(['append', '--phase', 'design', '--decision-needed', 'a', '--decision-made', 'b', '--rationale', 'c'], { statusOnly: true })] },
  { id: '사용 오류: rationale 값이 없음', steps: [step(['append', '--target', T, '--phase', 'design', '--decision-needed', 'a', '--decision-made', 'b', '--rationale'], { statusOnly: true })] },
  { id: '사용 오류: -x 로 시작하는 값(공백 없음)', steps: [step(ap(T, [], { rationale: '-foo' }), { statusOnly: true })] },
  { id: '사용 오류: 알 수 없는 옵션', steps: [step(ap(T, ['--nope', '1']), { statusOnly: true })] },
  { id: '사용 오류: 명령 없음', steps: [step([], { statusOnly: true })] },
  { id: '사용 오류: 알 수 없는 명령', steps: [step(['bogus'], { statusOnly: true })] },
  { id: '사용 오류: list 에 target 없음', steps: [step(['list'], { statusOnly: true })] },
  { id: '사용 오류: validate 에 남는 인자', steps: [step(['validate', '--target', T, 'extra'], { statusOnly: true })] },
  { id: '도움말: -h 는 종료 코드 0', steps: [step(['-h'], { statusOnly: true }), step(['append', '-h'], { statusOnly: true })] },
  { id: '실패: target 이 이미 파일', files: { 'docs/tasks/TSK-01': 'x' }, steps: [step(ap(T), { statusOnly: true })] },
  { id: '실패: decisions.md 가 폴더', files: { [`docs/tasks/TSK-01/${DEC}/keep`]: 'x' }, steps: [step(ap(T), { statusOnly: true }), step(['list', '--target', T], { statusOnly: true }), step(['validate', '--target', T], { statusOnly: true })] },

  // --- list · validate (읽기 전용) ---
  { id: '읽기: 파일 없음', steps: [...fin(T)] },
  { id: '읽기: 빈 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: '' }, steps: [...fin(T)] },
  { id: '읽기: 정상 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('001', '2026-01-01T00:00:00Z', { ...ok4, Reversible: 'yes', Source: 'a.ts:1' }) + '\n' + entry('002', '2026-01-02T00:00:00Z', { ...ok4, Phase: 'wbs' }) }, steps: [...fin(T)] },
  { id: '읽기: 번호 끊김·중복·역순', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('002', 'a', ok4) + '\n' + entry('002', 'b', ok4) + '\n' + entry('001', 'c', ok4) + '\n' + entry('005', 'd', ok4) }, steps: [...fin(T)] },
  { id: '읽기: 필수 필드 누락(여러 개)·정렬', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { Phase: 'design' }) + '\n' + entry('002', 't', { Rationale: 'r', 'Decision made': 'm' }) + '\n' + entry('003', 't', {}) }, steps: [...fin(T)] },
  { id: '읽기: phase 화이트리스트 위반·빈 phase', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { ...ok4, Phase: 'deploy' }) + '\n' + entry('002', 't', { ...ok4, Phase: '' }) + '\n' + entry('003', 't', { ...ok4, Phase: '  design  ' }) }, steps: [...fin(T)] },
  { id: '읽기: reversible 위반(대소문자·공백·따옴표)', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { ...ok4, Reversible: 'Yes' }) + '\n' + entry('002', 't', { ...ok4, Reversible: " 'no' " }) + '\n' + entry('003', 't', { ...ok4, Reversible: 'no' }) + '\n' + entry('004', 't', { ...ok4, Reversible: '' }) }, steps: [...fin(T)] },
  { id: '읽기: 필드 키 변형(ID·Timestamp 가 id·timestamp 를 덮어씀·공백→밑줄)', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 'ts1', { ...ok4, ID: 'zzz', Timestamp: 'overridden', 'Some Other Key': 'v', 'ÄÖ İ Key': 'turk', 'a  b': 'two spaces', '1': 'numeric key', '10': 'ten', '2': 'two' }) }, steps: [...fin(T)] },
  { id: '읽기: 같은 키가 두 번(뒤가 이김·위치는 앞)', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Phase**: design\n- **Decision needed**: a\n- **Phase**: build\n- **Decision made**: m\n- **Rationale**: r\n' }, steps: [...fin(T)] },
  { id: '읽기: 필드 값 공백·유니코드 공백 다듬기', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Phase**:   design 　\n- **Decision needed**:  n \n- **Decision made**: \x1cm\x1f\n- **Rationale**:\x85r\x85\n' }, steps: [...fin(T)] },
  { id: '읽기: 값이 비어 있음·다음 줄로 넘어감(\\s 가 줄바꿈을 먹음)', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Phase**:\n- **Decision needed**: n\n- **Decision made**:\n\n- **Rationale**: r\n- **Reversible**:\n' }, steps: [...fin(T)] },
  { id: '읽기: 키에 *·줄바꿈이 든 모양', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Pha\nse**: x\n- **A*B**: y\n- ** **: z\n- **K**:no space\n- **K2** : spaced colon\n-  **K3**: two spaces\n  - **K4**: indented\n' }, steps: [...fin(T)] },
  { id: '읽기: 블록 안의 일반 문장·표·코드 펜스', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Phase**: design\n- **Decision needed**: n\n- **Decision made**: m\n- **Rationale**: r\n\n본문 문장입니다.\n\n```\n## D-002 (fake)\n- **Phase**: x\n```\n' }, steps: [...fin(T)] },
  { id: '읽기: 머리 시각 자리에 괄호·한글', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (2026-10-07 (KST) 오전)\n- **Phase**: design\n## D-002 (한글 시각)\n- **Phase**: build\n## D-003 ()\n' }, steps: [...fin(T)] },
  { id: '읽기: 머리 시각에 개행이 든 모양([^)]+ 가 줄바꿈을 먹음)', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (a\nb)\n- **Phase**: design\n' }, steps: [...fin(T)] },
  { id: '읽기: 임시 ID 머리(D-TSK-…)는 블록으로 안 봄', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('001', 't', ok4) + '\n## D-TSK-01-02-1 (t)\n- **Phase**: design\n- **Temp ID**: x\n' }, steps: [...fin(T)] },
  { id: '읽기: CRLF·BOM·한글 섞인 파일', files: { [`docs/tasks/TSK-01/${DEC}`]: ('﻿' + HEADER + entry('001', 't', { ...ok4, 'Decision needed': '한글 😀' }) + '\n' + entry('002', 't', ok4)).replace(/\n/g, '\r\n') }, steps: [...fin(T)] },
  { id: '읽기: 단일 phase 값에 정규식 특수문자', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { ...ok4, Phase: "bu'ild", 'Decision needed': '\\n "q"' }) + '\n' + entry('002', 't', { ...ok4, Phase: 'a"b\'c' }) }, steps: [...fin(T)] },
  { id: '읽기: 비 ASCII 가 든 오류 문구(ensure_ascii=False)', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { ...ok4, Phase: '설계', Reversible: '예' }) }, steps: [...fin(T)] },
  { id: '읽기: 비 BMP 문자·U+2028 이 든 값(JSON 출력)', files: { [`docs/tasks/TSK-01/${DEC}`]: entry('001', 't', { ...ok4, 'Decision needed': '😀 a b \u007f' }) }, steps: [...fin(T)] },
  { id: '읽기: 필드 값 안의 줄 경계 문자(\\x0b \\x0c)', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **Phase**: design\x0b\n- **Decision needed**: n\x0c x\n- **Decision made**: m\n- **Rationale**: r\n' }, steps: [...fin(T)] },
  { id: '읽기: 수정 가능한 필드 이름 대소문자(phase 소문자)', files: { [`docs/tasks/TSK-01/${DEC}`]: '## D-001 (t)\n- **phase**: design\n- **decision needed**: n\n' }, steps: [...fin(T)] },

  // --- 교차 실행: python 이 쓴 파일을 node 가, node 가 쓴 파일을 python 이 읽기·이어 쓰기 ---
  { id: '교차: python append → node list·validate', steps: [step(ap(T), { impl: 'py' }), step(ap(T, ['--reversible', 'yes', '--source', 's'], { phase: 'build' }), { impl: 'py' }), ...fin(T, ['node', 'node'])] },
  { id: '교차: node append → python list·validate', steps: [step(ap(T), { impl: 'node' }), step(ap(T, ['--reversible', 'no'], { phase: 'test' }), { impl: 'node' }), ...fin(T, ['py', 'py'])] },
  { id: '교차: python·node 번갈아 append 후 양쪽이 읽기', steps: [
    step(ap(T, [], { needed: '첫째 한글' }), { impl: 'py' }),
    step(ap(T, ['--source', 'a:1'], { phase: 'build' }), { impl: 'node' }),
    step(ap(T, ['--reversible', 'yes'], { phase: 'test', rationale: '- 셋째' }), { impl: 'py' }),
    step(ap(T, ['--scope-label', '무시됨(파일이 이미 있음)'], { phase: 'refactor' }), { impl: 'node' }),
    step(ap(T, [], { phase: 'wbs', made: '😀 다섯째' }), { impl: 'py' }),
    step(ap(T, [], { phase: 'feat-intake' }), { impl: 'node' }),
    ...fin(T, ['py', 'py']),
    ...fin(T, ['node', 'node']),
  ] },
  { id: '교차: node 먼저 시작해 python 이 이어 붙임(feature 라벨)', steps: [
    step(ap(dir('docs/features/auth')), { impl: 'node' }),
    step(ap(dir('docs/features/auth'), [], { phase: 'build' }), { impl: 'py' }),
    step(ap(dir('docs/features/auth'), [], { phase: 'test' }), { impl: 'node' }),
    ...fin(dir('docs/features/auth'), ['node', 'py']),
  ] },
  { id: '교차: CRLF 로 저장된 파일에 번갈아 append', files: { [`docs/tasks/TSK-01/${DEC}`]: (HEADER + entry('001', '2026-01-01T00:00:00Z', ok4)).replace(/\n/g, '\r\n') }, steps: [
    step(ap(T), { impl: 'node' }), step(ap(T), { impl: 'py' }), ...fin(T, ['py', 'node']),
  ] },
  { id: '교차: 끝 개행 없는 파일에 번갈아 append', files: { [`docs/tasks/TSK-01/${DEC}`]: HEADER + entry('001', '2026-01-01T00:00:00Z', ok4).trimEnd() }, steps: [
    step(ap(T), { impl: 'py' }), step(ap(T), { impl: 'node' }), ...fin(T, ['node', 'py']),
  ] },
];

/** 같은 저장소 안에서 두 도구를 번갈아 쓰는 사례만(교차 실행 대상). */
export const CROSS_CASES = CASES.filter((c) => c.steps.some((s) => s.impl));

/** node 판 문구 → python 판 문구로 되돌리는 변환(의도한 차이가 없어 항등). */
export const fromNode = (t) => t;
