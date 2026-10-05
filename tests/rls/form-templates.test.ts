import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { asService, asUser, F, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => {
  pool = openPool()
  await loadFixture(pool)

})

afterAll(async () => {
  await pool?.end()
})

const P = F.projects.a
const W = F.ws

const sampleScanReport = {
  version: 1,
  scannedAt: '2026-10-05T00:00:00Z',
  placeholders: [
    { token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [], location: { part: 'ppt/slides/slide1.xml' }, mergedRuns: false },
    { token: '{{.custom.priority_code}}', kind: 'value', path: '.custom.priority_code', scope: ['{{#rows .issues}}'], location: { part: 'ppt/slides/slide2.xml' }, mergedRuns: false },
  ],
  issues: [],
}

describe('form_templates 테이블 무결성 및 제약 (개정 §4.6.1)', () => {
  it('기본 삽입 및 유일 제약 (project_id, form_kind, version)', async () => {
    await asService(pool, async c => {
      const id1 = randomUUID()
      const path1 = `ws/${W}/p/${P}/weekly_report_pptx/v1.pptx`
      await c.query(`
        insert into public.form_templates (
          id, project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, $2, 'weekly_report_pptx', 'template.pptx', $3,
          1024, 1, $4::jsonb, false
        )
      `, [id1, P, path1, JSON.stringify(sampleScanReport)])

      // 같은 version 중복 삽입 시 23505 위반
      const path1Alt = `ws/${W}/p/${P}/weekly_report_pptx/v1_alt.pptx`
      const err = await pgError(c, `
        insert into public.form_templates (
          project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, 'weekly_report_pptx', 'template2.pptx', $2,
          2048, 1, $3::jsonb, false
        )
      `, [P, path1Alt, JSON.stringify(sampleScanReport)])
      expect(err).toMatchObject({ code: '23505' })

      // version 2는 삽입 가능
      const path2 = `ws/${W}/p/${P}/weekly_report_pptx/v2.pptx`
      await c.query(`
        insert into public.form_templates (
          project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, 'weekly_report_pptx', 'template2.pptx', $2,
          2048, 2, $3::jsonb, false
        )
      `, [P, path2, JSON.stringify(sampleScanReport)])

      // 정리
      await c.query('delete from public.form_templates where project_id = $1', [P])
    })
  })

  it('활성 유일 인덱스: (project_id, form_kind) 당 active = true는 최대 1건', async () => {
    await asService(pool, async c => {
      const t1Path = `ws/${W}/p/${P}/issue_analysis_pptx/v1.pptx`
      await c.query(`
        insert into public.form_templates (
          project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, 'issue_analysis_pptx', 't1.pptx', $2,
          1024, 1, $3::jsonb, true
        )
      `, [P, t1Path, JSON.stringify(sampleScanReport)])

      // 두 번째 active = true 시도 시 23505
      const t2Path = `ws/${W}/p/${P}/issue_analysis_pptx/v2.pptx`
      const err = await pgError(c, `
        insert into public.form_templates (
          project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, 'issue_analysis_pptx', 't2.pptx', $2,
          1024, 2, $3::jsonb, true
        )
      `, [P, t2Path, JSON.stringify(sampleScanReport)])
      expect(err).toMatchObject({ code: '23505' })

      await c.query('delete from public.form_templates where project_id = $1', [P])
    })
  })

  it('크기 및 양식 종류 제약', async () => {
    await asService(pool, async c => {
      // 0 바이트 거부
      expect(await pgError(c, `
        insert into public.form_templates (project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders)
        values ($1, 'weekly_report_pptx', 't.pptx', 'path1', 0, 1, '{}')
      `, [P])).toMatchObject({ code: '23514' })

      // 10MB 초과 거부 (10485761)
      expect(await pgError(c, `
        insert into public.form_templates (project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders)
        values ($1, 'weekly_report_pptx', 't.pptx', 'path2', 10485761, 1, '{}')
      `, [P])).toMatchObject({ code: '23514' })

      // 잘못된 form_kind 거부
      expect(await pgError(c, `
        insert into public.form_templates (project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders)
        values ($1, 'invalid_kind', 't.pptx', 'path3', 1024, 1, '{}')
      `, [P])).toMatchObject({ code: '23514' })
    })
  })
})

