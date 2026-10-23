// wbs-parse-cases.mjs — wbs-parse 골든·기대값 시험이 함께 쓰는 입력 문서와 CLI 케이스.
// buildSynthetic(base)  : base 폴더 아래에 만들 파일(FILES)과 CLI 케이스 목록을 돌려준다(상대 경로, cwd = base).
//   python legacy 와 node 판이 같은 인자·같은 cwd 로 돌고, 출력 속의 base 경로는 <BASE> 로 치환해 비교한다.
// 주의: 출력에 역슬래시 문자가 그대로(JSON 에서는 이중 역슬래시로) 나오게 하는 입력은 넣지 않는다 — 윈도우 시험의 출력 정규화
// (wbs-parse.test.mjs makeNorm)가 이중 역슬래시를 경로 구분자로 보고 슬래시로 바꾸기 때문이다(줄바꿈 이스케이프 같은 JSON 이스케이프는 안전). 이 파일은 .gitattributes 로 LF 가 고정돼 있다(CRLF·CR 변종은 코드로 만든다).
// 문서 상수(FOURLEVEL 등)는 단위 시험(python test_wbs_parse_export 의 이식)도 가져다 쓴다.

// MES wbs.md 실측 구조 (4단계, ##### 하위 절 2종)
export const FOURLEVEL = `\
# WBS

## WP-00: 초기화
- phase: PH-1
- schedule: 2026-08-05 ~ 2026-08-18
- description: 스캐폴드·CI, 전사 공유 계약

### ACT-00-01: 공통 기반

전 모듈이 공유하는 기반.

#### TSK-00-01-01: 스캐폴드
- category: infra
- domain: infra
- model: sonnet
- status: [ ]
- priority: critical
- assignee: -
- schedule: 2026-08-05 ~ 2026-08-06
- tags: setup, init
- depends: -
- entry-point: -

##### PRD 요구사항
- prd-ref: 공통 (BPA 외)
- requirements:
  - 프로젝트 생성, env 배선
  - CI 파이프라인
- acceptance:
  - dev 서버 기동
  - 헬스체크 통과

#### TSK-00-01-02: 시드
- category: infra
- domain: database
- model: opus
- status: [im]
- priority: high
- assignee: lee@example.com
- schedule: 2026-08-07 ~ 2026-08-08
- tags: contract, schema
- depends: TSK-00-01-01
- entry-point: layout (전 화면 공통 셸)

##### PRD 요구사항
- prd-ref: BPA 공통
- requirements:
  - 시드 3건
- acceptance:
  - 적재 확인
- constraints:
  - 모듈 전용 엔티티 금지

##### 기술 스펙 (TRD)
- api-spec:
  - \`confirmReceiving(lotId)\` — 단일 트랜잭션 RPC
- data-model:
  - common_code(그룹, 코드, 명칭)
- test-criteria:
  - 단위: 전이 / E2E: 수신 3유형

## WP-01: 기능
- phase: PH-2
- schedule: 2026-08-19 ~ 2026-09-01

### ACT-01-01: 로그인

#### TSK-01-01-01: 로그인 API
- category: dev
- domain: backend
- model: sonnet
- status: [ts]
- priority: high
- assignee: -
- schedule: 2026-08-19 ~ 2026-08-22
- tags: -
- depends: TSK-00-01-02
- entry-point: /login

##### PRD 요구사항
- requirements:
  - 로그인 처리
- acceptance:
  - 응답 200ms 이하
`;

// bookloop wbs.md 실측 구조 (3단계, #### 하위 절)
export const THREELEVEL = `\
# WBS

## WP-00: 초기화
- phase: PH-1
- schedule: 2026-08-05 ~ 2026-08-18
- description: 스캐폴드·CI

### TSK-00-01: 스캐폴드
- category: infra
- domain: infra
- model: sonnet
- status: [dd]
- priority: critical
- assignee: -
- schedule: 2026-08-05 ~ 2026-08-06
- tags: setup
- depends: -
- entry-point: -

#### PRD 요구사항
- requirements:
  - Next.js 15 생성
- acceptance: dev 서버 기동
`;

