// _wbs_md.mjs — shared Markdown fence-awareness helpers for the WBS toolchain.
// python `_wbs_md.py` 의 node 이식. 내보내는 이름·동작은 python 판과 같다
// (FENCE_RE, _fenced_ranges, _in_ranges, line_start_offsets).
//
// wbs-validate, wbs-parse 모두 wbs.md 를 파싱할 때 펜스 코드 블록(``` 또는 ~~~) 내부의
// `#` 으로 시작하는 줄을 진짜 헤딩과 구별해야 한다 — 그러지 않으면 Task 본문에 예시로 들어간
// ```markdown 펜스 안의 `## WP-99:` / `### ACT-99-01:` 같은 줄이 phantom 노드를 만들거나(과다 탐지)
// 실제 블록 경계를 조기에 끊어(silent undercount) 데이터가 조용히 사라진다.
//
// 이식 메모
//  - 오프셋은 JS 문자열 인덱스(UTF-16 코드 유닛)다. python 은 코드포인트라 이모지 같은 비 BMP 문자가
//    앞에 있으면 숫자가 달라지지만, 오프셋을 같은 문서 안에서만 쓰므로(content.slice, 줄 번호 계산) 결과는 같다.
//  - `^`(re.MULTILINE)는 python 에서 `\n` 바로 뒤(또는 문자열 처음)에서만 일치한다. JS 의 m 플래그는
//    CR(U+000D)·LS(U+2028)·PS(U+2029) 뒤에서도 일치하므로 쓰지 않고 `(?<![^\n])` 로 같은 뜻을 만든다.
//  - FENCE_RE 는 g 플래그가 있다. 반복에는 `content.matchAll(FENCE_RE)` 를 쓴다(python `finditer`).
//    `.exec`/`.test` 를 쓰면 lastIndex 상태가 남으니 피한다.

import { splitlinesPy } from '../../_shared/node/pytext.mjs';

// 펜스 코드 블록 시작/끝 줄(```` 또는 ~~~~, 리스트 항목 아래 들여쓴 펜스 포함 최대 3칸까지 CommonMark 허용).
// 펜스 내부의 `# ...` 줄(셸 주석 등)은 헤딩이 아니다 — 블록 경계 계산에서 제외해야 한다.
export const FENCE_RE = /(?<![^\n])[ ]{0,3}(?:`{3,}|~{3,})/g;

/**
 * 펜스 코드 구간의 [start, end] 오프셋 목록. 여는/닫는 펜스 줄을 순서대로 짝짓는다.
 *
 * 닫는 펜스가 없는 경우(짝이 없는 마지막 펜스, 실수로 안 닫은 경우 등) 그 뒤를 통째로 '펜스 안'으로
 * 간주하지 않는다 — 그렇게 하면 그 뒤에 오는 진짜 Task 헤딩까지 탐지에서 사라져(silent undercount)
 * 과소 탐지 + ok:true 결함을 재도입하게 된다. 의심스러우면 펜스로 취급하지 않는 쪽을 택해 Task 를 잃지 않는다.
 * @param {string} content
 * @returns {[number, number][]}
 */
export function _fenced_ranges(content) {
  const positions = [...content.matchAll(FENCE_RE)].map((m) => m.index);
  const ranges = [];
  for (let i = 0; i + 1 < positions.length; i += 2) {
    ranges.push([positions[i], positions[i + 1]]);
  }
  // 짝 없는 마지막 펜스(홀수 번째)는 구간으로 만들지 않는다
  return ranges;
}

/** @param {number} pos @param {[number, number][]} ranges */
export function _in_ranges(pos, ranges) {
  return ranges.some(([start, end]) => start <= pos && pos < end);
}

/**
 * 각 줄의 시작 문자 오프셋 목록 (`splitlinesPy(content)` 와 인덱스 대응).
 *
 * `_fenced_ranges`/`_in_ranges` 는 문자 오프셋 기준이지만, 줄 단위로 스캔하는 소비자(wbs-parse 의
 * parse_nodes/extract_task_block)는 줄 번호만 갖고 있다. 각 인덱스에 대응하는 시작 오프셋을 돌려주어,
 * 그 줄이 펜스 안인지 `_in_ranges(offsets[i], ranges)` 로 바로 물을 수 있게 한다.
 * @param {string} content
 * @returns {number[]}
 */
export function line_start_offsets(content) {
  const offsets = [];
  let pos = 0;
  for (const line of splitlinesPy(content, true)) {
    offsets.push(pos);
    pos += line.length;
  }
  return offsets;
}
