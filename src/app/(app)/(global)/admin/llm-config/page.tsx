import { redirect } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { getActorForView } from '@/lib/authz'
import { canManageLlmConfig } from '@/lib/authz/llmConfigAccess'
import { getLlmConfig } from '@/app/actions/llmConfig'
import { activeModelInfo } from '@/lib/ai/health'
import { PageHeader } from '@/components/app/PageHeader'
import { LlmConfigManager } from '@/components/admin/LlmConfigManager'
import { t } from '@/lib/i18n/dict'

export const dynamic = 'force-dynamic' // 설정·프로필은 항상 최신 DB 값을 읽는다

export default async function LlmConfigAdminPage() {
  // 슈퍼유저 전용 — 판정은 canManageLlmConfig 한 곳에서. 어포던스(헤더 메뉴)도 같은 판정을 쓴다.
  const actor = await getActorForView()
  if (!canManageLlmConfig(actor)) redirect('/')

  // 설정값(무엇을 저장했나)과 별개로 **지금 서버가 해석한 실제 모델**을 함께 읽는다.
  // 둘이 갈리는 경우가 있다(env 오버라이드·프로필이 임베딩을 안 덮음) — 그게 관리자가 알아야 할 것이다.
  const [res, active] = await Promise.all([getLlmConfig(), activeModelInfo()])

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.llm')} description={t('pages.llm.desc')} />
      {'error' in res ? (
        // 조회 실패를 빈 화면으로 삼키면 '선택 안함'으로 저장된 서버가 env 로 보이는 등
        // 관리자가 잘못된 상태를 사실로 착각한다 — 원인을 그대로 드러낸다.
        <div className="card flex items-start gap-3 p-5 sm:p-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-danger-weak text-danger">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{t('pages.llm.loadFailed')}</h2>
            <p role="alert" className="mt-1 break-words text-sm leading-6 text-fg-secondary">{res.error}</p>
            <p className="mt-1 text-xs text-fg-muted">{t('pages.llm.loadFailedHint')}</p>
          </div>
        </div>
      ) : (
        <LlmConfigManager initial={res} active={active} />
      )}
    </div>
  )
}
