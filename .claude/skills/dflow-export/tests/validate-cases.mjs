// validate-cases.mjs — wbs-validate 시험이 함께 쓰는 입력(원본 test_wbs_validate.py 의 WBS 상수)과
// 골든 비교용 CLI 케이스 정의. validate.test.mjs 와 make-expected.mjs 가 import 한다.
// 케이스는 임시 폴더에 files 를 쓰고 그 폴더를 cwd 로 삼아 args(상대 경로)로 돌린다 —
// 출력의 target 경로가 임시 폴더와 무관해야 기대값 파일을 만들 수 있기 때문이다.

export const CLEAN_WBS = `\
# WBS

## Dev Config
...

## WP-01: 인증

### TSK-01-01: 로그인 API
- domain: backend
- depends: -
- status: [ ]
- acceptance: 로그인 응답 200ms 이하 + 401 실패 시 에러 메시지 노출

본 Task는 백엔드 인증 엔드포인트 작성을 다룬다.

### TSK-01-02: 로그인 화면
- domain: frontend
- depends: TSK-01-01
- status: [ ]
- acceptance: e2e 테스트 통과 + 30초 안에 로그인 완료

## WP-02: 결제
- phase: PH-2
`;

export const PROBLEMATIC_WBS = `\
# WBS

## WP-01: foo

### TSK-01-01: 로그인 API
- domain: backend
- depends: TSK-99-99
- status: [ ]

설명만 있고 acceptance 없음. API 구현 진행.

### TSK-01-02: 검색 페이지
- domain: unknown_domain
- depends: -
- status: [ ]
- acceptance: 검색이 빠르게 동작
`;

export const FOURLEVEL_WBS = `\
# WBS

## WP-00: 초기화
- phase: PH-1

### ACT-00-01: 공통 기반

전 모듈이 공유하는 기술 기반.

#### TSK-00-01-01: 스캐폴드
- domain: backend
- depends: -
- status: [ ]
- acceptance: 헬스체크 200ms 이하 통과

##### PRD 요구사항
- requirements:
  - 프로젝트 생성

#### TSK-00-01-02: 시드
- domain: backend
- depends: TSK-00-01-01
- status: [ ]
- acceptance: 시드 3건 적재 확인

## WP-01: 기능
- phase: PH-2

### ACT-01-01: 로그인

#### TSK-01-01-01: 로그인 API
- domain: backend
- depends: TSK-00-01-02
- status: [ ]
- acceptance: 응답 200ms 이하
`;

export const FENCED_WBS = `\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]

Task 본문에 예시 셸 스크립트가 들어간다.

\`\`\`bash
# 배포 스크립트 예시 — 헤딩이 아니라 코드 주석이다
echo "deploy"
\`\`\`

- acceptance: 헬스체크 200ms 이하 통과

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
`;

export const FENCED_PHANTOM_TASK_WBS = `\
# WBS

## WP-01: 문서화

### TSK-01-01: 예시 문서 작성
- domain: docs
- depends: -
- status: [ ]
- acceptance: 예시 문서 리뷰 통과

예시로 다른 Task 헤딩 형식을 코드 블록에 보여준다.

\`\`\`markdown
#### TSK-99-99-99: 이것은 예시일 뿐 실제 Task 가 아니다
\`\`\`

### TSK-01-02: 다음 Task
- domain: docs
- depends: -
- status: [ ]
- acceptance: 검증 완료
`;

export const FENCED_INDENTED_WBS = `\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]

리스트 항목 아래 들여쓴 펜스 코드 예시:

- 참고:
  \`\`\`bash
  # 들여쓴 펜스 안의 주석 — 헤딩이 아니다
  echo "deploy"
  \`\`\`

- acceptance: 헬스체크 200ms 이하 통과

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
`;

export const UNCLOSED_FENCE_WBS = `\
# WBS

## WP-01: 배포

### TSK-01-01: 배포 스크립트
- domain: backend
- depends: -
- status: [ ]
- acceptance: 헬스체크 200ms 이하 통과

예시 스크립트(펜스를 실수로 닫지 않음):

\`\`\`bash
# 배포 스크립트 예시 — 닫는 펜스가 없다

### TSK-01-02: 다음 Task
- domain: backend
- depends: -
- status: [ ]
- acceptance: 검증 완료
`;

