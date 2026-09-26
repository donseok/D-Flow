/** WBS 엑셀 내보내기(/api/export)를 fetch→blob 으로 받아 내려받는다. 실패 본문의 error 를 돌려주고 토스트는 호출부가 띄운다.
 *  <a href> 로 받으면 409·422·400 JSON 이 탭에 날것으로 뜬다(설정 화면의 옛 버튼). 파일명은 Content-Disposition 의 filename*. */
export async function downloadWbsExport(
  projectId: string,
  opts: { expand: boolean },
): Promise<{ ok: true } | { ok: false; error: string | null }> {
  const qs = `projectId=${encodeURIComponent(projectId)}${opts.expand ? '&expand=1' : ''}`
  const res = await fetch(`/api/export?${qs}`)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    return { ok: false, error: err?.error ?? null }
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
