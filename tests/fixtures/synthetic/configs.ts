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
  },
  {
    id: 'construction', name: 'C — 건설 현장(근태·공지 중심, AI 끔)',
    project: {
      'core.level_labels': ['공구', '공종', '작업'],
      'modules.enabled': ['kanban', 'announcements', 'attendance', 'issues', 'wiki'],   // wiki 는 켜 두지만 ai.enabled=false 로 빠진다
      'core.milestone_keywords': [],
      'workflow.stage_credits': { default: { as: 0, ip: 10, rw: 20, im: 80, xx: 100 } },
    },
    workspace: { 'modules.allowed': ['kanban', 'announcements', 'attendance', 'issues', 'wiki', 'minutes', 'usage'], 'ai.enabled': false },
  },
]