export const NODE_KEYS = [
  'id', 'parent_id', 'kind', 'title', 'stage', 'category', 'domain', 'model',
  'assignee', 'schedule', 'priority', 'tags', 'depends', 'prd_ref',
  'entry_point', 'acceptance', 'spec_sections',
];
export const SPEC_KEYS = ['requirements', 'test_criteria', 'constraints', 'api_spec', 'data_model', 'description'];

// ---- 경계 입력 문서 ----------------------------------------------------------

const FENCED = `\
# WBS

## WP-01: 기능
- phase: PH-1
- schedule: 2026-01-01 ~ 2026-01-31

### TSK-01-01: 펜스 예시 포함
- category: dev
- domain: backend
- model: sonnet
- status: [ ]
- depends: -
- acceptance:
  - 첫째 기준

\`\`\`markdown
## WP-99: 가짜 WP
### ACT-99-01: 가짜 ACT
#### TSK-99-01-01: 가짜 Task
- status: [xx]
\`\`\`
- requirements:
  - 펜스 뒤 요구사항

### TSK-01-02: 다음 Task
- category: feat
- domain: frontend
- status: [im]
- depends: TSK-01-01
- tags: a, b

~~~
## WP-98: 물결 펜스 안 가짜
### TSK-98-01: 물결 가짜 Task
~~~

## WP-02: 두번째
- phase: PH-2
### TSK-02-01: x
- status: [xx]
`;

const UNCLOSED_FENCE = `\
## WP-01: a
- phase: PH-1
### TSK-01-01: t
- status: [ ]
\`\`\`
## WP-02: 닫히지 않은 펜스 뒤
### TSK-02-01: u
- status: [ ]
`;

const BADIDS = `\
# WBS
## WP-1a: 잘못
## WP-3: 정상
- phase: PH-1
### TSK-1: 세그먼트 하나
- status: [ ]
### TSK-01-: 꼬리 하이픈
### TSK-AB-01: 영문 ID
###TSK-01-03: 공백 없음
### TSK-01-02 콜론 없음
### TSK-03-01: 정상
- status: [ ]
- domain: backend
### TSK-03-01-01-01: 다섯 세그먼트
- status: [xx]
`;

const FIVELEVEL = `\
## WP-01: 다섯 단계
- phase: PH-1
### ACT-01-01: act
##### TSK-01-01-01: 다섯 샵
- status: [ ]
- domain: backend
##### 하위
- acceptance: x
#### TSK-01-01-02: 네 샵
- status: [im]
`;

const UNICODE_WS = `\
##　WP-01: 전각 공백
- phase: PH-1

### TSK-01-01: nbsp 헤딩
- status: [ ]
- domain: backend

##\u001fWP-02: 유닛 구분자
- phase: PH-2

###﻿TSK-02-01: BOM 문자 뒤
- status: [ ]

###\tTSK-02-02: 탭
- status: [im]
`;

const BOM_WP_FIRST = '﻿## WP-00: 첫 줄 BOM\n- phase: PH-1\n\n### TSK-00-01: t\n- status: [ ]\n- domain: backend\n';

const SPLITLINES = `\
## WP-01: 줄 분할 문자
- phase: PH-1

### TSK-01-01: 폼피드
- status: [ ]\f- domain: backend
- note: a - category: dev
- tags: x\u0085y, z
- depends: TSK-00-01\v- priority: high
- acceptance:
  - 하나\x1c  - 둘
  - 셋\x1d    - 중첩
### TSK-01-02: 끝
- status: [xx]
`;

const STATES5 = `\
## WP-01: 5상태
- phase: PH-1
### TSK-01-01: a
- status: [ ]
### TSK-01-02: b
- status: [dd]
### TSK-01-03: c
- status: [im]
### TSK-01-04: d
- status: [ts]
### TSK-01-05: e
- status: [xx]
### TSK-01-06: f
- status: [dd!]
### TSK-01-07: g
- status: [im!]
### TSK-01-08: h
- status: [zz]
### TSK-01-09: i
`;

