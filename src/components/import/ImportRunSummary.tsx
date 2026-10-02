// 가져오기 완료 카드의 실행 ID·영수증 링크·중복 안내(#23 — SP4 §5.2, 계획 P9). 실행 ID = 명령 id 앞 8자(전체는 title), 링크 = 같은 화면의 ?receipt=.
// 중복(같은 명령 id 재전송 — 서버가 처음 결과를 돌려줬다)은 conflict 상태로 앞에 알린다 — 그 응답에는 교체 전 백업이 없다(K9 — 실행 전에 받은 파일).
import Link from 'next/link'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { ExecuteResult } from '@/lib/domain/importWizard'
import type { DictKey } from '@/lib/i18n/dict'

export function ImportRunSummary({ projectId, result, t }: { projectId: string; result: Pick<ExecuteResult, 'kind' | 'commandId'>; t: (k: DictKey) => string }) {
  return (
    <div className="space-y-3" data-import-run>
      {result.kind === 'duplicate' && <StatusMessage kind="conflict" compact title={t('importWizard.duplicateTitle')} detail={t('importWizard.duplicateDesc')} />}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
        <span>{t('importWizard.runId')}</span>
        <code className="font-mono text-fg" title={result.commandId}>{result.commandId.slice(0, 8)}</code>
        <Link className="text-action underline-offset-2 hover:underline" href={`/p/${projectId}/import?receipt=${result.commandId}`}>{t('importWizard.receiptLink')}</Link>
      </p>
    </div>
  )
}