export const MISPAIRED_FENCE_WBS = `\
# WBS

## WP-01: x

### TSK-01-01: A
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

\`\`\`bash
# 닫는 펜스를 빠뜨림

### TSK-01-02: B
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

### TSK-01-03: C
- domain: backend
- depends: -
- status: [ ]
- acceptance: 응답 200ms 이하

\`\`\`bash
echo ok
\`\`\`
`;

// ---- 골든용 경계 입력 --------------------------------------------------------

export const CRLF_WBS = CLEAN_WBS.replace(/\n/g, '\r\n');
export const BOM_WBS = `﻿${CLEAN_WBS}`;
export const BOM_CRLF_WBS = `﻿${CRLF_WBS}`;

// 모호 동사·정량 기준·한글 키워드·유니코드 경계가 섞인 문서
export const VAGUE_WBS = `\
# WBS

## WP-01: 한글

### TSK-01-01: 구현 시험
- domain: backend
- depends: TSK-01-02, TSK-09-09 none
- acceptance: 구현 완료

본문: 로그인 기능을 구현한다.
본문: 응답 99% 이하 구현
본문: 응답 99 % 이하 구현
본문: 50ms 구현
본문: 3건 배포
본문: 3 건 deploy
본문: 100% verify
본문: 5 hours verify
본문: 5hoursx verify
본문: 12 GB 정리
본문: 7 req/s 개선
본문: 7 req 개선
본문: 최적화 가 필요함
본문: Deploy 와 VERIFY 와 Implement
본문: 개선 \u{1F600}\u{1F600}
${'본문: 구현 '.repeat(2)}${'\u{1F600}'.repeat(130)}
본문: 한 줄 다음 줄 구현
본문: 구현   　끝

### TSK-01-02: 정리
- domain: frontend
- depends: -
- acceptance:
수락 기준입니다

본문: 구현

### TSK-01-03: 수락 기준 있음
- domain: default
- depends: TSK-01-01
- status: [ ]

수락 기준

### TSK-01-04: 수락 기준 한글 접미
- domain: N/A
- depends: -

수락기준입니다.
수락 기준이다
성공 기준입니다
완료 조건이다.

### TSK-01-05: heading acceptance
- domain: -
- depends: none

## Acceptance Criteria
- ok

### TSK-01-06: bold acceptance
- domain: DEFAULT

**ACCEPTANCE**
`;

// 헤딩 변형: 공백 종류·줄바꿈 낀 헤딩·전각 숫자·레벨 경계
export const HEADING_VARIANTS_WBS = `\
# WBS

## WP-01: 변형

###
TSK-01-01: 줄바꿈이 낀 헤딩
- domain: backend
- acceptance: 200ms 이하

###  TSK-01-02:   공백이 많은 제목   
- domain: backend
- acceptance: 200ms 이하

#####  TSK-01-03: 레벨 5
- domain: backend
- acceptance: 200ms 이하

###### TSK-01-04: 레벨 6 은 Task 가 아니다
## TSK-01-05: 레벨 2 도 아니다
### TSK-01: 세그먼트 하나뿐
### TSK-01-06 : 콜론 앞 공백
### TSK-01-07: NBSP 구분
###　TSK-01-08: 전각 공백 구분
###\u001cTSK-01-09: 파일 구분자 (python 만 공백)
###\u001fTSK-01-10: 단위 구분자
###﻿TSK-01-11: BOM 문자는 python 공백이 아니다
### TSK-０１-０２: 전각 숫자 ID
- acceptance: 200ms 이하
### TSK-01-12:
- domain: backend
- acceptance: 제목이 비어 있다
### TSK-01-13:	탭 뒤 제목 둘째 줄
- domain: backend
`;

// 메타 줄 변형: 값이 다음 줄로 넘어가는 경우, 대소문자, 중복 키
export const META_VARIANTS_WBS = `\
# WBS

### TSK-01-01: 메타 변형
- domain:
- depends: TSK-01-02
- status: [ ]
- Acceptance: 대문자 키 200ms 이하
- acceptance:   
- ACCEPTANCE: 중복 키 덮어쓰기
-
domain: 줄바꿈이 낀 키
-   key-with_dash  :   값 뒤 공백   
- 한글키: 값은 키가 아니다
- depends: TSK-01-02 TSK-01-03　TSK-01-04\u001cTSK-01-05,TSK-01-06;TSK-01-07

### TSK-01-02: 도메인 대소문자
- domain: Backend
- depends: TSK-01-01, , TSK-01-01
- acceptance: 5초

### TSK-01-03: 널 depends
- depends: None
- acceptance: 5초

### TSK-01-04: n/a depends
- depends: N/A
- acceptance: 5초

### TSK-01-05: 대시 depends
- depends: -
- acceptance: 5초
`;