const STATES6 = `\
## WP-01: 6상태
- phase: PH-1
### TSK-01-01: a
- status: [ ]
### TSK-01-02: b
- status: [as]
### TSK-01-03: c
- status: [fp]
### TSK-01-04: d
- status: [ip]
### TSK-01-05: e
- status: [im]
### TSK-01-06: f
- status: [xx]
`;

const COMPLEX = `\
## WP-01: 복잡도
- phase: PH-1
### TSK-01-01: 명시 모델
- model: OPUS
- domain: docs
### TSK-01-02: 의존 많음
- domain: fullstack
- depends: TSK-01-01, TSK-01-03, -, TSK-01-04, TSK-01-05
### TSK-01-03: 키워드
- domain: Frontend
- status: [ ]
- category: feat
본문에 State Machine 과 OAuth 를 다룬다.
### TSK-01-04: 한글 키워드
- domain: test
본문에 트랜잭션 처리와 동시성 제어.
### TSK-01-05: 메타만
- category: config
- depends: TSK-01-01, TSK-01-02
- tags: architecture
### TSK-01-06: 잘못된 모델
- model: haiku
- domain: fullstack
- depends: TSK-01-01, TSK-01-02, TSK-01-03, TSK-01-04
### TSK-01-07: docs 카테고리
- category: Documentation
- domain: docs
통합 테스트.
### TSK-01-08: 빈
`;

const SLUGS = `\
## WP-01: 슬러그
- phase: PH-1
### TSK-01-01: Login 2FA setup!
- category: feat
### TSK-01-02: 한글만 있는 제목
- category: feat
### TSK-01-03: abcdefghijklmnopqrstuvwxyz-0123456789-abcdefghij klmnop
- category: feat
### TSK-01-04: abcdefghijklmnopqrstuvwxyz-0123456789-a-bcdefghij klmnop
- category: feat
### TSK-01-05: ---
- category: feat
### TSK-01-06:   Mixed 한글 Title v2
- category: feat
### TSK-01-07: 😀 emoji 제목
- category: feat
### TSK-01-08: normal
- category: dev
### TSK-01-09:
- category: feat
### TSK-01-10: İstanbul Ünïcode ſ
- category: feat
`;

const LISTS = `\
## WP-01: 리스트
- phase: PH-1
### TSK-01-01: 리스트 모양
- status: [ ]
- tags: a, b,, c ,
- depends: TSK-00-01, TSK-00-02 , ,
- requirements: 한 줄 CSV, 둘째
- acceptance:
  - 항목 하나
    - 중첩 둘
    이어쓰기 줄
  - 항목 둘

- constraints: -
- test-criteria:
- api-spec:
  - GET /a
  - POST /b
- data-model:
  - t(a, b)
- description: 설명 한 줄
### TSK-01-02: 헤딩으로 끝
- acceptance:
  - 하나
## WP-02: 다음
- requirements:
  - 위 WP 의 항목 아님
### TSK-02-01: 끝에서 빈 목록
- acceptance:
`;

const DEVCFG_FULL = `\
# WBS

## Dev Config

### Domains
| domain | description | unit-test | e2e-test | e2e-server | e2e-url |
|--------|-------------|-----------|----------|------------|---------|
| backend | Server API | \`./gradlew test\` | \`npx playwright test\` | - | - |
| frontend | Client UI | \`pnpm test | tee\` | \`pnpm e2e\` | \`pnpm dev\` | \`http://localhost:3000\` |
| database | | - | - | | |
| fullstack | Full stack | - | - | - | - |
| \`docs\` | 문서 | - | - | - | - |
| 10 | 숫자 도메인 | \`a\` | - | | |
| 2 | 둘 | - | \`b\` | | |
| 1 | 하나 | - | - | | |
| backend | 중복 키 | \`dup\` | - | | |
| short | 열 부족 |
| \`\` | 빈 백틱 | - | - | - | - |

### Design Guidance
| domain | architecture |
|--------|-------------|
| backend | Hexagonal |
| frontend | \`Next | App Router\` |
| 10 | x |
| empty | - |

### Quality Commands
| name | command |
|------|---------|
| lint | \`pnpm lint\` |
| \`typecheck\` | \`pnpm tsc\` |
| coverage | - |

### Cleanup Processes
node, vitest, , chrome

## WP-01: 기능
- phase: PH-1
`;

