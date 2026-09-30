import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isUuidLike } from '@/lib/domain/validate'
import { buildWbsTemplateWorkbook } from '@/lib/excel/template'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'

/** wbs.xlsx 양식 다운로드 — 안내문의 제품명은 프로젝트 워크스페이스 설정을 따른다. */
export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  const projectId = new URL(request.url).searchParams.get('projectId')
  let productName: string | undefined
  if (projectId && isUuidLike(projectId)) {
    try {
      const project = await getProjectConfig(projectId)
      productName = (await loadDisplayBranding(project.workspaceId)).productName
    } catch (error) { console.error('[import/template] 프로젝트 설정 조회 실패:', error) }
  }
  const buf = buildWbsTemplateWorkbook(productName)
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="wbs-template.xlsx"; filename*=UTF-8''${encodeURIComponent('wbs-양식.xlsx')}`,
      'Cache-Control': 'no-store',
    },
  })
}
