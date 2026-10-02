// 요청이 실을 워크스페이스(과제 34) — 프로젝트 화면은 싣지 않는다(프로젝트가 판정한다 — 게시가 한 커밋 늦어 다른 워크스페이스가 실리면
// 서버가 404 로 닫아 AI 가 꺼진다), /w/<slug> 화면은 게시된 범위의 슬러그가 경로와 같을 때만(다르면 아직 이전 범위 — 기다린다).
import { describe, expect, it } from 'vitest'
import { requestWorkspaceId } from '@/lib/workspace/requestScope'

const A = { id: '00000000-0000-0000-7e57-000000001761', slug: 'acme', name: 'Acme' }
const scope = (workspace: typeof A | null) => ({ workspace })

describe('requestWorkspaceId', () => {
  it('워크스페이스 화면 — 게시 범위의 슬러그가 경로와 같으면 그 id', () => {
    expect(requestWorkspaceId('/w/acme', scope(A))).toBe(A.id)
    expect(requestWorkspaceId('/w/acme/minutes/x', scope(A))).toBe(A.id)
  })
  it('워크스페이스 화면 — 게시가 아직 이전 범위(슬러그 다름)면 null', () => {
    expect(requestWorkspaceId('/w/beta/minutes', scope(A))).toBeNull()
  })
  it('프로젝트 화면은 늘 null(프로젝트가 판정한다)', () => {
    expect(requestWorkspaceId('/p/00000000-0000-0000-7e57-000000001762/wbs', scope(A))).toBeNull()
  })
  it('범위 없음(첫 게시 전·(global) 화면)은 null — 추측하지 않는다', () => {
    expect(requestWorkspaceId('/w/acme', null)).toBeNull()
    expect(requestWorkspaceId('/w/acme', scope(null))).toBeNull()
    expect(requestWorkspaceId('/account', null)).toBeNull()
  })
  it('범위 밖 경로(옛 경로·(global))도 게시 범위가 있으면 그 id', () => {
    expect(requestWorkspaceId('/account', scope(A))).toBe(A.id)
  })
})
