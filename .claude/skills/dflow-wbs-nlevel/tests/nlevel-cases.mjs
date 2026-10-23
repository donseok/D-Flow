// nlevel-cases.mjs — wbs-nlevel-parse 시험용 입력(문서)과 케이스 목록.
//  - PL_MD: 원본 python 시험(test_wbs_nlevel_parse.py)의 샘플 문서.
//  - buildSynthetic(): 경계 입력 문서(fold, 마일스톤, 토큰, 빈 파일, CRLF, BOM, 펜스 코드 블록, 한글, 잘못된 ID, 깊은 단계 …)
//    와 그 문서마다 돌릴 명령(validate 2역할 + export 3방식), 인자 해석 케이스.
//  문서 값은 문자열(UTF-8 로 기록) 또는 Buffer(바이트 그대로 — UTF-8 아닌 입력).
//  케이스: { id, args }  (cwd 는 문서를 쓴 임시 폴더. 경로는 그 폴더 기준 상대 경로)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 동결한 실제 문서 사본(skeleton-sample.md = 스킬 references 사본, contract-sample.md = 계약 문서의 샘플 wbs.md) */
export const INPUTS_DIR = path.join(HERE, 'golden', 'inputs');

export const LEVELS7 = `levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }
`;

export const CREDITS = `credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
`;

export const PL_MD = `---
project: MES
module: mes-op
attach: PH-03/SYS-OP

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: WP,        prefix: WP,  progress: rollup, report: weekly }
  - { name: Activity,  prefix: ACT, progress: rollup, optional: true }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }

credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
  if:      { 대기: 0, 구현중: 30, 구현완료: 50, 연동검증: 100 }
---

# WBS — MES 조업

## SUB-OP-IN: 입측

### WP-OP-IN-PR: 프로세스
- [ ] TSK-OP-IN-PR-01: 입측 실적 수집 프로세스   @홍길동  w:5  ~2026-11-14
  - category: dev
  - domain: backend
  - priority: critical
  - tags: op, entry
  - depends: TSK-OP-IN-PR-02
  - prd-ref: OP-PRD §4.2
  - requirements: L2 인입 통보 시 실적 생성.
  - acceptance: 단일 트랜잭션 / 중복 수신 멱등
  - [ ] STK-OP-IN-PR-01-1: 크레인 계량 연계 확인
  - [x] STK-OP-IN-PR-01-2: 중복 수신 방어 로직
- [ ] TSK-OP-IN-PR-02: 입측 판정 프로세스   w:3  ~2026-11-21  credit:if  if-id:IF-0031
- [M] TSK-OP-IN-PR-90: 입측 오픈 점검   ~2026-11-30
`;

/** 스킬 references/skeleton-sample.md 와 같은 골격 문서(동결 사본은 tests/golden/inputs/ 에 있다). */
export const SKEL_MIN = `---
project: MES
module: mes-skel
start_date: 2026-09-01
${LEVELS7}
${CREDITS}---

## PH-01: 분석
### WP-AN-AS: 현행 분석
- [ ] TSK-AN-AS-01: 전사 현행 분석서   w:10  ~2026-09-12  credit:default

## PH-03: 구축
### SYS-OP: 조업
`;

const doc = (front, body) => `---\n${front}\n---\n${body}`;
const PL_FRONT = `project: MES\nmodule: mes-op\nattach: PH-03/SYS-OP\n${LEVELS7}\n${CREDITS}`;
const SK_FRONT = `project: MES\nmodule: mes-skel\nstart_date: 2026-09-01\n${LEVELS7}\n${CREDITS}`;
const plDoc = (body, front = PL_FRONT) => doc(front, body);
const skDoc = (body, front = SK_FRONT) => doc(front, body);

const WP = '### WP-OP-A: 묶음\n';

/** 8단 이상 깊은 단계 */
const LEVELS8 = `levels:
  - { name: L0, prefix: A0, progress: rollup }
  - { name: L1, prefix: A1, progress: rollup }
  - { name: L2, prefix: A2, progress: rollup }
  - { name: L3, prefix: A3, progress: rollup }
  - { name: L4, prefix: A4, progress: rollup }
  - { name: L5, prefix: A5, progress: rollup, optional: true }
  - { name: L6, prefix: A6, progress: input }
  - { name: L7, prefix: A7, progress: checklist, upload: fold }
`;

