import type { DictKey } from '@/lib/i18n/dict'

/** WBS 엑셀 내보내기(/api/export)를 fetch→blob 으로 받아 내려받는다. 실패 본문의 error·code·상태를 돌려주고 토스트는 호출부가 띄운다.
 *  <a href> 로 받으면 409·422·400 JSON 이 탭에 날것으로 뜬다(설정 화면의 옛 버튼). 파일명은 Content-Disposition 의 filename*. */
export async function downloadWbsExport(
  projectId: string,
  opts: { expand: boolean },
): Promise<{ ok: true } | { ok: false; error: string | null; status: number | null; code: string | null }> {
  const qs = `projectId=${encodeURIComponent(projectId)}${opts.expand ? '&expand=1' : ''}`
  let res: Response
  try {
    res = await fetch(`/api/export?${qs}`)
  } catch (e) {
    // 네트워크 실패(오프라인 등)도 같은 실패 모양으로 — 던지면 호출부의 try/finally 를 지나 토스트 없이 끝난다.
    console.error('[downloadWbsExport] 내보내기 요청 실패:', e)
    return { ok: false, error: null, status: null, code: null }
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string; code?: string } | null
    return { ok: false, error: err?.error ?? null, status: res.status, code: typeof err?.code === 'string' ? err.code : null }
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `wbs_export_${projectId}.xlsx`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { ok: true }
}

/** 실패 토스트의 설명 사전 키 — 서버 본문(한국어)을 그대로 싣지 않고 본문의 기계 코드, 없으면 상태 코드로 고른다. null 이면 제목(실패)만.
 *  같은 422·409 가 단계 이름 손상·부재(CONFIG_*)와 양식 손상·부재(PROFILE_*) 두 뜻이라 code 가 먼저다 — 상태 코드만 보면
 *  정상 양식을 비우라는 틀린 처방이 나간다. 모르는 code 는 추측하지 않는다(null). code 가 없으면(옛 서버) 상태 코드 매핑.
 *  400 은 호출부로 갈린다: 접기(설정 화면)는 양식보다 깊은 WBS 뿐, 펼침(마법사)은 아웃라인 양식도 있다(api/export). */
export function exportFailureKey(status: number | null, expand: boolean, code: string | null = null): DictKey | null {
  if (code === 'CONFIG_INVALID' || code === 'CONFIG_REQUIRED') return 'settings.exportErrLevelLabels'
  if (code === 'PROFILE_CORRUPT') return 'settings.exportErrProfileCorrupt'
  if (code === 'PROFILE_REQUIRED') return 'importWizard.exportProfileNeedsSaved'
  if (code !== null) return null
  if (status === 409) return 'importWizard.exportProfileNeedsSaved'
  if (status === 422) return 'settings.exportErrProfileCorrupt'
  if (status === 400) return expand ? 'importWizard.exportProfileUnsupported' : 'settings.exportErrProfileTooDeep'
  return null
}
