'use client'
// 프로젝트의 단계 이름(SP5b W2 — 설정 workflow.wbs_stage_labels) 공급 — WBS 시트·에이전트 허브 루트가 서버에서 받은 값을 내려주고,
// 단계 칩·단계 패널·위임 표가 같은 이름으로 그린다. 설정이 없는 칸(또는 공급자 밖)은 각 자리의 기본 이름(사전·STAGE_LABEL_KO)이다.
import { createContext, useCallback, useContext, type ReactNode } from 'react'
import type { StageLabels, StageLabelSlot } from '@/lib/settings/defs/project'

const Ctx = createContext<StageLabels>({})

export function StageLabelsProvider({ labels, children }: { labels: StageLabels | null | undefined; children: ReactNode }) {
  return <Ctx.Provider value={labels ?? {}}>{children}</Ctx.Provider>
}

/** (단계, 기본 이름) → 프로젝트 이름 또는 기본 이름. 단계 null 은 'none' 칸 */
export function useStageLabel(): (stage: string | null, fallback: string) => string {
  const labels = useContext(Ctx)
  return useCallback((stage, fallback) => labels[(stage ?? 'none') as StageLabelSlot] ?? fallback, [labels])
}
