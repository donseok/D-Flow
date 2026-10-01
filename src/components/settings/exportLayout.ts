import type { DictKey } from '@/lib/i18n/dict'

/** 설정 화면 내보내기의 레이아웃 표기(SP4 D48) — 저장 양식이 없으면 표준 양식이 나간다는 것을 버튼 옆에 적는다(조용한 대체가 아니다) */
export type ExportLayout = { kind: 'standard' } | { kind: 'saved'; savedAt: string | null }

export function exportLayoutLabel(layout: ExportLayout, t: (key: DictKey) => string): string {
  if (layout.kind === 'standard') return t('settings.exportLayoutStandard')
  return t('settings.exportLayoutSaved').replace('{date}', layout.savedAt ?? t('settings.exportLayoutDateUnknown'))
}