describe('form_templates RLS 정책', () => {
  it('프로젝트 멤버는 읽을 수 있고, 타 워크스페이스 사용자는 조회 불가', async () => {
    const tid = randomUUID()
    const wbsPath = `ws/${W}/p/${P}/wbs_export_xlsx/v1.xlsx`
    await asService(pool, async c => {
      await c.query(`insert into public.form_templates(id,project_id,form_kind,file_name,storage_path,size_bytes,version,placeholders,active)
        values($1,$2,'wbs_export_xlsx','wbs.xlsx',$3,1024,1,$4::jsonb,true)`,[tid,P,wbsPath,JSON.stringify(sampleScanReport)])
      const user=async(id:string)=>{
        await c.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:id,role:'authenticated'})])
        await c.query('set local role authenticated')
      }
      await user(F.users.member)
      expect((await c.query('select id from public.form_templates where id=$1',[tid])).rows).toHaveLength(1)
      await user(F.users.bMember)
      expect((await c.query('select id from public.form_templates where id=$1',[tid])).rows).toHaveLength(0)
      await user(F.users.member)
      expect(await pgError(c,`insert into public.form_templates(project_id,form_kind,file_name,storage_path,size_bytes,version,placeholders)
        values($1,'weekly_report_xlsx','w.xlsx','pathX',1024,1,'{}')`,[P])).toMatchObject({code:'42501'})
      expect(await pgError(c,'delete from public.form_templates where id=$1',[tid])).toMatchObject({code:'42501'})
    })
  })
})

describe('Storage form-templates 버킷 정책 (개정 §4.6.2)', () => {
  it('버킷 등록 확인', async () => {
    await asService(pool, async c => {
      const b = (await c.query("select id, public, file_size_limit from storage.buckets where id = 'form-templates'")).rows[0]
      expect(b).toBeDefined()
      expect(b.public).toBe(false)
      expect(Number(b.file_size_limit)).toBe(10485760)
    })
  })

  it('업로드는 incoming 경로에 한해 프로젝트 관리자만 허용', async () => {
    const incomingPath = `ws/${W}/p/${P}/weekly_report_pptx/incoming/${randomUUID()}.pptx`
    const versionPath = `ws/${W}/p/${P}/weekly_report_pptx/v1.pptx`
    const crossWsPath = `ws/${randomUUID()}/p/${P}/weekly_report_pptx/incoming/${randomUUID()}.pptx`

    // 프로젝트 관리자(F.users.member = alice, admin of P)는 incoming 경로 업로드 가능
    await asUser(pool, F.users.member, async c => {
      const res = await c.query(`
        insert into storage.objects (bucket_id, name, owner)
        values ('form-templates', $1, $2)
        returning name
      `, [incomingPath, F.users.member])
      expect(res.rows[0].name).toBe(incomingPath)

      // v1 (비 incoming) 경로는 RLS 거부
      expect(await pgError(c, `
        insert into storage.objects (bucket_id, name, owner)
        values ('form-templates', $1, $2)
      `, [versionPath, F.users.member])).toMatchObject({ code: '42501' })

      // 교차 워크스페이스 경로는 RLS 거부
      expect(await pgError(c, `
        insert into storage.objects (bucket_id, name, owner)
        values ('form-templates', $1, $2)
      `, [crossWsPath, F.users.member])).toMatchObject({ code: '42501' })
    })

    // 비관리자(F.users.aLoose)는 incoming 업로드도 거부
    await asUser(pool, F.users.aLoose, async c => {
      expect(await pgError(c, `
        insert into storage.objects (bucket_id, name, owner)
        values ('form-templates', $1, $2)
      `, [`ws/${W}/p/${P}/weekly_report_pptx/incoming/${randomUUID()}.pptx`, F.users.aLoose])).toMatchObject({ code: '42501' })
    })

  })
})