const DEVCFG_DUP = `\
## Dev Config
### Domains
| domain | description | unit-test | e2e-test |
|---|---|---|---|
| a | A | \`x\` | - |
## dev   config
### domains
| domain | description | unit-test | e2e-test |
|---|---|---|---|
| b | B | - | \`y\` |
### cleanup processes
vitest
## WP-01: z
`;

const DEVCFG_MIN = `\
## Dev Config

### Quality Commands
| name | command |
|---|---|
| lint | \`l\` |

### Cleanup Processes
---
| a | b |
x, y
## Dev Config Extra
### Domains
| domain | description | unit-test | e2e-test |
|---|---|---|---|
| late | L | \`z\` | - |
`;

const NODEVCFG = '# WBS\n## WP-01: a\n- phase: PH-1\n### TSK-01-01: t\n- status: [ ]\n';

const RESUMABLE = `\
## WP-01: 모두 완료
### TSK-01-01: a
- status: [xx]
### TSK-01-02: b
- status: [xx]
## WP-02: 진행 중
### TSK-02-01: c
- status: [xx]
### TSK-02-02: d
- status: [ ]
#### TSK-02-03: e
- status: [im]
##### TSK-02-04: 다섯 샵은 안 센다
- status: [ ]
## WP-03: 상태 줄 없음
### TSK-03-01: f
- domain: x
### TSK-03-02: g
- status: [dd]
## WP-04: 우회
### TSK-04-01: h
- status: [ ]
## WP-05: 빈
`;

const WP_ONLY_SPACES = `\
##  WP-01:   공백 많음
- phase:    PH-9
- schedule:  2026-01-01   ~  2026-01-02
- description:   설명   끝

###   ACT-01-01:   액트
####    TSK-01-01-01:    태스크
- status:   [im]
- priority:    P1
`;

const TASK_BLOCK_EDGE = `\
## WP-01: 블록 경계
### TSK-01-01: 하위 헤딩이 많은 Task
- status: [ ]
#### 4단계 하위 (Task 의 레벨보다 깊음)
- domain: backend
## 가짜 경계 WP 아님
- category: dev
### TSK-01-02: 다음
- status: [xx]
#### TSK-01-02-01: 4단계 Task
- status: [ ]
`;

// 상태머신 변종 (CLAUDE_PLUGIN_ROOT 로 지정)
const SM6 = JSON.stringify({
  states: {
    '[ ]': { phase_start: 'design' },
    '[as]': { phase_start: 'design' },
    '[fp]': { phase_start: 'build' },
    '[ip]': { phase_start: '' },
    '[im]': { phase_start: 'test' },
    '[xx]': { phase_start: 'done' },
    '[x2]': {},
  },
}, null, 2);
const SM_BAD = '{"states": ';
const SM_BOM = `﻿${SM6}`;
const SM_LIST = '[1, 2]';
const SM_NOSTATES = '{"a": 1}';

const WBS_ONE = (extra = '') => `\
## WP-01: 하나
- phase: PH-1
### TSK-01-01: 상태 시험
- status: [im]
- domain: backend
- tags: t
${extra}### TSK-01-02: 상태 없음
- status: [ ]
## WP-02: 둘
### TSK-02-01: z
- status: [dd]
`;

