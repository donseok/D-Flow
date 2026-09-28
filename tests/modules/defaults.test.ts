// 모듈 상수(스펙 §4.1·개정 §2.7)와 플래그 술어. 상수는 잎 파일이라 값으로 고정한다 — 과제 5 의 레지스트리 테스트가 MODULES 와 대조한다.
import { describe, expect, it } from 'vitest'
import { AI_MODULES, CORE_MODULES, MODULE_IDS, NON_CORE_MODULES, OFF_ON_CREATE, PROJECT_TOGGLABLE, WORKSPACE_SCOPED, isModuleId } from '@/lib/modules/defaults'
import { MODULE_FLAG_NAMES, agentApiEnabled, chatV2Enabled, wikiServiceEnabled } from '@/lib/modules/flags'

describe('모듈 상수', () => {
  it('17개 id, core 4, 프로젝트 토글 9, 워크스페이스 4, AI 2, 생성 때 꺼지는 것 0', () => {
    expect(MODULE_IDS).toHaveLength(17)
    expect(new Set(MODULE_IDS).size).toBe(17)
    expect(CORE_MODULES).toEqual(['dashboard', 'wbs', 'members', 'settings'])
    expect([...PROJECT_TOGGLABLE]).toEqual(['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'])
    expect([...WORKSPACE_SCOPED]).toEqual(['minutes', 'minutes_integration', 'portfolio', 'usage'])
    expect(AI_MODULES).toEqual(['wiki', 'chatbot'])
    expect(OFF_ON_CREATE).toEqual([])
    expect(NON_CORE_MODULES).toEqual(MODULE_IDS.filter((id) => !CORE_MODULES.includes(id)))
    expect(NON_CORE_MODULES).toHaveLength(13)
  })
  it('세 집합은 서로 겹치지 않고 합치면 전부다', () => {
    const all = [...CORE_MODULES, ...PROJECT_TOGGLABLE, ...WORKSPACE_SCOPED]
    expect(new Set(all).size).toBe(17)
    expect([...all].sort()).toEqual([...MODULE_IDS].sort())
  })
  it('isModuleId', () => {
    expect(isModuleId('wbs')).toBe(true)
    expect(isModuleId('issue_analysis')).toBe(false)   // SP5 부터
    expect(isModuleId(null)).toBe(false)
  })
})

describe('플래그 술어', () => {
  it("'true' 문자열만 참이다 — '1'·'TRUE'·빈 값은 거짓", () => {
    expect(wikiServiceEnabled({ WIKI_SERVICE_ENABLED: 'true' })).toBe(true)
    for (const v of ['1', 'TRUE', 'yes', '', undefined]) expect(wikiServiceEnabled({ WIKI_SERVICE_ENABLED: v }), String(v)).toBe(false)
    expect(chatV2Enabled({})).toBe(false)
    expect(agentApiEnabled({ AGENT_API_ENABLED: 'true' })).toBe(true)
  })
  it('플래그 이름 8개 — 운영 설정 목록(Phase C)과 env:local 이 이 목록을 쓴다', () => {
    expect(MODULE_FLAG_NAMES).toEqual(['AGENT_API_ENABLED', 'MINUTES_API_ENABLED', 'WIKI_SERVICE_ENABLED', 'WIKI_WORKER_ENABLED',
      'CHAT_V2_ENABLED', 'CHAT_V2_PLANNER_ENABLED', 'CHAT_V2_LLM_SYNTHESIS_ENABLED', 'CHAT_V2_INDEX_WORKER_ENABLED'])
  })
})