// 줄 번호: 형 피드·LS 는 줄바꿈으로 세지 않는다
export const LINENO_WBS = `# WBS\n\n\f\n \n\x0b\n\n### TSK-01-01: A\n- acceptance: 1초\n\n\n### TSK-01-02: B\n- acceptance: 2초\n`;

// 구현 줄이 3개를 넘는다(상한 3)
export const VAGUE_CAP_WBS = `\
### TSK-01-01: 많다
- acceptance: 필요
구현 1
배포 2
검증 3
정리 4
개선 5
최적화 6
`;

const fenceDoc = (fence, close) => `# WBS\n\n### TSK-01-01: 펜스\n- acceptance: 1초\n\n${fence}\n# 주석\n### TSK-01-02: 안쪽\n${close}\n\n### TSK-01-03: 바깥\n- acceptance: 3초\n`;

export const FILES = {
  'clean.md': CLEAN_WBS,
  'crlf.md': CRLF_WBS,
  'bom.md': BOM_WBS,
  'bom-crlf.md': BOM_CRLF_WBS,
  'problem.md': PROBLEMATIC_WBS,
  'four.md': FOURLEVEL_WBS,
  'fenced.md': FENCED_WBS,
  'phantom.md': FENCED_PHANTOM_TASK_WBS,
  'indented.md': FENCED_INDENTED_WBS,
  'unclosed.md': UNCLOSED_FENCE_WBS,
  'mispaired.md': MISPAIRED_FENCE_WBS,
  'mispaired-noacc.md': MISPAIRED_FENCE_WBS.replace(
    '- acceptance: 응답 200ms 이하\n\n```bash\n# 닫는 펜스를 빠뜨림',
    '\n```bash\n# 닫는 펜스를 빠뜨림'),
  'empty.md': '',
  'blank.md': '\n\n  \n',
  'no-task.md': '# Empty WBS\n\n## WP-01\n',
  'vague.md': VAGUE_WBS,
  'headings.md': HEADING_VARIANTS_WBS,
  'meta.md': META_VARIANTS_WBS,
  'lineno.md': LINENO_WBS,
  'cap.md': VAGUE_CAP_WBS,
  'tilde.md': fenceDoc('~~~', '~~~'),
  'four-backtick.md': fenceDoc('````', '````'),
  'indent3.md': fenceDoc('   ```', '   ```'),
  'indent4.md': fenceDoc('    ```', '    ```'),
  'no-trailing-newline.md': CLEAN_WBS.trimEnd(),
  'sub/wbs.md': CLEAN_WBS,
  '한글/wbs.md': PROBLEMATIC_WBS,
};

const DC_BACKEND = JSON.stringify({ domains: { backend: {}, frontend: {} } });

/**
 * 골든 CLI 케이스. compare 기본값은 ['stdout','status','stderr'].
 * pyMsg313: python 3.13+ 에서는 stderr 문구가 달라 골든 비교에서 stderr 를 뺀다(기대값 파일 시험은 3.9 문구를 그대로 확인).
 * posixOnly: 경로 표기가 윈도우에서 달라지는 케이스(기대값 파일 시험에서 윈도우는 건너뜀).
 */