// state.json 변종 — TSK-01-01 에 둔다
const STATE_JSON = {
  a: '{"status": "[xx]", "last": {"event": "done.ok", "10": 1, "2": 2.0, "n": 1.5, "s": "한글 \\u00e9 \\ud83d\\ude00"}}',
  bom: '﻿{"status": "[xx]"}',
  invalid: '{',
  empty: '{}',
  nullstatus: '{"status": null}',
  legacy: '{"status": "[dd!]", "bypassed": true}',
  list: '[]',
  jsonnull: 'null',
  numstatus: '{"status": 5}',
  as: '{"status": "[as]", "last": {}}',
  bypassed: '{"status": "[im!]", "bypassed": 1, "bypassed_reason": null}',
  big: '{"status": "[xx]", "last": {"n": 12345678901234567890, "f": 1.0, "e": 1e5, "neg": -0.0, "i": -0, "nan": NaN}}',
  lastlist: '{"status": "[ts]", "last": [1, 2.5, {"a": []}], "bypassed": true, "bypassed_reason": "사유\\n줄바꿈"}',
  statustrim: '{"status": "  [xx]  "}',
  emptystatus: '{"status": ""}',
  crlf: '{\r\n  "status": "[xx]"\r\n}\r\n',
  dupkey: '{"status": "[ ]", "status": "[xx]", "a": 1, "a": 2}',
  str: '"[xx]"',
  zero: '0',
};

const FEAT_STATE = {
  f1: '{"name": "login-2fa", "status": "[dd]", "extra": {"3": 1, "1": 2.0}}',
  f2legacy: '{"state": "[xx]", "name": ""}',
  f3both: '{"state": "[im]", "status": "[ts]"}',
  f4bad: '{"name": ',
  f5nostatus: '{"name": "n"}',
  f6bang: '{"status": "[im!]"}',
  f7null: '{"name": null, "status": null}',
  f8list: '[1]',
  f9as: '{"status": "[as]"}',
};

/**
 * @param {string} base 케이스를 만들 임시 폴더(절대 경로)
 * @returns {{files: Record<string,string>, cases: {id:string, args:string[], env?:Record<string,string>}[]}}
 */
