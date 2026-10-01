import type { DictKey } from '@/lib/i18n/dict'

/** 설정 화면 내보내기의 레이아웃 표기(SP4 D48) — 저장 양식이 없으면 표준 양식이 나간다는 것을 버튼 옆에 적는다(조용한 대체가 아니다) */
/** viaWizard — 그 키의 최신 이력이 가져오기 마법사의 저장 길(설정 내부 쓰기, source 'internal')인가. 복사·이행·알 수 없음은 거짓 — 출처를 적지 않는다 */
export type ExportLayout = { kind: 'standard' } | { kind: 'saved'; savedAt: string | null; viaWizard: boolean }

export function exportLayoutLabel(layout: ExportLayout, t: (key: DictKey) => string): string {
  if (layout.kind === 'standard') return t('settings.exportLayoutStandard')
  return t(layout.viaWizard ? 'settings.exportLayoutSaved' : 'settings.exportLayoutSavedPlain')
    .replace('{date}', layout.savedAt ?? t('settings.exportLayoutDateUnknown'))
}
