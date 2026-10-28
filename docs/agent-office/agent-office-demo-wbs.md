---
project: 에이전트 오피스 실습
module: office-demo
start_date: 2026-10-23
levels:
  - { name: 단계, prefix: PH, progress: rollup }
  - { name: 묶음, prefix: WP, progress: rollup }
  - { name: 작업, prefix: TSK, progress: input }
credits:
  default: { 대기: 0, 설계: 20, 구현중: 50, 구현완료: 70, 테스트완료: 90, 검수완료: 100 }
---

# 에이전트 오피스 실습 WBS

## PH-01: PC 연결 및 개발 실습

### WP-01: 한 대에서 처음부터 끝까지 확인

- [ ] TSK-01-01: 이름 정리 함수 개발   w:1
  - category: dev
  - domain: backend
  - priority: high
  - requirements: Node.js ES module인 src/normalize-name.mjs에 named export normalizeName(value)을 구현한다. 문자열이면 앞뒤 공백을 제거하고, 그 결과가 비어 있거나 문자열이 아니면 '이름 없음'을 반환한다. tests/normalize-name.test.mjs에 node:test와 node:assert/strict로 검증을 추가한다. 이 두 파일과 해당 작업의 docs/tasks 기록만 변경하고 package.json 및 다른 작업 파일은 변경하지 않는다.
  - acceptance: '  홍길동  '은 '홍길동' / 빈 문자열과 공백뿐인 문자열은 '이름 없음' / null과 숫자는 '이름 없음' / npm test 전체 통과

### WP-02: PC 네 대에서 독립 작업 병렬 개발

- [ ] TSK-02-01: 합계 함수 개발   w:1
  - category: dev
  - domain: backend
  - priority: medium
  - requirements: Node.js ES module인 src/sum-values.mjs에 named export sumValues(values)를 구현한다. 인자는 유한한 숫자 배열이며 합계를 반환한다. 빈 배열은 0을 반환한다. 배열이 아니거나 숫자가 아닌 원소 또는 Infinity나 NaN이 있으면 TypeError를 던진다. tests/sum-values.test.mjs에 node:test와 node:assert/strict로 검증을 추가한다. 이 두 파일과 해당 작업의 docs/tasks 기록만 변경하고 package.json 및 다른 작업 파일은 변경하지 않는다.
  - acceptance: [1,2,3]은 6 / []는 0 / [-1,1]은 0 / 잘못된 입력은 TypeError / npm test 전체 통과

- [ ] TSK-02-02: 퍼센트 표시 함수 개발   w:1
  - category: dev
  - domain: backend
  - priority: medium
  - requirements: Node.js ES module인 src/format-percent.mjs에 named export formatPercent(value)를 구현한다. value는 이미 퍼센트 단위인 유한한 숫자다. 소수 첫째 자리로 반올림하여 소수 한 자리와 %를 붙인 문자열을 반환한다. 숫자가 아니거나 Infinity나 NaN이면 TypeError를 던진다. tests/format-percent.test.mjs에 node:test와 node:assert/strict로 검증을 추가한다. 이 두 파일과 해당 작업의 docs/tasks 기록만 변경하고 package.json 및 다른 작업 파일은 변경하지 않는다.
  - acceptance: 12.34는 '12.3%' / 0은 '0.0%' / 100은 '100.0%' / 문자열과 NaN은 TypeError / npm test 전체 통과

- [ ] TSK-02-03: 안전한 나눗셈 함수 개발   w:1
  - category: dev
  - domain: backend
  - priority: medium
  - requirements: Node.js ES module인 src/safe-divide.mjs에 named export safeDivide(a,b)를 구현한다. 두 인자는 유한한 숫자여야 하며 아니면 TypeError를 던진다. b가 0 또는 -0이면 null을 반환하고 나머지는 a/b를 반환한다. tests/safe-divide.test.mjs에 node:test와 node:assert/strict로 검증을 추가한다. 이 두 파일과 해당 작업의 docs/tasks 기록만 변경하고 package.json 및 다른 작업 파일은 변경하지 않는다.
  - acceptance: (6,3)은 2 / (0,3)은 0 / (1,0)과 (1,-0)은 null / ('6',3)은 TypeError / npm test 전체 통과

- [ ] TSK-02-04: 긴 문장 줄이기 함수 개발   w:1
  - category: dev
  - domain: backend
  - priority: medium
  - requirements: Node.js ES module인 src/shorten-text.mjs에 named export shortenText(text,maxLength)를 구현한다. text는 문자열, maxLength는 0 이상의 정수여야 하며 아니면 TypeError를 던진다. Array.from(text)로 센 코드 포인트 수가 maxLength 이하면 원문을 반환한다. 더 길면 앞 maxLength개 코드 포인트와 '…'를 붙여 반환한다. 빈 문자열은 항상 빈 문자열이다. tests/shorten-text.test.mjs에 node:test와 node:assert/strict로 검증을 추가한다. 이 두 파일과 해당 작업의 docs/tasks 기록만 변경하고 package.json 및 다른 작업 파일은 변경하지 않는다.
  - acceptance: ('가나다',2)는 '가나…' / ('가나',2)는 '가나' / ('abc',0)은 '…' / ('',0)은 '' / 음수 길이는 TypeError / npm test 전체 통과