export function buildSynthetic(base) {
  const files = {};
  const cases = [];
  const add = (id, args, extra = {}) => cases.push({ id, args, ...extra });

  // --- 문서 × 모드 행렬 ---
  const DOCS = {
    four: FOURLEVEL,
    three: THREELEVEL,
    fourcrlf: FOURLEVEL.replace(/\n/g, '\r\n'),
    fourbom: `﻿${FOURLEVEL}`,
    bomwp: BOM_WP_FIRST,
    cronly: FOURLEVEL.replace(/\n/g, '\r'),
    empty: '',
    newline: '\n',
    nofinalnl: THREELEVEL.replace(/\n$/, ''),
    fenced: FENCED,
    unclosed: UNCLOSED_FENCE,
    badids: BADIDS,
    five: FIVELEVEL,
    unicodews: UNICODE_WS,
    splitlines: SPLITLINES,
    states5: STATES5,
    states6: STATES6,
    complex: COMPLEX,
    slugs: SLUGS,
    lists: LISTS,
    devcfg: DEVCFG_FULL,
    devcfgdup: DEVCFG_DUP,
    devcfgmin: DEVCFG_MIN,
    nodevcfg: NODEVCFG,
    resumable: RESUMABLE,
    spaces: WP_ONLY_SPACES,
    blockedge: TASK_BLOCK_EDGE,
  };
  for (const [name, text] of Object.entries(DOCS)) {
    files[`${name}/wbs.md`] = text;
    addMatrix(add, `doc ${name}`, `${name}/wbs.md`, text);
  }

  // --- state.json 변종 ---
  for (const [name, json] of Object.entries(STATE_JSON)) {
    const dir = `state-${name}`;
    files[`${dir}/wbs.md`] = WBS_ONE();
    files[`${dir}/tasks/TSK-01-01/state.json`] = json;
    const w = `${dir}/wbs.md`;
    for (const mode of ['--phase-start', '--complexity', '--block']) add(`${dir} TSK-01-01 ${mode}`, [w, 'TSK-01-01', mode]);
    for (const mode of ['--tasks', '--tasks-pending']) add(`${dir} WP-01 ${mode}`, [w, 'WP-01', mode]);
    for (const mode of ['--resumable-wps', '--export', '--tasks-all']) add(`${dir} ${mode}`, [w, '-', mode]);
  }
  // 두 번째 Task 에만 state.json(우회·완료)
  files['state-multi/wbs.md'] = WBS_ONE();
  files['state-multi/tasks/TSK-01-02/state.json'] = '{"status": "[xx]", "bypassed": true, "bypassed_reason": "x"}';
  files['state-multi/tasks/TSK-02-01/state.json'] = '{"status": "[ts]"}';
  for (const mode of ['--resumable-wps', '--export', '--tasks-all']) add(`state-multi ${mode}`, ['state-multi/wbs.md', '-', mode]);
  for (const wp of ['WP-01', 'WP-02']) for (const mode of ['--tasks', '--tasks-pending']) add(`state-multi ${wp} ${mode}`, ['state-multi/wbs.md', wp, mode]);

  // 6상태 상태머신 (CLAUDE_PLUGIN_ROOT)
  const prs = { sm6: SM6, smbad: SM_BAD, smbom: SM_BOM, smlist: SM_LIST, smnostates: SM_NOSTATES };
  for (const [name, text] of Object.entries(prs)) files[`pr-${name}/references/state-machine.json`] = text;
  files['pr-empty/.keep'] = '';
  const prEnv = (name) => ({ CLAUDE_PLUGIN_ROOT: `${base}/pr-${name}` });
  for (const name of Object.keys(prs).concat(['empty'])) {
    for (const [dir, tsk] of [['states6', 'TSK-01-0'], ['states5', 'TSK-01-0']]) {
      const n = dir === 'states6' ? 6 : 9;
      for (let i = 1; i <= n; i++) {
        add(`pr-${name} ${dir} ${tsk}${i} --phase-start`, [`${dir}/wbs.md`, `${tsk}${i}`, '--phase-start'], { env: prEnv(name) });
      }
    }
    add(`pr-${name} state-as --phase-start`, ['state-as/wbs.md', 'TSK-01-01', '--phase-start'], { env: prEnv(name) });
    add(`pr-${name} state-legacy --phase-start`, ['state-legacy/wbs.md', 'TSK-01-01', '--phase-start'], { env: prEnv(name) });
  }

  // --- feat 모드 ---
  for (const [name, json] of Object.entries(FEAT_STATE)) {
    files[`feats/${name}/state.json`] = json;
    for (const mode of ['--phase-start', '--status', '--bogus', '--dev-config']) add(`feat ${name} ${mode}`, ['--feat', `feats/${name}`, mode]);
  }
  files['feats/legacyfile/status.json'] = '{"state": "[im]"}';
  files['feats/localcfg/state.json'] = '{"status": "[ ]"}';
  files['feats/localcfg/dev-config.md'] = DEVCFG_FULL;
  files['feats/localbad/state.json'] = '{"status": "[ ]"}';
  files['feats/localbad/dev-config.md'] = NODEVCFG;
  files['feats/empty/.keep'] = '';
  files['docs-ok/wbs.md'] = DEVCFG_FULL;
  files['docs-nocfg/wbs.md'] = NODEVCFG;
  for (const f of ['legacyfile', 'localcfg', 'localbad', 'empty']) {
    for (const mode of ['--phase-start', '--status']) add(`feat ${f} ${mode}`, ['--feat', `feats/${f}`, mode]);
    add(`feat ${f} --dev-config`, ['--feat', `feats/${f}`, '--dev-config']);
    add(`feat ${f} --dev-config docs-ok`, ['--feat', `feats/${f}`, '--dev-config', 'docs-ok']);
    add(`feat ${f} --dev-config docs-nocfg`, ['--feat', `feats/${f}`, '--dev-config', 'docs-nocfg']);
    add(`feat ${f} --dev-config nodocs`, ['--feat', `feats/${f}`, '--dev-config', 'no-such-docs']);
    add(`feat ${f} --dev-config PR`, ['--feat', `feats/${f}`, '--dev-config', 'docs-nocfg'], { env: prEnv('sm6') });
  }
  add('feat dotted dir', ['--feat', 'feats/./f1/', '--phase-start']);
  add('feat trailing slash name', ['--feat', 'feats/f5nostatus/', '--status']);
  add('feat double slash', ['--feat', 'feats//f5nostatus', '--dev-config', 'docs-ok//']);
  add('feat pr sm6 phase', ['--feat', 'feats/f9as', '--phase-start'], { env: prEnv('sm6') });
  add('feat pr smbad phase', ['--feat', 'feats/f9as', '--phase-start'], { env: prEnv('smbad') });
  add('feat pr empty phase', ['--feat', 'feats/f9as', '--phase-start'], { env: prEnv('empty') });
  add('feat missing dir', ['--feat', 'feats/nope', '--status']);
  add('feat file as dir', ['--feat', 'docs-ok/wbs.md', '--status']);
  add('feat no mode', ['--feat', 'feats/f1']);
  add('feat no dir', ['--feat']);
  add('feat extra args', ['--feat', 'feats/f1', '--status', 'x', 'y']);
  add('feat empty mode', ['--feat', 'feats/f1', '']);

  // dev-config 템플릿·기본 설정 탐색(CLAUDE_PLUGIN_ROOT): 펜스 있음·없음·CRLF·폴더, 기본 설정 정상·Dev Config 없음·폴더
  files['pr-tpl/skills/wbs/references/dev-config-template.md'] = '# t\n\n```markdown\n## Dev Config\n\n### Domains\n| a |\n```\n\n나머지\n';
  files['pr-tplcrlf/skills/wbs/references/dev-config-template.md'] = '# t\r\n```markdown\r\n## 템플릿 CRLF\r\n```\r\n';
  files['pr-tplnofence/skills/wbs/references/dev-config-template.md'] = '# 펜스 없음\n## Dev Config\n';
  files['pr-tpldir/skills/wbs/references/dev-config-template.md/.keep'] = '';
  files['pr-default/references/default-dev-config.md'] = DEVCFG_MIN;
  files['pr-defaultnocfg/references/default-dev-config.md'] = NODEVCFG;
  files['pr-defaultdir/references/default-dev-config.md/.keep'] = '';
  for (const name of ['tpl', 'tplcrlf', 'tplnofence', 'tpldir', 'default', 'defaultnocfg', 'defaultdir']) {
    add(`pr-${name} nodevcfg --dev-config`, ['nodevcfg/wbs.md', '-', '--dev-config'], { env: prEnv(name) });
    for (const f of ['empty', 'localcfg']) add(`pr-${name} feat ${f} --dev-config`, ['--feat', `feats/${f}`, '--dev-config'], { env: prEnv(name) });
    add(`pr-${name} feat empty --dev-config docs-ok`, ['--feat', 'feats/empty', '--dev-config', 'docs-ok'], { env: prEnv(name) });
  }

  // --- 인자 해석(python 수동 파싱 그대로) ---
  const W = 'four/wbs.md';
  add('argv none', []);
  add('argv one', [W]);
  add('argv help', ['--help']);
  add('argv -h', ['-h']);
  add('argv two', [W, 'TSK-00-01-01']);
  add('argv id only default json', [W, 'TSK-00-01-01']);
  add('argv explicit --json', [W, 'TSK-00-01-01', '--json']);
  add('argv unknown mode', [W, 'TSK-00-01-01', '--bogus']);
  add('argv unknown mode flag form', [W, '--bogus']);
  add('argv unknown mode missing file', ['nope/wbs.md', 'TSK-00-01-01', '--bogus']);
  add('argv missing file', ['nope/wbs.md', 'TSK-00-01-01']);
  add('argv missing file export', ['nope/wbs.md', '--export']);
  add('argv dir as file', ['four', '--export']);
  add('argv field no name', [W, 'TSK-00-01-01', '--field']);
  add('argv field no name flag form', [W, '--field']);
  add('argv field empty name', [W, 'TSK-00-01-01', '--field', '']);
  add('argv field no name missing file', ['nope/wbs.md', 'TSK-00-01-01', '--field']);
  add('argv field flag form with name', [W, '--field', 'domain']);
  add('argv field name', [W, 'TSK-00-01-02', '--field', 'domain']);
  add('argv field status', [W, 'TSK-00-01-02', '--field', 'status']);
  add('argv field absent', [W, 'TSK-00-01-02', '--field', 'nope']);
  add('argv field regex chars', [W, 'TSK-00-01-02', '--field', 'a.*b']);
  add('argv field korean', ['slugs/wbs.md', 'TSK-01-02', '--field', 'category']);
  add('argv field extra', [W, 'TSK-00-01-02', '--field', 'domain', 'extra', 'args']);
  add('argv field not found', [W, 'TSK-99-99-99', '--field', 'domain']);
  add('argv block flag form (None)', [W, '--block']);
  add('argv json flag form (None)', [W, '--json']);
  add('argv tasks flag form (None)', [W, '--tasks', 'WP-00']);
  add('argv phase-start flag form', [W, '--phase-start']);
  add('argv complexity flag form', [W, '--complexity']);
  add('argv none id wp with None heading', ['none-id/wbs.md', '--block']);
  add('argv none id json', ['none-id/wbs.md', '--json']);
  add('argv none id complexity', ['none-id/wbs.md', '--complexity']);
  add('argv status non-feat', [W, '-', '--status']);
  add('argv empty id', [W, '', '--block']);
  add('argv empty id json', [W, '']);
  add('argv dash id block', [W, '-', '--block']);
  add('argv dash id export', [W, '-', '--export']);
  add('argv export flag form extra', [W, '--export', 'extra', 'more']);
  add('argv export with id (mode argv3)', [W, 'WP-00', '--export']);
  add('argv tasks-all with id', [W, 'WP-00', '--tasks-all']);
  add('argv resumable flag form', [W, '--resumable-wps']);
  add('argv dev-config flag form', ['devcfg/wbs.md', '--dev-config']);
  add('argv dev-config dash', ['devcfg/wbs.md', '-', '--dev-config']);
  add('argv mode in argv4 ignored', [W, 'TSK-00-01-01', '--block', '--json']);
  add('argv option-like id', [W, '-x', '--block']);
  add('argv abs-like relative path', ['./four/wbs.md', '--export']);
  add('argv dotdot path', ['four/../four/wbs.md', '--export']);
  add('argv trailing slash path', ['four//wbs.md', '--export']);
  add('argv bare file in cwd', ['wbs.md', '--export']);
  add('argv bare file phase-start', ['wbs.md', 'TSK-01-01', '--phase-start']);
  add('argv bare file tasks', ['wbs.md', 'WP-01', '--tasks']);
  add('argv bare file resumable', ['wbs.md', '-', '--resumable-wps']);
  files['wbs.md'] = WBS_ONE();
  files['tasks/TSK-01-01/state.json'] = '{"status": "[ts]", "last": {"event": "x"}}';
  files['none-id/wbs.md'] = '## WP-01: a\n### None: 이상한 헤딩\n- status: [ ]\n- domain: backend\n#### 하위\n';

  return { files, cases };
}

