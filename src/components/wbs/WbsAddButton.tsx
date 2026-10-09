'use client'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLocale } from '@/components/providers/LocaleProvider'
export const WBS_ADD_PHASE_EVENT = 'wbs:add-phase'
export function WbsAddButton() {
  const { t } = useLocale()
  return <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => window.dispatchEvent(new CustomEvent(WBS_ADD_PHASE_EVENT))}>{t('wbs.emptyAddTask')}</Button>
}
