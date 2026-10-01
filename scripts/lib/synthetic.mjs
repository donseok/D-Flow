// scripts/lib/synthetic.mjs — 합성 게이트(e2e-synthetic.mjs)의 구성값. 순수. .mjs 는 tests/fixtures/synthetic/configs.ts 를 import 하지 못해
// 한 번 더 적고, tests/scripts/synthetic.test.ts 가 같은 값인지 대조한다(드리프트 방지). 고객 이름·실명 없음.


export const SYNTHETIC_R = Object.freeze({
  slug: 'syn-r', name: '합성 연구 과제',
  config: Object.freeze({
    id: 'research',
    project: Object.freeze({
      'core.level_labels': Object.freeze(['과제', '세부과제', '연구항목', '실험']),
      'modules.enabled': Object.freeze(['meetings', 'weekly', 'issues', 'wiki']),
      'core.milestone_keywords': Object.freeze(['중간보고', '최종보고', 'milestone']),
      'workflow.stage_credits': Object.freeze({ default: Object.freeze({ as: 0, ip: 20, rw: 30, im: 90, xx: 100 }) }),
    }),
    workspace: Object.freeze({ 'modules.allowed': Object.freeze(['meetings', 'weekly', 'issues', 'wiki', 'minutes', 'portfolio']) }),
  }),
})

export const SYNTHETIC_C = Object.freeze({
  slug: 'syn-c', name: '합성 건설 현장',
  config: Object.freeze({
    id: 'construction',
    project: Object.freeze({
      'core.level_labels': Object.freeze(['공구', '공종', '작업']),
      'modules.enabled': Object.freeze(['kanban', 'announcements', 'attendance', 'issues', 'wiki']),
      'core.milestone_keywords': Object.freeze([]),
      'workflow.stage_credits': Object.freeze({ default: Object.freeze({ as: 0, ip: 10, rw: 20, im: 80, xx: 100 }) }),
    }),
    workspace: Object.freeze({ 'modules.allowed': Object.freeze(['kanban', 'announcements', 'attendance', 'issues', 'wiki', 'minutes', 'usage']), 'ai.enabled': false }),
  }),
})

/** 격리 시험의 '다른 워크스페이스' — R·C 의 설정을 읽을 수 없어야 한다 */
export const SYNTHETIC_WORKSPACE_B = Object.freeze({ slug: 'syn-b', name: '합성 타 워크스페이스' })

/** 아직 켜지지 않은 단계 → 켜는 SP(개정 §6.5.8, 스펙 D25). 건너뜀으로 세지 않고 '미활성'으로 기록한다. */
export const PENDING_STEPS = Object.freeze({
  S2: 'SP4', S3: 'SP5b·SP5c', S4: 'SP4(월)·SP5(일)', S5: 'SP5', S6: 'SP5·SP5b', S7: 'SP8(봇)·SPU1(개인 알림)', S8: 'SP6', S10: 'SP4~SP8',
})