/** 문서 이름 → 내용 */
export function docs() {
  const d = {};
  d['pl-main'] = PL_MD;
  d['skel-min'] = SKEL_MIN;

  // ── 정상 변형
  d['pl-crlf'] = PL_MD.replace(/\n/g, '\r\n');
  d['pl-cr-only'] = PL_MD.replace(/\n/g, '\r');
  d['pl-bom'] = `﻿${PL_MD}`;
  d['pl-bom-crlf'] = `﻿${PL_MD.replace(/\n/g, '\r\n')}`;
  d['pl-no-trailing-newline'] = PL_MD.trimEnd();
  d['pl-fence-block'] = plDoc(`${WP}\`\`\`markdown\n## SUB-OP-FENCE: 펜스 안의 헤딩\n- [ ] TSK-OP-FENCE-01: 펜스 안의 항목   w:1  ~2026-12-01\n\`\`\`\n- [ ] TSK-OP-A-01: 펜스 밖   w:1  ~2026-12-02\n`);
  d['pl-comment-multi'] = plDoc(`<!-- 한 줄 주석 -->\n## SUB-OP-C: 주석 시험\n<!--\n여러 줄 주석\n- [ ] TSK-OP-HID-01: 보이면 안 됨\n-->\n${WP}- [ ] TSK-OP-A-01: 주석 뒤   w:2  ~2026-12-02\n  <!-- 들여쓴 주석 -->\n  - category: dev\n`);
  d['pl-comment-unterminated'] = plDoc(`## SUB-OP-C: 닫히지 않은 주석\n<!-- 끝나지 않음\n${WP}- [ ] TSK-OP-A-01: 안 보임   w:2  ~2026-12-02\n`);
  d['pl-hangul'] = plDoc(`## SUB-OP-한글: 한글 제목 ☃ 😀\n${WP}- [ ] TSK-OP-A-01: 한글·English 혼합 제목 😀   @김철수  w:2.5  ~2026-12-02\n  - requirements: 한글 요건 "따옴표" \\ 역슬래시 / 탭\t포함\n  - acceptance: 첫째 / 둘째 /   / 셋째\n  - tags: 가, 나 ,, 다\n`);
  d['pl-hangul-id'] = plDoc(`## SUB-조업: 한글 ID 는 ID 규칙(A-Z 시작)에 맞지 않음\n## sub-op-lower: 소문자 ID\n## SUB-OP-OK: 정상\n${WP}- [ ] TSK-한글-01: 한글 ID 체크 항목\n- [ ] tsk-op-01: 소문자 체크 항목\n- [ ] TSK-OP-A-01: 정상   w:1  ~2026-12-02\n`);
  d['pl-bad-ids'] = plDoc(`## SUB-OP-X:제목 콜론 뒤 공백 없음\n## SUB-OP-Y : 콜론 앞 공백\n## 1SUB: 숫자 시작\n## SUB-OP-Z: 정상\n- [ ] 체크 항목에 ID 없음\n- [ ] TSK--01: 하이픈 두 개\n- [x] TSK-OP-Q: 체크 상태 x 비 checklist\n- [m] TSK-OP-R: 소문자 m 은 체크박스 아님\n`);
  d['pl-tokens'] = plDoc(`## SUB-OP-T: 토큰\n${WP}- [ ] TSK-OP-A-01: 범위 2026-09-01~2026-09-03 다음   @a  w:3  credit:if  if-id:IF-1\n- [ ] TSK-OP-A-02: 범위 공백 2026-09-01  ~  2026-09-03\n- [ ] TSK-OP-A-03: 범위와 종료 단독 2026-09-01~2026-09-03 ~2026-10-01\n- [ ] TSK-OP-A-04: 담당 둘 @aa @bb  w:1  w:2  ~2026-11-02\n- [ ] TSK-OP-A-05: 토큰 없음\n- [ ] TSK-OP-A-06: 무게 w:0  ~2026-11-02\n- [ ] TSK-OP-A-07: 무게 w:007  ~2026-11-02\n- [ ] TSK-OP-A-08: 무게 w:0.00001  ~2026-11-02\n- [ ] TSK-OP-A-09: 무게 w:12345678901234567890  ~2026-11-02\n- [ ] TSK-OP-A-10: 무게 w:5.  ~2026-11-02\n- [ ] TSK-OP-A-11: 무게 w:.5  ~2026-11-02\n- [ ] TSK-OP-A-12: 무게 w:0.1  ~2026-11-02\n- [ ] TSK-OP-A-13: 무게 w:100000000000000000000.0  ~2026-11-02\n- [ ] TSK-OP-A-14: 뒤에 붙은~2026-11-02\n- [ ] TSK-OP-A-15: 미정의 credit credit:zzz  ~2026-11-03\n- [ ] TSK-OP-A-16: 이메일 a@b.c  ~2026-11-03\n- [ ] TSK-OP-A-17:    공백   많은     제목   ~2026-11-03\n`);
  d['pl-weight-bad-dots'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 점 두 개 w:1.2.3  ~2026-11-02\n`);
  d['pl-weight-only-dot'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 점만 w:.  ~2026-11-02\n`);
  d['pl-weight-huge'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 아주 큼 w:${'9'.repeat(400)}  ~2026-11-02\n`);
  d['pl-weight-unicode-digits'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 전각 w:５  ~2026-11-02\n- [ ] TSK-OP-A-02: 아랍 인도 w:٣.٥  ~2026-11-02\n`);
  d['pl-date-unicode'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 전각 날짜 ~２０２６-１１-０２\n- [ ] TSK-OP-A-02: 선행 depends 확인 ~2026-12-02\n  - depends: TSK-OP-A-01\n`);
  d['pl-date-invalid-feb30'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 날짜 이상 ~2026-02-30\n- [ ] TSK-OP-A-02: 후속 ~2026-12-02\n  - depends: TSK-OP-A-01\n`);
  d['pl-date-invalid-month13'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 13월 ~2026-13-01\n- [ ] TSK-OP-A-02: 후속 ~2026-12-02\n  - depends: TSK-OP-A-01\n`);
  d['pl-date-year0000'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 0 년 ~0000-01-01\n- [ ] TSK-OP-A-02: 후속 ~2026-12-02\n  - depends: TSK-OP-A-01\n`);
  d['pl-date-year9999-overflow'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 끝 ~9999-12-31\n- [ ] TSK-OP-A-02: 후속 ~9999-12-31\n  - depends: TSK-OP-A-01\n`);
  d['pl-date-leap-weekend'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 금요일 ~2028-02-25\n- [ ] TSK-OP-A-02: 윤년 다음 영업일 ~2028-03-31\n  - depends: TSK-OP-A-01\n- [ ] TSK-OP-A-03: 윤일 ~2028-02-29\n- [ ] TSK-OP-A-04: 윤일 뒤 ~2028-04-01\n  - depends: TSK-OP-A-03\n- [ ] TSK-OP-A-05: 연말 ~2026-12-31\n- [ ] TSK-OP-A-06: 연말 뒤 ~2027-01-29\n  - depends: TSK-OP-A-05\n- [ ] TSK-OP-A-07: 토요일 ~2026-09-05\n- [ ] TSK-OP-A-08: 토요일 뒤 ~2026-09-30\n  - depends: TSK-OP-A-07\n- [ ] TSK-OP-A-09: 여러 선행 ~2026-12-30\n  - depends: TSK-OP-A-05, TSK-OP-A-07, TSK-OP-A-03\n- [ ] TSK-OP-A-10: 선행 끝 없음 ~2026-12-30\n  - depends: TSK-OP-A-05, TSK-OP-NOPE\n- [ ] TSK-OP-A-11: 선행 종료 없음(날짜 없는 노드) ~2026-12-30\n  - depends: TSK-OP-A-12\n- [ ] TSK-OP-A-12: 날짜 없음\n- [M] TSK-OP-A-13: 마일스톤 선행 있음 ~2026-12-30\n  - depends: TSK-OP-A-05\n`);
  d['pl-start-date-alt'] = skDoc(`${WP.replace('WP-OP-A', 'WP-A')}- [ ] TSK-A-01: 시작일 파생 ~2026-09-05\n- [ ] TSK-A-02: 시작일 파생 ~2026-08-30\n`, 'project: MES\nmodule: mes-skel\nstart-date: 2026-09-01\n' + LEVELS7);
  d['pl-start-date-empty-underscore'] = skDoc(`${WP.replace('WP-OP-A', 'WP-A')}- [ ] TSK-A-01: 시작일 파생 ~2026-09-05\n`, 'project: MES\nmodule: mes-skel\nstart_date:\nstart-date: 2026-09-02\n' + LEVELS7);
  d['pl-start-date-garbage'] = skDoc(`${WP.replace('WP-OP-A', 'WP-A')}- [ ] TSK-A-01: 이상한 시작일 ~2026-09-05\n`, 'project: MES\nmodule: mes-skel\nstart_date: TBD\n' + LEVELS7);

  // ── fold · 마일스톤
  d['pl-fold-variants'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 부모 Task   w:1  ~2026-12-01\n  - acceptance: 기존 인수 / 둘째\n  - [ ] STK-OP-A-01-1: 첫째\n  - [x] STK-OP-A-01-2: 둘째 완료\n  - [ ] STK-OP-A-01-3: 셋째   @x  w:9  ~2026-12-03\n- [ ] TSK-OP-A-02: 두 번째 Task   w:1  ~2026-12-01\n  - [ ] STK-OP-A-02-1: 안쪽\n    - [ ] STK-OP-A-02-1-1: 더 안쪽 (checklist 의 자식)\n- [ ] STK-OP-A-03: 헤딩 직속 STK 는 부모가 WP\n`);
  d['pl-fold-orphan'] = plDoc(`- [ ] STK-OP-X-01: 부모 없는 STK\n${WP}- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\n`);
  d['pl-fold-under-milestone'] = plDoc(`${WP}- [M] TSK-OP-A-90: 마일스톤   ~2026-12-31\n  - [ ] STK-OP-A-90-1: 마일스톤 밑 STK\n`);
  d['pl-milestones'] = plDoc(`${WP}- [M] TSK-OP-A-90: 정상 마일스톤   ~2026-12-31\n- [M] 아이디 없는 마일스톤   ~2026-12-31\n- [M] tsk-lower: 소문자\n- [M] ZZZ-01: 미선언 접두어 마일스톤\n- [M] WP-OP-MS: WP 층 마일스톤 (leaf 경고 면제)\n- [M] TSK-OP-A-91: 범위 마일스톤 2026-12-01~2026-12-31\n`);
  d['pl-rollup-leaf-warnings'] = plDoc(`## SUB-OP-EMPTY: 빈 SUB\n### WP-OP-EMPTY: 빈 WP\n${WP}- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\n`);

  // ── 검증 오류
  d['pl-errors-misc'] = plDoc(`## PH-03: 골격 층 본문\n### SYS-OP: 골격 층 본문\n## SUB-OP-E: 오류 모음\n${WP}- [x] TSK-OP-A-01: 체크됨 30%   w:1  ~2026-12-01\n  - depends: TSK-NOPE-1, TSK-OP-A-02 ,\n- [ ] TSK-OP-A-01: ID 중복   w:1  ~2026-12-01\n- [ ] TSK-OP-A-02: 퍼센트 100 %   credit:nope\n- [ ] STK-OP-A-03: 부모가 WP 인 checklist\n`);
  d['pl-descend-errors'] = plDoc(`## WP-OP-TOP: 최상위 WP\n### SUB-OP-BACK: 역행\n#### WP-OP-SAME: 동급 다음\n##### WP-OP-SAME2: 동급\n${WP}- [ ] TSK-OP-A-01: Task\n  - [ ] TSK-OP-A-02: Task 밑 Task\n  - [ ] WP-OP-IN-TSK: Task 밑 WP\n`);
  d['pl-attach-levels'] = plDoc(`## SYS-OP: 시스템이 최상위\n## PH-03: Phase 가 최상위\n## SUB-OP-A: 정상\n`);
  d['pl-attach-to-sub'] = doc(PL_FRONT.replace('PH-03/SYS-OP', 'PH-03/SUB-OP'), `## SUB-OP-A: attach 가 SUB 일 때 SUB 가 최상위\n${WP}- [ ] TSK-OP-A-01: Task\n## WP-OP-B: WP 최상위\n- [ ] TSK-OP-B-01: Task\n`);
  d['pl-attach-unknown-prefix'] = doc(PL_FRONT.replace('PH-03/SYS-OP', 'PH-03/ZZZ-OP'), `## SUB-OP-A: attach 접두어 미선언\n`);
  d['pl-attach-trailing-slash'] = doc(PL_FRONT.replace('PH-03/SYS-OP', 'PH-03/SYS-OP/'), `## SUB-OP-A: attach 끝 슬래시\n`);
  d['pl-no-module'] = doc(PL_FRONT.replace('module: mes-op\n', ''), `## SUB-OP-A: module 없음\n`);
  d['pl-empty-module'] = doc(PL_FRONT.replace('module: mes-op', 'module:'), `## SUB-OP-A: module 빈값\n`);
  d['pl-no-attach'] = doc(PL_FRONT.replace('attach: PH-03/SYS-OP\n', ''), `## SUB-OP-A: attach 없음 → skeleton 모드 export\n${WP}- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\n`);
  d['pl-checklist-rules'] = doc(PL_FRONT + '\n', `## SUB-OP-A: checklist 규칙\n${WP}- [ ] TSK-OP-A-01: Task\n  - [ ] STK-OP-A-01-1: 정상\n    - [ ] STK-OP-A-01-1-1: 자식 금지\n- [ ] TSK-OP-A-02: 두 번째\n- [ ] ACT-OP-A-03: Activity 의 STK\n  - [ ] STK-OP-A-03-1: 부모 Activity(rollup)\n`);

  // ── 구조 변형
  d['empty'] = '';
  d['only-newline'] = '\n';
  d['only-spaces'] = '   \n\t\n';
  d['frontmatter-only'] = `---\n${LEVELS7}---\n`;
  d['frontmatter-empty'] = '---\n---\n## SUB-A: 제목\n';
  d['frontmatter-unterminated'] = `---\n${LEVELS7}\n## SUB-A: 제목\n- [ ] TSK-A-1: x\n`;
  d['no-frontmatter'] = '# 제목\n## SUB-A: 제목\n- [ ] TSK-A-1: x\n';
  d['frontmatter-late'] = `\n---\n${LEVELS7}---\n## SUB-A: 제목\n`;
  d['frontmatter-dash-spaces'] = `  ---  \n${LEVELS7}  ---\t\n## SUB-A: 제목\n`;
  d['frontmatter-comments'] = `---\n# 주석 줄\nmodule: m   # 줄 끝 주석\nattach: PH-03/SYS-A # 주석\n  # 들여쓴 주석\nlevels:\n  - { name: Phase, prefix: PH, progress: rollup, owner: pmo, upload: false }   # 주석\n  - { name: System, prefix: SYS, progress: rollup, owner: pmo, upload: false }\n  - { name: WP, prefix: WP, progress: rollup }\n  - { name: Task, prefix: TSK, progress: input }\ncredits:\n  default: { 대기: 0, 완료: 100 }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업  credit:default  ~2026-12-01\n`;
  d['frontmatter-levels-string'] = `---\nmodule: m\nlevels: foo\n---\n## SUB-A: 제목\n`;
  d['frontmatter-levels-string-attach'] = `---\nmodule: m\nattach: PH-03/SYS-A\nlevels: foo\n---\n`;
  d['frontmatter-levels-string-then-section'] = `---\nmodule: m\nlevels: foo\nlevels:\n  - { name: A, prefix: A, progress: input }\n---\n## A-1: 제목\n`;
  d['frontmatter-credits-string'] = `---\nmodule: m\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n  - { name: Task, prefix: TSK, progress: input }\ncredits: default\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업  credit:def\n- [ ] TSK-A-2: 작업  credit:zzz\n`;
  d['frontmatter-credits-string-then-section'] = `---\nmodule: m\ncredits: x\ncredits:\n  default: { a: 1 }\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n## WP-A: 묶음\n`;
  d['frontmatter-levels-twice'] = `---\nmodule: m\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\nlevels:\n  - { name: Task, prefix: TSK, progress: input }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업\n`;
  d['frontmatter-flow-values'] = `---\nmodule: m\nlevels:\n  - { name: 5, prefix: WP, progress: rollup, 7: seven, 10: ten, 2: two, upload: true, optional: false, big: 123456789012345678901234567890, neg: -3, negzero: -0, dup: 1, dup: 2, empty: , nocolon, 한글키: 값, "q": "x" }\n  - { name: , prefix: TSK, progress: input, owner: }\n  - { prefix: ZZZ }\n  - { name: Fold, prefix: STK, progress: checklist, upload: fold, optional: yes }\n  - { name: dupprefix, prefix: WP }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업\n  - [ ] STK-A-1-1: s\n`;
  d['frontmatter-upload-variants'] = `---\nmodule: m\nlevels:\n  - { name: P, prefix: P, progress: rollup, upload: false }\n  - { name: Q, prefix: Q, progress: rollup, upload: true }\n  - { name: R, prefix: R, progress: rollup, upload: fold }\n  - { name: T, prefix: T, progress: input, upload: 0 }\n  - { name: U, prefix: U, progress: input, upload: 1 }\n---\n## P-1: 하나\n### Q-1: 둘\n#### R-1: 셋\n##### T-1: 넷\n- [ ] U-1: 다섯\n`;
  d['frontmatter-bom-fence'] = `﻿---\n${LEVELS7}---\n## SUB-A: BOM 때문에 frontmatter 안 읽힘\n`;
  d['frontmatter-nbsp'] = `--- \n${LEVELS7}---\n`;
  d['frontmatter-zero-width-bom-inside'] = `---\nmodule: m\n﻿attach: x\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n## WP-A: 묶음\n`;
  d['frontmatter-credit-indent'] = `---\nmodule: m\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n  - { name: Task, prefix: TSK, progress: input }\ncredits:\n  default: { a: 1 }\n    deep: { b: 2 }\n\tdefault2: { c: 3 }\n  with space: { d: 4 }\n  한글: { e: 5 }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업  credit:한글\n- [ ] TSK-A-2: 작업  credit:deep\n- [ ] TSK-A-3: 작업  credit:default2\n`;
  d['deep-8-levels'] = `---\nmodule: deep\n${LEVELS8}---\n## A0-1: 영\n### A1-1: 일\n#### A2-1: 이\n##### A3-1: 삼\n###### A4-1: 사\n- [ ] A5-1: 오 (list)\n  - [ ] A6-1: 육\n    - [ ] A7-1: 칠\n    - [x] A7-2: 칠 완료\n- [ ] A6-2: 육 직속(오 건너뜀)\n  - [ ] A7-3: 칠\n- [ ] A7-4: 칠 직속(A4 아래)\n`;
  d['deep-heading-7'] = `---\nmodule: deep\n${LEVELS8}---\n## A0-1: 영\n####### A1-1: 헤딩 7개는 헤딩이 아님\n- [ ] A6-1: 육\n`;
  d['heading-depth-jump'] = plDoc(`# SUB-OP-A: 1단 헤딩\n###### WP-OP-A: 6단 헤딩\n- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\n## SUB-OP-B: 되돌아옴\n### WP-OP-B: 묶음\n- [ ] TSK-OP-B-01: Task   w:1  ~2026-12-01\n`);
  d['indent-variants'] = plDoc(`${WP}- [ ] TSK-OP-A-01: Task\n  - category: dev\n\t- priority: high\n    - tags: a,b\n - model: x\n- [ ] TSK-OP-A-02: Task\n      - [ ] STK-OP-A-02-1: 깊은 들여쓰기\n  * 별표 항목\n  + 더하기 항목\n  1. 번호 항목\n-없는 공백 항목\n  - 필드 아님: 그냥 메모\n  - Category: 대문자는 필드 아님\n  - depends : TSK-OP-A-01\n  - depends: TSK-OP-A-01, , TSK-OP-A-01\n  - category:\n`);
  d['unicode-whitespace'] = plDoc(`${WP}- [ ] TSK-OP-A-01: NBSP 제목  w:2  ~2026-12-01\n- [ ] TSK-OP-A-02: 전각　공백　제목　　@전각\n-　[ ] TSK-OP-A-03: 항목 앞 전각\n- [ ] TSK-OP-A-04:​제로폭​제목\n- [ ] TSK-OP-A-05: 제목 \u0085 NEL 로 줄이 나뉨 w:3\n- [ ] TSK-OP-A-06: 줄   구분 w:3\n- [ ] TSK-OP-A-07: 줄 \u000b 수직탭 w:3\n- [ ] TSK-OP-A-08: 줄 \u000c 폼피드 w:3\n- [ ] TSK-OP-A-09: 줄 \u001c 구분자 w:3\n- [ ] TSK-OP-A-10: 제어문자 \u0001 와 DEL \u007f\n- [ ] TSK-OP-A-11: 제목 끝 공백\u001f\u001f\n`);
  d['unicode-title-json'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 따옴표 " 와 역슬래시 \\ 와 슬래시 / 와 <태그> & 앰퍼샌드  ~2026-12-01\n- [ ] TSK-OP-A-02: 이모지 😀 가나다 ① ㈜ ﬁ  ~2026-12-01\n  - requirements: 요건 "인용" \\n 리터럴 ✓\n  - prd-ref: ✓ §4\n  - entry-point: src/한글.ts\n  - model: 모델 줄\n`);
  d['crlf-in-frontmatter'] = doc(PL_FRONT.replace(/\n/g, '\r\n'), `## SUB-OP-A: CRLF\r\n${WP.replace(/\n/g, '\r\n')}- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\r\n`);
  d['duplicate-field-last-wins'] = plDoc(`${WP}- [ ] TSK-OP-A-01: Task   w:1  ~2026-12-01\n  - category: dev\n  - category: defect\n  - requirements: 하나\n  - requirements:   \n  - acceptance: a / b\n  - acceptance: c\n`);
  d['field-values-special'] = plDoc(`${WP}- [ ] TSK-OP-A-01: Task\n  - category: a: b: c\n  - requirements:    공백 앞뒤   \n  - tags: x,y, z ,   ,w\n  - depends: TSK-OP-A-01\n  - entry-point: \n  - priority: 0\n`);
  d['many-nodes'] = plDoc(`## SUB-OP-BIG: 대량\n${Array.from({ length: 40 }, (_, i) => `### WP-OP-B${i}: 묶음 ${i}\n${Array.from({ length: 5 }, (_, j) => `- [ ] TSK-OP-B${i}-${j}: 작업 ${i}-${j}   @u${j}  w:${(j % 3) + 1}  ~2026-${String(10 + (i % 3)).padStart(2, '0')}-${String(1 + ((i * 5 + j) % 27)).padStart(2, '0')}\n  - depends: TSK-OP-B${i}-${(j + 1) % 5}\n  - [ ] STK-OP-B${i}-${j}-1: 점검`).join('\n')}`).join('\n')}\n`);
  // ── export 가 끝까지 가는 변형(위 문서 중 검증 오류로 막히는 것의 통과판)
  d['deep-8-levels-ok'] = `---\nmodule: deep\n${LEVELS8}---\n## A0-1: 영\n### A1-1: 일\n#### A2-1: 이\n##### A3-1: 삼\n###### A4-1: 사\n- [ ] A6-1: 육 (오 건너뜀)   @kim  w:2  ~2026-12-01\n  - [ ] A7-1: 칠\n  - [x] A7-2: 칠 완료\n- [ ] A5-1: 오\n  - [ ] A6-2: 육   w:1.5  ~2026-12-02\n    - depends: A6-1\n    - [x] A7-3: 칠\n    - [M] A7-9: 마일스톤 STK\n`;
  d['pl-fold-ok'] = plDoc(`${WP}- [ ] TSK-OP-A-01: 부모 Task   w:1  ~2026-12-01\n  - acceptance: 기존 인수 / 둘째\n  - [ ] STK-OP-A-01-1: 첫째\n  - [x] STK-OP-A-01-2: 둘째 완료\n  - [ ] STK-OP-A-01-3: 셋째   @x  w:9  ~2026-12-03\n- [ ] TSK-OP-A-02: 두 번째 Task   w:1  ~2026-12-01\n  - [ ] STK-OP-A-02-1: 안쪽\n  - [x] STK-OP-A-02-2: "따옴표" 😀\n- [ ] TSK-OP-A-03: STK 없는 Task\n  - acceptance:\n`);
  d['pl-milestones-ok'] = plDoc(`${WP}- [M] TSK-OP-A-90: 정상 마일스톤   ~2026-12-31\n- [M] TSK-OP-A-91: 범위 마일스톤 2026-12-01~2026-12-31\n- [M] TSK-OP-A-92: 날짜 없는 마일스톤\n- [M] TSK-OP-A-93: 선행 있는 마일스톤 ~2026-12-31\n  - depends: TSK-OP-A-90\n  - category: infra\n## SUB-OP-B: 두 번째 SUB\n- [M] WP-OP-MS: WP 층 마일스톤 (rollup leaf 경고 면제)\n- [ ] TSK-OP-B-01: Task   w:1  ~2026-12-01\n`);
  d['frontmatter-flow-values-ok'] = `---\nmodule: m\nlevels:\n  - { name: 5, prefix: WP, progress: rollup, 7: seven, 10: ten, 2: two, upload: true, optional: false, big: 123456789012345678901234567890, neg: -3, negzero: -0, dup: 1, dup: 2, empty: , nocolon, 한글키: 값, "q": "x", unicodeint: ٣٤, plus: +5, spaced:   12   }\n  - { name: , prefix: TSK, progress: input, owner: }\n  - { name: Fold, prefix: STK, progress: checklist, upload: fold, optional: yes }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업  ~2026-12-01\n  - [ ] STK-A-1-1: s\n`;
  d['frontmatter-levels-no-name'] = `---\nmodule: m\nlevels:\n  - { prefix: WP, progress: rollup }\n  - { prefix: TSK, progress: input }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업\n`;
  d['frontmatter-name-types'] = `---\nmodule: m\nlevels:\n  - { name: true, prefix: WP, progress: rollup }\n  - { name: 12, prefix: ACT, progress: rollup, optional: true }\n  - { name: false, prefix: MID, progress: rollup }\n  - { name: Task, prefix: TSK, progress: input }\n---\n## WP-A: 묶음\n- [ ] TSK-A-1: 작업\n### MID-A: 건너뜀 확인\n`;
  d['invalid-utf8'] =Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a, 0x2d, 0x2d, 0x2d, 0x0a]);
  d['utf16-bom'] = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('---\n', 'utf16le')]);
  d['nul-bytes'] = '---\nmodule: m\u0000x\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n## WP-A: 묶\u0000음\n';
  return d;
}

