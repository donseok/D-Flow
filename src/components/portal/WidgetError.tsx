'use client'
import { useRouter } from 'next/navigation'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 위젯 하나의 실패(스펙 §6.1 ⑥) — 그 위젯 자리만. 재시도 = 서버 컴포넌트 다시 그리기(router.refresh) */
export function WidgetError({ title }: { title: string }) {
  const router = useRouter()
  const { t } = useLocale()
  return <StatusMessage kind="partial_error" compact title={title} action={{ label: t('common.retry'), onSelect: () => router.refresh() }} />
}
