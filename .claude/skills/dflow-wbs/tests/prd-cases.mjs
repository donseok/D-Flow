// prd-cases.mjs — prd-validate 골든·기대값 시험이 함께 쓰는 사례 목록(읽기 전용 검증이라 파일은 입력만).
// 사례 모양과 정규화 규칙은 case-runner.mjs 머리말 참고. 실제 리포 PRD·TRD 는 golden/inputs/ 에 얼린 사본으로 넣고(기대값용),
// 시험(prd-validate.test.mjs)이 살아 있는 docs/**/PRD.md·TRD.md 와 다른 문서도 python 판과 직접 비교한다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 실제 문서 사본(PRD.mdm.md·TRD.mdm.md)은 고객 자료라 공개 리포(D-Flow)에는 두지 않는다 — 없으면 null 이고 그 사례를 뺀다.
const input = (name) => {
  const p = path.join(HERE, 'golden', 'inputs', name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
const PRD_MDM = input('PRD.mdm.md');
const TRD_MDM = input('TRD.mdm.md');

const step = (args, extra = {}) => ({ args, ...extra });
const v = (file, extra = []) => step(['validate', '--target', file, ...extra]);

// 세 필수 절을 모두 갖춘 문서(여기에 문제 줄을 하나씩 얹어 검출을 본다).
const SECTIONS = '## Acceptance Criteria\n\n- 완료\n\n## Non-functional requirements\n\n- 성능\n\n## Constraints\n\n- 없음\n';
const doc = (body) => `# 제목\n\n${body}\n\n${SECTIONS}`;
const crlf = (t) => t.replace(/\n/g, '\r\n');

/** 한 문서를 file 로 두고 validate 한 번. */
const one = (id, text, extra = []) => ({ id, files: { 'p.md': text }, steps: [v('p.md', extra)] });

export const CASES = [
  // --- 실제 리포 문서(얼린 사본) ---
  ...(PRD_MDM === null ? [] : [{ id: '실제 PRD(mdm)', files: { 'PRD.md': PRD_MDM }, steps: [v('PRD.md'), v('PRD.md', ['--required-sections', 'acceptance criteria,NFR,constraints,glossary'])] }]),
  ...(TRD_MDM === null ? [] : [{ id: '실제 TRD(mdm)', files: { 'TRD.md': TRD_MDM }, steps: [v('TRD.md'), v('TRD.md', ['--required-sections', 'glossary,용어집,비기능 요구'])] }]),

  // --- 경계 입력 ---
  one('빈 파일', ''),
  one('개행만', '\n\n\n'),
  one('공백만', '   \n\t\n'),
  one('한 줄(개행 없음)', 'TBD'),
  one('CRLF 문서', crlf(doc('TBD 와 TODO 가 있다.\nfast 한 응답.'))),
  one('낱개 CR 줄끝', doc('a TBD\nb').replace(/\n/g, '\r')),
  one('BOM 으로 시작(첫 줄 머리글을 못 알아봄)', '﻿## Acceptance Criteria\n\n## Non-functional requirements\n\n## Constraints\n'),
  one('BOM + 일반 줄', `﻿# 제목\n\n${SECTIONS}`),
  one('섹션 전부 누락', '# 제목\n\n본문만 있다.\n'),
  one('섹션 일부 누락', '# 제목\n\n## Constraints\n'),
  one('모든 섹션 갖춤·문제 없음', doc('문서 본문은 평범하다.')),
  one('펜스 코드 블록 안의 TBD·TODO·???(그대로 검출)', doc('```\nTBD here\nTODO: x\n??? \n<MY_PLACEHOLDER>\n```')),
  one('펜스 코드 블록 안의 머리글은 섹션으로 인정', '# t\n\n```\n## Acceptance Criteria\n## Non-functional requirements\n## Constraints\n```\n'),
  one('들여쓴 머리글·머리글 아닌 줄', '# t\n\n   ## Acceptance Criteria\n\nAcceptance Criteria\n## Constraints\n'),
  one('# 뒤 공백 없음', '#Acceptance Criteria\n##Constraints\n'),
  one('머리글 레벨 7은 머리글이 아님', '####### Acceptance Criteria\n###### Constraints\n# NFR\n'),
  one('# 와 제목 사이에 빈 줄(\\s+ 가 줄바꿈을 먹음)', '#\n\nAcceptance Criteria\n\n##\n\n\nConstraints\n'),
  one('# 로 시작하는 줄 중간의 절 이름', '# 제목 안에 acceptance criteria 포함\n## 제약\n'),
  one('절 이름이 단어 일부', '## Acceptance Criterias\n## Unconstrained\n## Constraintsx\n'),
  one('절 이름 앞뒤 구두점·밑줄', '## (Acceptance Criteria)\n## _Constraints_\n## 1. Constraints.\n'),
  one('절 이름 대소문자 혼합', '## ACCEPTANCE CRITERIA\n## nOn-FuNcTiOnAl ReQuIrEmEnTs\n## cOnStRaInT\n'),
  one('절 이름 사이 공백이 여러 칸·탭·전각', '## Acceptance   \t Criteria\n## Non　functional  requirements\n## Constraints\n'),
  one('절 이름 사이 \\x1c·\\x85(python 공백)', '## Acceptance\x1c\x85Criteria\n## Constraints\n'),
  one('절 이름 사이 U+FEFF(JS 공백, python 공백 아님)', '## Acceptance﻿Criteria\n## Constraints\n'),
  one('non-functional 변형(하이픈·공백·붙임)', '## Non-functional Requirements\n'),
  one('non functional 공백형', '## Non functional requirements\n## Nonfunctional requirements\n## Non_functional requirements\n'),
  one('NFR 약어', '## NFR\n', ['--required-sections', 'non-functional requirements']),
  one('NFR 약어: 단어 일부는 아님', '## NFRs\n## xNFR\n## NFR_\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 수락 기준·완료 조건', '## 수락 기준\n', ['--required-sections', 'acceptance criteria']),
  one('한글 절: 완료조건(공백 없음)', '## 완료조건\n', ['--required-sections', 'acceptance criteria']),
  one('한글 절: 비기능 요구사항(뒤 글자 때문에 \\b 가 안 맞음)', '## 비기능 요구사항\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 비기능 요구(단어 끝)', '## 비기능 요구\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 비 기능 요구', '## 비 기능 요구 항목\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 성능/품질/보안', '## 성능/품질/보안\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 성능 품질 보안(공백 구분)', '## 성능 품질 보안\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 성능품질보안', '## 성능품질보안\n', ['--required-sections', 'non-functional requirements']),
  one('한글 절: 제약 사항·제약 조건', '## 제약 사항\n## 제약 조건\n', ['--required-sections', 'constraints']),
  one('한글 절: 제약사항(단어 끝 뒤 글자)', '## 제약사항입니다\n', ['--required-sections', 'constraints']),
  one('한글 절: 용어 정의·용어집', '## 용어 정의\n', ['--required-sections', 'glossary']),
  one('한글 절: 용어집', '# 9. 용어집\n', ['--required-sections', 'glossary']),
  one('한글 단어 경계: 앞 글자가 붙은 절 이름', '## 가Acceptance Criteria\n## 가용어집\n', ['--required-sections', 'acceptance criteria,glossary']),
  one('glossary 영어', '## Glossary of terms\n', ['--required-sections', 'glossary']),
  one('constraint 단수', '## Constraint\n', ['--required-sections', 'constraints']),
  one('사용자 지정 절: 별칭에 없는 이름은 리터럴', '## Release Plan (v2)\n## C++ notes\n## a.b\n', ['--required-sections', 'release plan,C++,a.b,Release Plan (v2),(v2)']),
  one('사용자 지정 절: 특수문자 이스케이프', '## x*y\n## [a]\n## {b}\n## p|q\n## ^caret\n## $dollar\n## back\\slash\n## 1+1\n## who?\n## a/b\n## a-b\n', ['--required-sections', 'x*y,[a],{b},p|q,^caret,$dollar,back\\slash,1+1,who?,a/b,a-b,a b']),
  one('사용자 지정 절: 대소문자 구분 없는 리터럴', '## release PLAN\n', ['--required-sections', 'Release Plan,RELEASE plan']),
  one('사용자 지정 절: 한글·이모지', '## 배포 계획 😀\n', ['--required-sections', '배포 계획,😀,배포']),
  one('사용자 지정 절: 공백·쉼표 처리', '## a\n## b\n', ['--required-sections', ' a , b ,, ,c,　d　']),
  one('사용자 지정 절: 빈 값(필수 절 없음)', '## a\n', ['--required-sections', '']),
  one('사용자 지정 절: 쉼표뿐', '## a\n', ['--required-sections', ',,,']),
  one('사용자 지정 절: 같은 이름 두 번', '', ['--required-sections', 'x,x']),
  one('사용자 지정 절: 별칭 키는 정확히 일치해야 별칭', '## Acceptance Criteria\n## NFR\n', ['--required-sections', 'Acceptance Criteria,NFR,acceptance  criteria']),
  one('사용자 지정 절: 별칭 키 NFR 은 별칭이 아님(리터럴 NFR)', '## Non-functional requirements\n', ['--required-sections', 'NFR']),
  one('사용자 지정 절: 값이 - 로 시작(공백 포함)', '## - a b\n', ['--required-sections', '- a b']),
  { id: '사용자 지정 절: 값이 - 로 시작(공백 없음)은 사용 오류', files: { 'p.md': '' }, steps: [step(['validate', '--target', 'p.md', '--required-sections', '-x'], { statusOnly: true })] },

  // --- placeholder ---
  one('placeholder: TBD·TODO 대소문자', doc('tbd 그리고 Todo 그리고 TBD.\n(TODO) [tbd] "TBD"')),
  one('placeholder: 단어 경계(붙은 글자·밑줄·숫자)', doc('TBDx xTBD TBD_ _TBD TBD1 1TBD TODOs mytodo TBD-TBD')),
  one('placeholder: 한글에 붙은 TBD(python \\b 는 한글을 단어로 봄)', doc('한TBD TBD한 한 TBD 한 TODO입니다 TODO가')),
  one('placeholder: 전각·유사 문자', doc('ＴＢＤ ＴＯＤＯ ТВD')),
  one('placeholder: ???', doc('?? ??? ???? ????? ? ? ?')),
  one('placeholder: <...> 형식', doc('<TBD> <MY_ITEM> <A_B> <AB> <ab_cd> <A B C> <X-Y-Z> <Z9> <A_> <_X_> <A0 ->')),
  one('placeholder: 한 줄에 여러 패턴(패턴 순서·위치 순서)', doc('??? TODO <FOO_BAR> TBD ??? TBD')),
  one('placeholder: 줄 길이 120 넘음(context 잘림)', doc(`${'가'.repeat(130)} TBD`)),
  one('placeholder: context 가 정확히 120/121 코드포인트', doc(`${'a'.repeat(113)} TBD xx\n${'a'.repeat(114)} TBD xx`)),
  one('placeholder: 비 BMP 문자가 앞에 있어 context 가 코드포인트 기준으로 잘림', doc(`${'😀'.repeat(119)}ab TBD 😀😀`)),
  one('placeholder: 줄 앞뒤 공백·탭·전각 공백(context 는 strip)', doc('\t　  TBD 앞뒤 공백 　\t')),
  one('placeholder: 줄 경계 문자(\\x0b \\x0c \\x1c \\x85 U+2028)로 줄이 갈림', 'a TBD\x0bb TODO\x0cc ???\x1cd\x85e <FOO_BAR> f g TBD\n'),
  one('placeholder: 줄 번호는 splitlines 기준(마지막 개행 뒤 빈 줄 없음)', 'TBD\n\nTBD\nTBD\n'),

  // --- vague metrics ---
  one('vague: 영어 단어 하나씩', doc('fast scalable user-friendly intuitive robust efficient modern seamless smooth easy')),
  one('vague: 줄마다 하나씩', doc('A fast app.\nA scalable app.\nUser-Friendly UI.\nINTUITIVE.\nRobust!\nEfficient\nModern look\nSeamless flow\nSmooth.\nEasy to use')),
  one('vague: 두 단어 표현', doc('high performance 이어야 한다.\nlow latency 가 필요.\nBest-In-Class 품질.\nWorld-Class.')),
  one('vague: blazing·lightning', doc('Blazing 하게.\nLightning 처럼.')),
  one('vague: 한글', doc('빠른 응답.\n빠르게 처리.\n쉬운 화면.\n사용자 친화 적 UI.\n직관적인 흐름.\n효율적 운영.\n원활한 연동.')),
  one('vague: 한 줄에 여러 개는 목록 앞쪽 용어만(break)', doc('easy 하고 fast 하고 robust')),
  one('vague: 부분 문자열도 검출(breast·fastener·uneasy·쉬운데)', doc('breast fastener uneasy 쉬운데 빠르다 빠른가')),
  one('vague: 정량 힌트가 있으면 건너뜀(단위별)', doc('fast 100ms\nfast 5 s\nfast 5 sec\nfast 5 seconds\nfast 5 minute\nfast 2 hours\nfast 5 p99\nfast 99.9%x\nfast 10MB\nfast 1 GB\nfast 3TB\nfast 4 KB\nfast 8 bytes\nfast 100 req/s\nfast 100 req\nfast 5 qps\nfast 5 tps\nfast 5 rps\nfast 2 kg\nfast 3 kgs\nfast 100 users\nfast 1 user\nfast 10 MAU\nfast 10 DAU')),
  one('vague: 정량 힌트가 아닌 모양(단어 경계 실패·단위 없음)', doc('fast 100\nfast ms\nfast p99\nfast 100msx\nfast x100ms\nfast p99x\nfast 5 secondsx\nfast 5 reqs\nfast 5 u')),
  one('vague: % 는 뒤에 단어 문자가 붙어야 \\b 가 맞음', doc('easy 99% 이상\nfast 99%x\nfast 99% 가량\nfast 99%')),
  one('vague: 힌트 대소문자·전각·아랍 숫자', doc('fast 5 MS\nfast 5 Sec\nfast 100 QPS\nfast ５ ms\nfast ٣ ms\nfast 1 ㎳')),
  one('vague: 숫자와 단위 사이 공백 종류', doc('fast 5 ms\nfast 5　ms\nfast 5\tms\nfast 5\x1cms\nfast 5﻿ms')),
  one('vague: 대문자 İ 때문에 lower() 길이가 달라지는 줄(match 슬라이스 위치)', doc('İİ fast 응답\nİ easy')),
  one('vague: 비 BMP 문자 뒤의 용어(코드포인트 위치)', doc('😀😀 fast 😀\n😀 빠른 응답')),
  one('vague: 큰 줄 context 120 잘림', doc(`${'x'.repeat(125)} fast`)),
  one('vague: 한글 용어가 영어 용어보다 앞 줄', doc('빠른 fast')),
  one('vague: 용어 목록 순서(앞선 용어가 이김)', doc('smooth seamless')),
  one('vague: 줄 경계 문자로 갈린 줄', 'a\x0bfast\x0cb easy\x1c robust\x85 smooth  modern\n'),
  one('vague: 마지막 줄 개행 없음', 'fast'),

  // --- 큰 입력 ---
  one('큰 문서: 2000줄 혼합', Array.from({ length: 2000 }, (_, i) => (i % 7 === 0 ? `줄 ${i} TBD fast` : i % 11 === 0 ? `## 절 ${i}` : `본문 ${i} 100 ms 이내`)).join('\n') + `\n${SECTIONS}`),
  one('긴 줄: 10만 글자(성능·정규식 폭주 없음)', `${'ab '.repeat(30000)}TBD\n${SECTIONS}`),
  one('긴 줄: 공백 3000 칸 뒤 머리글(\\s+ 와 .* 의 되돌림이 제곱으로 늘어남)', `#${' '.repeat(3000)}Acceptance Criteria\n`),
  one('긴 줄: # 뒤 공백 3000 칸 뒤에 절 이름 없음', `#${' '.repeat(3000)}x\n`),

  // --- 파일·경로 ---
  { id: '파일 없음(JSON 오류·종료 1)', steps: [v('nope.md')] },
  { id: '파일 없음: 경로 정리(./ // 끝 /)', steps: [v('./a//b.md'), v('a/./b.md/'), v('')] },
  { id: '대상이 폴더', files: { 'd/keep': '' }, steps: [v('d'), v('d/')] },
  { id: '경로: 상대 경로·하위 폴더·한글 이름', files: { '문서/요구사항 PRD.md': doc('TBD') }, steps: [v('문서/요구사항 PRD.md'), v('./문서//요구사항 PRD.md')] },
  { id: '경로: 절대 경로', files: { 'p.md': doc('TBD') }, steps: [step(['validate', '--target', '{ROOT}/p.md']), step(['validate', '--target', '{ROOT}//p.md'])] },
  { id: '경로: cwd 가 하위 폴더', files: { 'w/p.md': doc('TBD') }, steps: [step(['validate', '--target', 'p.md'], { cwd: 'w' }), step(['validate', '--target', '../w/p.md'], { cwd: 'w' })] },

  // --- 옵션 모양 ---
  { id: '옵션: --target=값·--required-sections=값', files: { 'p.md': '## x\n' }, steps: [step(['validate', '--target=p.md', '--required-sections=x,y'])] },
  { id: '옵션: 접두 축약(--tar, --req)', files: { 'p.md': '## x\n' }, steps: [step(['validate', '--tar', 'p.md', '--req', 'x'])] },
  { id: '옵션: 순서 바꿈', files: { 'p.md': '## x\n' }, steps: [step(['validate', '--required-sections', 'x', '--target', 'p.md'])] },
  { id: '옵션: 같은 옵션 두 번(뒤가 이김)', files: { 'p.md': '## x\n' }, steps: [step(['validate', '--target', 'nope.md', '--target', 'p.md', '--required-sections', 'q', '--required-sections', 'x'])] },
  { id: '사용 오류: 인자 없음', steps: [step([], { statusOnly: true })] },
  { id: '사용 오류: 알 수 없는 명령', steps: [step(['bogus'], { statusOnly: true })] },
  { id: '사용 오류: validate 에 target 없음', steps: [step(['validate'], { statusOnly: true })] },
  { id: '사용 오류: target 값이 없음', steps: [step(['validate', '--target'], { statusOnly: true })] },
  { id: '사용 오류: 알 수 없는 옵션', files: { 'p.md': '' }, steps: [step(['validate', '--target', 'p.md', '--nope'], { statusOnly: true })] },
  { id: '사용 오류: 남는 위치 인자', files: { 'p.md': '' }, steps: [step(['validate', '--target', 'p.md', 'extra'], { statusOnly: true })] },
  { id: '도움말: -h', steps: [step(['-h'], { statusOnly: true }), step(['validate', '-h'], { statusOnly: true })] },
  { id: '실패: 잘못된 UTF-8 파일(예외, 종료 1)', files: { 'bad.md': Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]) }, steps: [step(['validate', '--target', 'bad.md'], { statusOnly: true })] },

  // --- assumptions-template ---
  { id: 'assumptions-template', steps: [step(['assumptions-template']), step(['assumptions-template', '--target', 'x.md'])] },
];

/** node 판 출력 → python 판 문구로 되돌리기: 템플릿이 알려 주는 호출 예시가 python 에서 node 로 바뀐 것(의도한 차이). */
const NODE_CALL = 'node .claude/skills/dflow-wbs/scripts/decision-log.mjs list --target docs';
const PY_CALL = 'scripts/decision-log.py list --target docs';
export const fromNode = (t) => t.split(NODE_CALL).join(PY_CALL);
