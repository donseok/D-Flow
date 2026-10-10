// 시작/종료 역전 오류 문구 — 같은 규칙이 화면마다 다른 문장으로 나오던 것을 사전 한 키(common.err.dateOrder)로 모은다(BUG-21).
// 대상 이름만 다른 경우(이슈의 '목표 해결일')도 같은 문형이다: "{시작 이름}은 {종료 이름}보다 늦을 수 없습니다."
// 조사는 이름의 받침으로 고른다(particle.ts) — 문구에 '은/는' 을 박아 두지 않는다.
import type { DictKey } from './dict'
import { josa } from './particle'
import { fill } from './translate'

/** 역전 오류 한 줄 — 이름을 주지 않으면 '시작일'·'종료일'. 서버 번역 함수(ServerTranslate)도 그대로 받는다 */
export function dateOrderMessage(
  t: (key: DictKey) => string,
  labels: { start?: DictKey; end?: DictKey } = {},
): string {
  return fill(t('common.err.dateOrder'), {
    start: josa(t(labels.start ?? 'common.date.start'), '은/는'),
    end: t(labels.end ?? 'common.date.end'),
  })
}