/** 문서마다 돌릴 명령 */
export function docCases(name) {
  const f = `docs/${name}.md`;
  return [
    { id: `${name} | validate pl`, args: ['validate', '--wbs', f, '--role', 'pl'] },
    { id: `${name} | validate default`, args: ['validate', '--wbs', f] },
    { id: `${name} | validate skeleton`, args: ['validate', '--wbs', f, '--role', 'skeleton'] },
    { id: `${name} | export`, args: ['export', '--wbs', f] },
    { id: `${name} | export attach-ref`, args: ['export', '--wbs', f, '--attach-ref', 'mes-skel/SYS-OP'] },
    { id: `${name} | export skeleton`, args: ['export', '--wbs', f, '--skeleton', 'docs/skel-min.md'] },
  ];
}

/** 합성 입력 전체: files(상대 경로 → 내용), cases */
export function buildSynthetic() {
  const files = {};
  const cases = [];
  const all = docs();
  for (const [name, content] of Object.entries(all)) {
    files[`docs/${name}.md`] = content;
    cases.push(...docCases(name));
  }
  for (const f of fs.readdirSync(INPUTS_DIR).filter((x) => x.endsWith('.md')).sort()) {
    const name = `in-${f.slice(0, -3)}`;
    files[`docs/${name}.md`] = fs.readFileSync(path.join(INPUTS_DIR, f));
    cases.push(...docCases(name));
  }
  // 골격 쪽 변형(--skeleton 에서 module 을 읽는다)
  files['docs/skel-nomodule.md'] = `---\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n`;
  files['docs/skel-emptymodule.md'] = `---\nmodule:\nlevels:\n  - { name: WP, prefix: WP, progress: rollup }\n---\n`;
  files['docs/skel-bom.md'] = `﻿${SKEL_MIN}`;
  files['docs/skel-nested/skel.md'] = SKEL_MIN;
  files['docs/skel-bad-utf8.md'] = Buffer.from([0xff, 0xfe, 0xfd]);
  const skel = (id, args) => cases.push({ id, args });
  skel('skeleton: no module', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/skel-nomodule.md']);
  skel('skeleton: empty module', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/skel-emptymodule.md']);
  skel('skeleton: BOM (module 안 읽힘)', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/skel-bom.md']);
  skel('skeleton: 중첩 경로', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/skel-nested/skel.md']);
  skel('skeleton: 없는 파일', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/nope.md']);
  skel('skeleton: UTF-8 아님', ['export', '--wbs', 'docs/pl-main.md', '--skeleton', 'docs/skel-bad-utf8.md']);
  skel('skeleton: attach-ref 가 있으면 skeleton 무시', ['export', '--wbs', 'docs/pl-main.md', '--attach-ref', 'x/y', '--skeleton', 'docs/nope.md']);
  skel('skeleton: attach 없는 문서', ['export', '--wbs', 'docs/pl-no-attach.md', '--skeleton', 'docs/nope.md']);
  skel('attach-ref 빈 문자열', ['export', '--wbs', 'docs/pl-main.md', '--attach-ref', '']);
  skel('attach-ref 빈 문자열 + skeleton', ['export', '--wbs', 'docs/pl-main.md', '--attach-ref', '', '--skeleton', 'docs/skel-min.md']);
  skel('attach-ref 한글·공백', ['export', '--wbs', 'docs/pl-main.md', '--attach-ref', '골격 모듈/시스템']);
  skel('attach 없는 문서 + attach-ref', ['export', '--wbs', 'docs/pl-no-attach.md', '--attach-ref', 'mes-skel/SYS-OP']);
  skel('옵션 순서 바꿈', ['export', '--skeleton', 'docs/skel-min.md', '--wbs', 'docs/pl-main.md']);
  skel('옵션 = 형식', ['export', '--wbs=docs/pl-main.md', '--attach-ref=a/b']);
  skel('wbs 두 번(마지막 값)', ['validate', '--wbs', 'docs/empty.md', '--wbs', 'docs/pl-main.md']);
  skel('role 두 번(마지막 값)', ['validate', '--wbs', 'docs/pl-no-attach.md', '--role', 'skeleton', '--role', 'pl']);
  // 파일 문제
  skel('wbs 없는 파일 validate', ['validate', '--wbs', 'docs/nope.md']);
  skel('wbs 없는 파일 export', ['export', '--wbs', 'docs/nope.md']);
  skel('wbs 가 폴더', ['validate', '--wbs', 'docs']);
  skel('wbs 절대 경로 아님·점 포함', ['validate', '--wbs', './docs/../docs/pl-main.md']);
  return { files, cases };
}

/** 사용 오류(종료 코드 2 만 비교 — 문구는 argparse 와 다르다) */
export const USAGE_CASES = [
  { id: 'usage: 인자 없음', args: [] },
  { id: 'usage: 잘못된 명령', args: ['bogus'] },
  { id: 'usage: validate --wbs 없음', args: ['validate'] },
  { id: 'usage: export --wbs 없음', args: ['export'] },
  { id: 'usage: --wbs 값 없음', args: ['validate', '--wbs'] },
  { id: 'usage: role 잘못된 값', args: ['validate', '--wbs', 'docs/pl-main.md', '--role', 'admin'] },
  { id: 'usage: 알 수 없는 옵션', args: ['validate', '--wbs', 'docs/pl-main.md', '--nope'] },
  { id: 'usage: 초과 위치 인자', args: ['validate', '--wbs', 'docs/pl-main.md', 'extra'] },
  { id: 'usage: export 에 --role', args: ['export', '--wbs', 'docs/pl-main.md', '--role', 'pl'] },
  { id: 'usage: validate 에 --attach-ref', args: ['validate', '--wbs', 'docs/pl-main.md', '--attach-ref', 'a'] },
];
