// 합성 구성 셋(개정 §6.5.7) — 설정을 읽는 도메인 계약 테스트가 describe.each 로 돈다. 고객 이름·실명 없음.
import type { ModuleId } from '@/lib/modules/defaults'
import type { StageCredits } from '@/lib/domain/stageCredits'

export interface SyntheticConfig {
  id: 'default' | 'research' | 'construction'
  name: string
  project: {
    'core.level_labels': string[]
    'modules.enabled': ModuleId[]
    'core.milestone_keywords'?: string[]
    'workflow.stage_credits'?: StageCredits
  }
  workspace: { 'modules.allowed': ModuleId[]; 'ai.enabled'?: boolean }
  /** SP5 A 달력(개정 §6.5.8) — 설정 화면 입력 꼴(week_start 는 요일 하나). default 구성은 없다(제품 기본값) */
  calendar?: {
    workspace: { 'calendar.timezone': string; 'calendar.working_days': number[]; 'calendar.week_start': 'sunday' | 'monday' }
    project: { 'calendar.timezone': string; 'calendar.working_days': number[]; 'calendar.week_start': 'sunday' | 'monday' }
    holidays: { date: string; name: string; kind: 'off' | 'work' }[]
    plannedPct: Record<string, Record<string, number>>
  }
}

export const SYNTHETIC_CONFIGS: readonly [SyntheticConfig, SyntheticConfig, SyntheticConfig] = [
  {
    id: 'default', name: '기본(제품 기본값에 가까운 SI 구성)',
    project: { 'core.level_labels': ['Phase', 'Task', 'Activity'], 'modules.enabled': ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'] },
    workspace: { 'modules.allowed': ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot', 'minutes', 'minutes_integration', 'portfolio', 'usage'] },
  },
  {
    id: 'research', name: 'R — 연구 과제(위키·회의록 중심, 에이전트 없음)',
    project: {
      'core.level_labels': ['과제', '세부과제', '연구항목', '실험'],
      'modules.enabled': ['meetings', 'weekly', 'issues', 'wiki'],
      'core.milestone_keywords': ['중간보고', '최종보고', 'milestone'],
      'workflow.stage_credits': { default: { as: 0, ip: 20, rw: 30, im: 90, xx: 100 } },
    },
    workspace: { 'modules.allowed': ['meetings', 'weekly', 'issues', 'wiki', 'minutes', 'portfolio'] },
    calendar: {
      workspace: { 'calendar.timezone': 'America/Los_Angeles', 'calendar.working_days': [1, 2, 3, 4, 5], 'calendar.week_start': 'sunday' },
      project: { 'calendar.timezone': 'America/Los_Angeles', 'calendar.working_days': [1, 2, 3, 4, 5], 'calendar.week_start': 'sunday' },
      holidays: [],
      plannedPct: { '2026-10-12': { A: 60 }, '2026-10-26': { B: 60 } },
    },
  },
  {
    id: 'construction', name: 'C — 건설 현장(근태·공지 중심, AI 끔)',
    project: {
      'core.level_labels': ['공구', '공종', '작업'],
      'modules.enabled': ['kanban', 'weekly', 'announcements', 'attendance', 'issues', 'wiki'],   // wiki 는 켜 두지만 ai.enabled=false 로 빠진다. weekly — SP4 S4(월)(D40)
      'core.milestone_keywords': [],
      'workflow.stage_credits': { default: { as: 0, ip: 10, rw: 20, im: 80, xx: 100 } },
    },
    workspace: { 'modules.allowed': ['kanban', 'weekly', 'announcements', 'attendance', 'issues', 'wiki', 'minutes', 'usage'], 'ai.enabled': false },
    calendar: {
      workspace: { 'calendar.timezone': 'Europe/Berlin', 'calendar.working_days': [1, 2, 3, 4, 5, 6], 'calendar.week_start': 'monday' },
      project: { 'calendar.timezone': 'Europe/Berlin', 'calendar.working_days': [1, 2, 3, 4, 5, 6], 'calendar.week_start': 'monday' },
      holidays: [{ date: '2026-10-10', name: '합성 휴무', kind: 'off' }, { date: '2026-10-25', name: '합성 근무', kind: 'work' }],
      plannedPct: { '2026-10-12': { A: 60 }, '2026-10-26': { B: 67 } },
    },
  },
]
