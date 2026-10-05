// SP5 B1 이전(issue_analysis 를 모듈로 등록하기 전) 모듈 목록 — 리터럴로 못 박는다(원천: src/lib/modules/defaults.ts @ 9a969e7d).
// 이미 저장된 modules.enabled·modules.allowed 값은 이 모양이다. 새 코드가 그 값을 여전히 받는지(parse)·새 모듈을 몰래 켜지 않는지
// 확인하는 호환 테스트(tests/settings/issues-defs.test.ts·tests/modules/effective-many.test.ts)와, 롤백 뒤 "두 목록에서 issue_analysis 0" 을
// 확인하는 SQL 쪽이 이 상수를 한 곳에서 공유한다. 레지스트리에서 계산하지 않는다 — 계산하면 레지스트리와 함께 틀려도 통과한다.

/** 옛 PROJECT_TOGGLABLE — 프로젝트 modules.enabled 에 들어갈 수 있던 아홉 */
export const PRE_B1_PROJECT_TOGGLABLE = ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'] as const

/** 옛 NON_CORE_MODULES — 워크스페이스 modules.allowed 에 들어갈 수 있던 열셋 */
export const PRE_B1_NON_CORE_MODULES = [
  'kanban', 'meetings', 'weekly', 'issues', 'wiki', 'announcements', 'attendance', 'agents',
  'minutes', 'minutes_integration', 'chatbot', 'portfolio', 'usage',
] as const