describe('FORM_MAPPING_IN_USE 가드 (개정 §3.6.5)', () => {
  const customField = {
    key: 'cost_center',
    type: 'text',
    label: '비용센터',
    required: false,
    active: true,
    description: '', editable_by: 'member', show_in_list: false, searchable: false, sort: 0,
  }

  it('활성 양식 매핑이 가리키는 필드의 정의 삭제 및 purge 차단', async () => {
    const tid = randomUUID()
    await asService(pool, async c => {
      // 1. 커스텀 필드 cost_center 정의
      await c.query(`
        update public.project_settings
           set "values" = "values" || jsonb_build_object('fields.issue', $2::jsonb)
         where project_id = $1
      `, [P, JSON.stringify([customField])])

      // 2. 활성 양식 및 매핑 등록
      const issuePath = `ws/${W}/p/${P}/issue_analysis_pptx/v1.pptx`
      await c.query(`
        insert into public.form_templates (
          id, project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, $2, 'issue_analysis_pptx', 'issues.pptx', $3,
          1024, 1, '{}'::jsonb, true
        )
      `, [tid, P, issuePath])

      // 매핑에 cost_center 등록
      await c.query(`
        update public.project_settings
           set "values" = "values" || jsonb_build_object(
             'forms.issue_analysis_pptx',
             jsonb_build_object(
               'template_id', $2::text,
               'mapping', jsonb_build_object('{{#rows}}/{{.cc}}', '.custom.cost_center')
             )
           )
         where project_id = $1
      `, [P, tid])

      // 3. 정의 삭제 시도 (apply_project_settings로 fields.issue를 []로 변경) -> FORM_MAPPING_IN_USE (23514)
      const rev = Number((await c.query('select revision from public.project_settings where project_id = $1', [P])).rows[0].revision)
      const delErr = await pgError(c, `
        select public.apply_project_settings($1, $2, gen_random_uuid(), '{"fields.issue": []}'::jsonb, '{}'::text[], $3, 1, 'edit')
      `, [P, rev, F.users.member])
      expect(delErr).toMatchObject({ code: '23514', message: 'FORM_MAPPING_IN_USE' })

      // 4. purge_custom_field 호출 시도 -> FORM_MAPPING_IN_USE (23514)
      const purgeErr = await pgError(c, `
        select public.purge_custom_field($1, $2, gen_random_uuid(), 'issue', 'cost_center', 0, $3)
      `, [P, rev, F.users.member])
      expect(purgeErr).toMatchObject({ code: '23514', message: 'FORM_MAPPING_IN_USE' })

      // 5. 양식 비활성화 (active = false 및 template_id null) 후에는 정의 삭제 가능
      await c.query('update public.form_templates set active = false where id = $1', [tid])
      await c.query(`
        update public.project_settings
           set "values" = "values" || '{"forms.issue_analysis_pptx": {"template_id": null, "mapping": {}}}'::jsonb
         where project_id = $1
      `, [P])

      const rev2 = Number((await c.query('select revision from public.project_settings where project_id = $1', [P])).rows[0].revision)
      await c.query(`
        select public.apply_project_settings($1, $2, gen_random_uuid(), '{"fields.issue": []}'::jsonb, '{}'::text[], $3, 1, 'edit')
      `, [P, rev2, F.users.member])

      // 정리
      await c.query('delete from public.form_templates where id = $1', [tid])
    })
  })
})

