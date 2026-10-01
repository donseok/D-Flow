// 백그라운드 설정 저장(디바운스) 전용 라우트 — 2026-08-18 성능 후속.
//
// 왜 서버 액션이 아니라 라우트인가: Next 는 **서버 액션이 성공할 때마다 클라이언트
// 라우터 캐시 전체를 비운다**. queueUiPref 는 프로젝트 메뉴 이동마다 최근 프로젝트를
// 저장하므로(ProjectNavigationContext), 액션으로 두면 내비게이션마다 캐시가 비워져
// experimental.staleTimes(30s) 가 사실상 무효였다(실측). 설정 저장은 화면 RSC 내용을
// 바꾸지 않는 부차 쓰기라 캐시를 비울 이유가 없다 — 일반 POST 로 옮긴다.
//
// 인가는 내부 함수가 세션으로 판정한다(비로그인 = 아래 거부 응답, 본인 행만 upsert).
// CSRF: JSON content-type 은 cross-origin 에서 preflight 를 강제하고 이 라우트는 CORS
// 를 열지 않으므로 타 사이트발 쓰기는 차단된다(+ SameSite=Lax 쿠키). 그 전제를 코드로 둔다 — application/json 이 아니면
// 본문을 읽지 않고 415(text/plain 폼으로 JSON 본문을 지어 보내는 단순 요청을 받지 않는다, U2a-2 리뷰 Y5).
// 개인 설정의 범위(SP3b D9): 계정 키는 account_preferences, 워크스페이스 키는 본문의 workspaceId 행(그 화면의 워크스페이스 —
// 쿠키를 읽지 않는다. 두 탭이 서로 다른 워크스페이스를 볼 때 남의 행에 쓰지 않게). 소속은 saveUiPrefs 가 확인한다.
// 거부 응답은 하나다(W10) — 없는 워크스페이스·비소속·형식 밖·저장 실패가 같은 403·같은 문구라 응답이 존재 오라클이 되지 않는다.
import { type NextRequest, NextResponse } from 'next/server'
import { saveUiPrefs, saveWbsCollapse } from '@/app/actions/preferences'
import type { UiPrefs } from '@/lib/domain/types'

type Body = {
  prefs?: Partial<UiPrefs>
  workspaceId?: string
  wbsCollapse?: { projectId: string; ids: string[] }
}

/** 개인 설정 저장 거부의 단일 응답 문구 — 사유별로 나누지 않는다(W10) */
const PREFS_DENIED = '설정을 저장하지 못했습니다'

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') ?? ''
  if (!/^application\/json(\s*;|$)/i.test(ct.trim())) return NextResponse.json({ ok: false }, { status: 415 })
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false }, { status: 400 })
  let denied = false
  if (body.prefs && typeof body.prefs === 'object' && !Array.isArray(body.prefs)) {
    const r = await saveUiPrefs(body.prefs, { workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : null })
    denied = !r.ok
  }
  const wc = body.wbsCollapse
  if (wc && typeof wc.projectId === 'string' && Array.isArray(wc.ids) && wc.ids.every(x => typeof x === 'string')) {
    await saveWbsCollapse(wc.projectId, wc.ids)
  }
  if (denied) return NextResponse.json({ ok: false, error: PREFS_DENIED }, { status: 403 })
  return NextResponse.json({ ok: true })
}
