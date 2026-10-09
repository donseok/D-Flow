/**
 * 외부 업로드의 folder_path 자동 편철 여부 판독(minutes.auto_file_by_path — 정본 §3.3 · 계약 §4.8). 서버 전용.
 *
 * 우선순위(위가 이긴다):
 *   ① 배포 env `MINUTES_FOLDER_PATH_ENABLED=false`(명시) — 배포 전체에서 끈다. 운영자 차단 스위치로 한 단계만 남긴 호환 장치다
 *      (설정을 읽지도 않는다 — 파서가 키를 읽기 전에 버린다, externalApi.folderPathKillSwitch).
 *   ② 그 프로젝트의 설정 값(기본 true).
 *   ③ 프로젝트 없는 회의록(워크스페이스 트리)은 설정할 프로젝트가 없다 — 제품 기본값(true).
 * env 가 없거나 'true' 인 것은 "켬"이 아니라 "설정을 따른다"는 뜻이다(예전에는 env 가 'true' 일 때만 켜졌다).
 *
 * 판독 실패는 { ok: false } — 편철 여부를 추측해 쓰면 재전송이 사람이 정리한 폴더 위치를 덮을 수 있으므로 호출부가 중단한다(3원칙 ②).
 * 저장 값이 손상이면 편철하지 않는 쪽(false)으로 동작하고 로그를 남긴다 — 켜는 쪽이 기존 위치를 바꾸는 쪽이라 모를 때는 그대로 둔다.
 */
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { folderPathKillSwitch } from './externalApi'

export const AUTO_FILE_BY_PATH_DEFAULT = true

export async function loadAutoFileByPath(
  projectId: string | null, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; value: boolean } | { ok: false }> {
  if (folderPathKillSwitch()) return { ok: true, value: false }
  if (projectId === null) return { ok: true, value: AUTO_FILE_BY_PATH_DEFAULT }
  try {
    const cfg = await getProjectConfig(projectId, opts)
    // 다른 프로젝트의 문서·앞선 세대의 값으로 판정하지 않는다(첨부 정책 판독과 같은 규칙)
    if (cfg.schemaAhead || cfg.projectId !== projectId) {
      console.error('[minutes] 자동 편철 설정의 범위·세대를 확인하지 못했다 — 편철하지 않는다', { projectId })
      return { ok: false }
    }
    const state = cfg.keys['minutes.auto_file_by_path']
    if (state.status === 'set' || state.status === 'default') return { ok: true, value: state.value as boolean }
    console.error('[minutes] 자동 편철 설정 손상 — 편철하지 않는다(키 부재와 같게)', { projectId, status: state.status })
    return { ok: true, value: false }
  } catch (e) {
    console.error('[minutes] 프로젝트 설정 조회 실패 — 편철 여부를 추측하지 않는다', { projectId }, e)
    return { ok: false }
  }
}
