// decision-log-fixed-time.mjs — 시험 전용 실행 래퍼. 현재 시각을 2026-10-07T00:00:00Z 로 고정하고 decision-log.mjs 의 main 을 돌린다.
// decision-log 는 CLI 로 시각을 주입할 수 없다(python 판도 마찬가지). `_shared/node/goldentool.mjs` 는 두 판의 저장소 파일을 바이트로 비교하므로
// 시각이 같아야 해서, python 쪽은 같은 시각으로 고정하는 래퍼(decision-log.golden.test.mjs 가 env.dir 에 만든다)를 쓰고
// node 쪽은 이 파일을 쓴다. 제품 코드에는 이런 주입 수단을 두지 않는다.
import { finish } from '../../_shared/node/exit.mjs';

const FIXED = Date.parse('2026-10-07T00:00:00Z');
const RealDate = Date;
globalThis.Date = class FixedDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(FIXED);
    else super(...a);
  }

  static now() {
    return FIXED;
  }
};

const { main } = await import('../scripts/decision-log.mjs');
finish(main());
