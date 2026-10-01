// 모달 성격 표면(모바일 드로어·레일 오버레이)의 Tab 가둠 — 마지막에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 끝으로(개정 §5.10.2)
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)] : []
}

/** keydown 처리기 — Tab 이 아니면 아무것도 하지 않는다 */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement | null): void {
  if (e.key !== 'Tab') return
  const f = focusablesIn(root)
  if (!f.length) return
  const i = f.indexOf(document.activeElement as HTMLElement)
  if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() }
  else if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() }
}
