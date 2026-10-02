'use client'
import { StatusMessage } from '@/components/ui/StatusMessage'

/**
 * 범위 레이아웃 안의 페이지 오류(D2) — 셸은 남고 main 자리에 뜬다. 표지 문구는 E2E PAGE_MARKERS 의 error-boundary('화면을 불러오지 못했습니다')와 같다.
 * 그 문구가 화면의 보이는 h1 이다(스펙 §9 ④ — 페이지가 그리던 h1 이 오류로 사라져도 화면마다 h1 하나). StatusMessage 의 title 은 필수라
 * 안내 문장을 거기 두고 같은 문구가 두 번 나오지 않게 한다.
 * 상태 종류는 막는 부분 실패(partial_error + blocking) — StatusKind 에 'error' 가 없다(W3).
 * 알림 영역(role="alert")은 하나다 — 실패 문구(h1)와 안내·다시 시도를 함께 감싸 스크린리더가 무엇이 실패했는지와 할 일을 한 번에 읽는다(BB4).
 * StatusMessage 는 자기 영역을 만들지 않는다(announce=false) — 두 영역이면 오류 순간에 연달아 두 번 낭독된다(U2b-5 리뷰 수정 CC6).
 */
export function ScopeError({ reset }: { reset: () => void }) {
  return (
    <div data-scope-error className="flex min-h-[420px] flex-col items-center justify-center">
      <div role="alert" className="flex flex-col items-center gap-3">
        <h1 className="text-title text-fg">화면을 불러오지 못했습니다</h1>
        <StatusMessage kind="partial_error" blocking announce={false} title="잠시 후 다시 시도해 주세요."
          detail="문제가 계속되면 관리자에게 문의하세요."
          action={{ label: '다시 시도', onSelect: reset }} />
      </div>
    </div>
  )
}