export const CLI_CASES = [
  ...Object.keys(FILES).filter((n) => n.endsWith('.md') && !n.includes('/')).map((n) => ({
    id: `file ${n}`, args: ['validate', '--wbs', n],
  })),
  ...['problem.md', 'meta.md', 'vague.md', 'headings.md', 'clean.md'].map((n) => ({
    id: `file ${n} + dev-config`, args: ['validate', '--wbs', n, '--dev-config-json', DC_BACKEND],
  })),
  { id: '--wbs=값 형태', args: ['validate', '--wbs=clean.md'] },
  { id: '옵션 순서 바꿈', args: ['validate', '--dev-config-json', DC_BACKEND, '--wbs', 'problem.md'] },
  { id: '경로 ./sub//wbs.md', args: ['validate', '--wbs', './sub//wbs.md'], posixOnly: true },
  { id: '경로 sub/wbs.md', args: ['validate', '--wbs', 'sub/wbs.md'], posixOnly: true },
  { id: '한글 경로', args: ['validate', '--wbs', '한글/wbs.md'], posixOnly: true },
  { id: '한글 경로 dev-config', args: ['validate', '--wbs', '한글/wbs.md', '--dev-config-json', DC_BACKEND], posixOnly: true },
  { id: '없는 파일', args: ['validate', '--wbs', 'nope.md'] },
  { id: '없는 한글 파일(ensure_ascii)', args: ['validate', '--wbs', '없음/없음.md'], posixOnly: true },
  { id: '없는 파일 ./x//y', args: ['validate', '--wbs', './x//y.md'], posixOnly: true },
  { id: '폴더를 wbs 로', args: ['validate', '--wbs', 'sub'] },
  { id: '빈 경로', args: ['validate', '--wbs', ''] },
  { id: 'dev-config 잘못된 JSON', args: ['validate', '--wbs', 'clean.md', '--dev-config-json', '{not valid'] },
  { id: 'dev-config 빈 문자열(없는 것으로 취급)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', ''] },
  ...[
    '{"a":1,}', '[1 2]', '"abc', "{'a':1}", '{"a" 1}', '{"a":}', '[1,]', '{"a":1} x', 'nul', '[', '{', '-', '01',
    '{"a":"\\x"}', '{"a":"\\u12"}', '{"a":"\n"}', '\n\n{bad', '{"한글": }', '😀', '[1,\n2,\n  x]',
  ].map((raw, i) => ({
    id: `dev-config 오류문구 ${i}: ${JSON.stringify(raw)}`,
    args: ['validate', '--wbs', 'clean.md', '--dev-config-json', raw],
    // python 3.13 부터 쉼표 뒤 닫는 괄호의 json 오류 문구가 바뀐다("Illegal trailing comma before end of …")
    pyMsg313: raw === '{"a":1,}' || raw === '[1,]',
  })),
  { id: 'dev-config domains 목록', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": ["backend"]}'] },
  { id: 'dev-config domains 문자열(부분 문자열 포함)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": "backend frontend"}'] },
  { id: 'dev-config {} (모두 미매핑)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{}'] },
  { id: 'dev-config null (없는 것으로 취급)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', 'null'] },
  { id: 'dev-config NaN 값', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": {"backend": NaN}}'] },
  { id: 'dev-config 큰 중첩', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": {"backend": {"a": [1, 2.5, {"b": null}]}, "x\\u00e9": 1}}'] },
  // python 은 traceback(종료 코드 1), node 는 TypeError — 종료 코드와 stdout 만 비교한다
  { id: 'dev-config 배열(python traceback)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '[]'], compare: ['stdout', 'status'] },
  { id: 'dev-config 문자열(python traceback)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '"x"'], compare: ['stdout', 'status'] },
  { id: 'dev-config 숫자(python traceback)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '123'], compare: ['stdout', 'status'] },
  { id: 'dev-config domains null(python traceback)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": null}'], compare: ['stdout', 'status'] },
  { id: 'dev-config domains 숫자(python traceback)', args: ['validate', '--wbs', 'problem.md', '--dev-config-json', '{"domains": 5}'], compare: ['stdout', 'status'] },
  { id: 'dev-config 배열이어도 default 도메인만이면 통과', args: ['validate', '--wbs', 'clean.md', '--dev-config-json', '[]'], compare: ['stdout', 'status'] },
  // argparse 문구는 달라서 종료 코드만 본다(사용 오류 = 2, 도움말 = 0)
  { id: '인자 없음', args: [], compare: ['status'] },
  { id: '알 수 없는 명령', args: ['bogus'], compare: ['status'] },
  { id: '--wbs 누락', args: ['validate'], compare: ['status'] },
  { id: '--wbs 값 없음', args: ['validate', '--wbs'], compare: ['status'] },
  { id: '알 수 없는 옵션', args: ['validate', '--wbs', 'clean.md', '--nope'], compare: ['status'] },
  { id: '남는 위치 인자', args: ['validate', '--wbs', 'clean.md', 'extra'], compare: ['status'] },
  { id: '--help', args: ['--help'], compare: ['status'] },
  { id: 'validate --help', args: ['validate', '--help'], compare: ['status'] },
];
