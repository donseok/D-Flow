// 워크스페이스 삭제가 거부됐을 때의 "남은 것" — delete_empty_workspace RPC(0055)의 remaining(표 이름 → 행 수)을 화면 항목으로.
import { describe, expect, it } from 'vitest'
import { WORKSPACE_REMAINING_KEYS, workspaceRemainingItems } from '@/lib/workspace/deleteRemaining'
import { KO } from '@/lib/i18n/dict/ko'

describe('workspaceRemainingItems', () => {
  it('아는 표는 정해진 순서로 — 표 이름의 순서와 무관하다', () => {
    expect(workspaceRemainingItems({ teams: 2, workspace_members: 4, projects: 15, 'storage.objects': 1 })).toEqual([
      { key: 'projects', count: 15 }, { key: 'members', count: 4 }, { key: 'teams', count: 2 }, { key: 'files', count: 1 },
    ])
  })
  it('같은 항목의 표는 합친다(AI 색인 문서·작업), 0 은 뺀다', () => {
    expect(workspaceRemainingItems({ ai_documents: 40, ai_index_jobs: 55, minutes: 0 })).toEqual([{ key: 'ai_index', count: 95 }])
  })
  it('모르는 표(새로 생긴 참조 표)는 버리지 않고 other 로 — 표 이름을 함께, 이름 순으로 맨 뒤에', () => {
    expect(workspaceRemainingItems({ zz_future_ref: 3, projects: 1, audit_trail: 2 })).toEqual([
      { key: 'projects', count: 1 }, { key: 'other', count: 2, table: 'audit_trail' }, { key: 'other', count: 3, table: 'zz_future_ref' },
    ])
  })
  it('형태가 어긋나면 null — "남은 것 없음"으로 읽히지 않게', () => {
    for (const bad of [null, undefined, [], 'x', 3, { projects: '3' }, { projects: -1 }, { projects: 1.5 }, { 'DROP TABLE x': 1 }, { '<b>': 2 }]) {
      expect(workspaceRemainingItems(bad), JSON.stringify(bad)).toBeNull()
    }
  })
  it('빈 객체는 빈 목록(호출부가 거부 결과의 빈 목록을 실패로 다룬다)', () => {
    expect(workspaceRemainingItems({})).toEqual([])
  })
  it('프로토타입 이름의 표는 아는 항목으로 읽지 않는다', () => {
    expect(workspaceRemainingItems({ constructor: 1 })).toEqual([{ key: 'other', count: 1, table: 'constructor' }])
  })
  it('항목마다 문구가 있다(other 포함)', () => {
    for (const key of [...WORKSPACE_REMAINING_KEYS, 'other']) {
      const k = `platform.ws.remaining.${key}` as keyof typeof KO
      expect(KO[k], k).toContain('{n}')
    }
  })
})
