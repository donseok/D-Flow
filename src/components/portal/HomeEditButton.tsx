'use client'
import { useSyncExternalStore } from 'react'
import { LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLocale } from '@/components/providers/LocaleProvider'

// 홈 머리(서버가 그리는 PageHeader)의 '홈 구성' 버튼과 홈 격자(HomeGrid)를 잇는 작은 저장소 — 둘은 트리에서 떨어져 있다.
// 격자가 여는 함수를 등록하고 편집 여부를 알린다. 화면에 홈 격자는 하나뿐이다.
let editing = false
let opener: (() => void) | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const isEditing = () => editing
const notEditing = () => false

export function setHomeEditing(next: boolean) {
  if (editing === next) return
  editing = next
  listeners.forEach((l) => l())
}
export function registerHomeOpener(fn: (() => void) | null) { opener = fn }

/**
 * 홈 구성 열기 — 페이지 머리의 동작 자리에 놓는다(요약과 위젯 사이에 혼자 뜬 줄을 없앤다). 편집 중에는 격자의 도구 모음이 대신하므로 그리지 않는다.
 * 개인 설정을 읽지 못했으면(canEdit=false) 열 수 없고 사유를 글로 보인다.
 */
export function HomeEditButton({ canEdit }: { canEdit: boolean }) {
  const { t } = useLocale()
  const hidden = useSyncExternalStore(subscribe, isEditing, notEditing)
  if (hidden) return null
  return (
    <Button data-fk="open" data-home-edit variant="secondary" icon={<LayoutGrid className="h-4 w-4" aria-hidden />} disabled={!canEdit}
      disabledReason={canEdit ? undefined : t('portalUi.edit.unavailable')} onClick={() => opener?.()}>{t('portalUi.edit.open')}</Button>
  )
}