// 문서 하나에 대한 모드 행렬. ids 는 파서와 무관한 정규식으로 뽑는다.
function addMatrix(add, label, wbsPath, text) {
  const tsk = unique([...text.matchAll(/^#{2,6}[ \t 　\u001f﻿]*(TSK-[0-9]+(?:-[0-9]+)+):/gm)].map((m) => m[1]));
  const wp = unique([...text.matchAll(/^##[ \t 　\u001f﻿]*(WP-[0-9]+):/gm)].map((m) => m[1]));
  for (const mode of ['--export', '--tasks-all', '--resumable-wps', '--dev-config']) add(`${label} - ${mode}`, [wbsPath, '-', mode]);
  add(`${label} flag-form --export`, [wbsPath, '--export']);
  const ids = unique([...tsk.slice(0, 4), 'TSK-99-99']);
  for (const id of ids) {
    add(`${label} ${id}`, [wbsPath, id]);
    for (const mode of ['--block', '--complexity', '--phase-start']) add(`${label} ${id} ${mode}`, [wbsPath, id, mode]);
    for (const f of ['domain', 'status', 'tags']) add(`${label} ${id} --field ${f}`, [wbsPath, id, '--field', f]);
  }
  for (const id of unique([...wp.slice(0, 3), 'WP-99'])) {
    for (const mode of ['--tasks', '--tasks-pending', '--feat-tasks']) add(`${label} ${id} ${mode}`, [wbsPath, id, mode]);
  }
}

const unique = (a) => [...new Set(a)];