describe('copy_project_config 연동 (개정 §4.6.3)', () => {
  it('프로젝트 복사 시 활성 양식 템플릿 메타가 v1로 복사되고 template_id가 연결된다', async () => {
    const srcId = randomUUID()
    const dstId = randomUUID()
    const srcTid = randomUUID()

    await asService(pool, async c => {
      // 소스 프로젝트 생성 (projects insert 시 project_settings는 트리거가 자동 생성)
      await c.query("insert into public.projects (id, name, workspace_id) values ($1, 'Source Proj', $2)", [srcId, W])

      // 소스에 활성 양식 등록
      const srcPath = `ws/${W}/p/${srcId}/weekly_report_pptx/v2.pptx`
      await c.query(`
        insert into public.form_templates (
          id, project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active
        ) values (
          $1, $2, 'weekly_report_pptx', 'source.pptx', $3,
          2048, 2, $4::jsonb, true
        )
      `, [srcTid, srcId, srcPath, JSON.stringify(sampleScanReport)])


      // 대상 프로젝트 생성
      await c.query("insert into public.projects (id, name, workspace_id) values ($1, 'Dest Proj', $2)", [dstId, W])
      await c.query(`
        insert into public.project_settings_history (
          project_id, revision, key, old_value, new_value, source, copied_from, command_id, command_digest, changed_by
        ) values (
          $1, 1, 'dummy', null, '{}'::jsonb, 'copy', $2, gen_random_uuid(), 'digest', $3
        )
      `, [dstId, srcId, F.users.member])

      // copy_project_config 실행
      await c.query('select public.copy_project_config($1, $2)', [srcId, dstId])

      // 대상 프로젝트의 form_templates 검증
      const dstTemplates = (await c.query(`
        select * from public.form_templates where project_id = $1
      `, [dstId])).rows
      expect(dstTemplates).toHaveLength(1)
      const dstFt = dstTemplates[0]
      expect(dstFt.id).not.toBe(srcTid)
      expect(dstFt.version).toBe(1)
      expect(dstFt.active).toBe(true)
      expect(dstFt.storage_path).toBe(`ws/${W}/p/${dstId}/weekly_report_pptx/v1.pptx`)
      expect(dstFt.uploaded_by).toBe(F.users.member)

      // 대상 프로젝트의 project_settings forms.weekly_report_pptx.template_id 갱신 검증
      const dstSettings = (await c.query(`
        select "values" from public.project_settings where project_id = $1
      `, [dstId])).rows[0].values
      expect(dstSettings['forms.weekly_report_pptx']?.template_id).toBe(dstFt.id)

      // 정리
      await c.query('delete from public.projects where id in ($1, $2)', [srcId, dstId])
    })
  })
})

describe('롤백 및 재적용 정합성', () => {
  it('0031 롤백 스크립트 실행 후 테이블·버킷 정리 및 재적용 성공', async () => {
    await asService(pool, async c => {
      const sql=(dir:string,suffix:string)=>readFileSync(join(process.cwd(),dir,readdirSync(join(process.cwd(),dir)).find(f=>f.endsWith(suffix))!),'utf8')
      const rollbackSql = sql('supabase/rollbacks','_form_templates_rollback.sql')
      const migrateSql = sql('supabase/migrations','_form_templates.sql')

      // Roll newer dependent migrations back at the historical schema boundary.
      await c.query(sql('supabase/rollbacks','_form_template_guards_rollback.sql'))
      await c.query(sql('supabase/rollbacks','_form_template_activation_rollback.sql'))
      await c.query(rollbackSql)

      // 테이블 및 버킷 부재 단언
      expect((await c.query("select 1 from information_schema.tables where table_schema='public' and table_name='form_templates'")).rows).toHaveLength(0)
      expect((await c.query("select 1 from storage.buckets where id='form-templates'")).rows).toHaveLength(0)

      // 재적용 실행
      await c.query(migrateSql)
      await c.query(sql('supabase/migrations','_form_template_activation.sql'))
      await c.query(sql('supabase/migrations','_form_template_guards.sql'))

      // 재적용 후 정상 존재 단언
      expect((await c.query("select 1 from information_schema.tables where table_schema='public' and table_name='form_templates'")).rows).toHaveLength(1)
      expect((await c.query("select 1 from storage.buckets where id='form-templates'")).rows).toHaveLength(1)
    })
  })
})
