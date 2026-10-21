-- 0061_minute_wbs_links.sql
-- 회의록 → WBS 등록 — 회의록 문단을 WBS 작업으로 등록하고 작업과 원문이 서로를 가리키게 한다(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §5·§6).
-- 왜:
--   · 이미 있는 회의록 → 이슈 흐름(issue_links + create_issue_from_minute_block)의 쌍둥이다. issue_links 는 issue_id NOT NULL 이라 작업에 쓸 수 없어
--     같은 꼴의 표를 둔다.
--   · 등록 1회(1건이든 N건이든) = RPC 1회 = 트랜잭션 1개 — 작업 행·원문 연결·변경 이력('created')이 함께 들어가거나 함께 안 들어간다.
--   · DEFINER RPC 라 RLS 가 빠진 자리다 — 액션 가드(requireProjectAdmin)와 두 관문으로 행위자 등급(actor_is_project_admin)을 함수 안에서 다시 본다.
--     준비와 등록 사이에 트리가 바뀌었을 수 있어 부모 규칙(SUB-ACT·업무 흐름·깊이 상한·말단 확인)도 다시 본다 — 추측으로 다른 곳에 넣지 않는다.
--   · "등록됨" 판정은 버전이 아니라 문단 내용(block_hash)이다 — 오타만 고친 새 버전에서 같은 문단을 다시 보내도 action 줄은 거부한다(두 번 누름·
--     재전송). 표에 그 조건의 부분 유일 인덱스를 둔다. manual(문단·선택 등록)은 「하나 더 등록」을 허용하므로 유일 조건이 없다.
-- 무엇:
--   ① 표 wbs_item_links — issue_links 와 같은 원문 열 + wbs_item_id·project_id. 참조는 둘뿐: 작업(CASCADE — 작업을 지우면, WBS 바꿔치기 가져오기를
--      포함해, 연결도 사라진다)·회의록 버전(RESTRICT — 이슈 연결과 같다). source_project_id 는 FK 가 없다(등록 당시 버전의 프로젝트 사본).
--   ② 권한 — RLS 켬, 읽기 정책 wbs_item_links_ws_read 하나(0006 뒤 범위 읽기의 이름·식 — 쌍둥이 issue_links_ws_read). authenticated 는 SELECT 만,
--      쓰기는 service_role 만(쓰기 정책 없음).
--   ③ 트리거 wbs_item_links_minute_scope — 회의록 워크스페이스 = 작업 프로젝트의 워크스페이스(0009 issue_links_minute_scope 와 같은 판정).
--      RPC 는 그 전에 거부하므로 RPC 밖의 쓰기 경로를 막는 마지막 그물이다. 삭제 트리거는 두지 않는다.
--   ④ RPC create_wbs_items_from_minute — DEFINER·service_role 전용. 순서: 줄 모양 → 등급(프로젝트 존재 포함) → 프로젝트 잠금 → 격리 수준 →
--      회의록(이 프로젝트의 워크스페이스 것만)·버전 → 부모 잠금(id 순서) → 줄 검사(쓰기 없음) → 쓰기.
--   ⑤ 사후검사 MINUTE_WBS_POSTCHECK.
-- 사유 코드(앱이 문구로 바꾼다 — detail 은 줄 번호(0부터)의 문자열이고, 줄과 무관한 거부에는 없다):
--   MINUTE_WBS_ROWS_INVALID(22023 — 배열 아님·0줄·30줄 초과는 줄 번호 없음, 원소 모양은 그 줄) · WBS_ACTOR_FORBIDDEN(42501 — 없는 프로젝트 포함) ·
--   MINUTE_WBS_ISOLATION(25001) · MINUTE_NOT_FOUND(P0002 — 다른 워크스페이스의 회의록 포함) · MINUTE_ARCHIVED(55000) · MINUTE_PROJECT_MISMATCH(23514) ·
--   MINUTE_VERSION_NOT_FOUND(P0002) · MINUTE_BODY_STALE(22023) ·
--   줄: WBS_NAME_REQUIRED·WBS_NAME_TOO_LONG(22023) · WBS_PARENT_NOT_FOUND(P0002) · WBS_PARENT_SUB_ACT·WBS_PARENT_WORKFLOW·WBS_PARENT_DEPTH·
--   WBS_PARENT_LEAF_UNCONFIRMED(23514) · WBS_DATE_RANGE_INVALID·WBS_ASSIGNEE_INVALID(22023) · MINUTE_BLOCK_ALREADY_LINKED(23505) ·
--   표 트리거: MINUTE_WORKSPACE_MISMATCH(23514).
-- 프로젝트 삭제(0058): 이 표는 wbs_items 를 CASCADE 로 따라가고, 이 표를 가리키는 참조·이 표의 삭제 트리거가 없다 — project_delete_unknown_references()
--   는 그대로 null 이다(사후검사가 확인한다). 회의록 버전 쪽 RESTRICT 는 projects 를 따라가는 표를 가리키지 않아 그 목록에 들지 않는다.
-- 데이터: 적용만으로 바뀌는 행은 없다(새 표는 비어 있다).
-- 롤백: supabase/rollbacks/*_minute_wbs_links_rollback.sql(연결이 한 행이라도 있으면 멈춘다).

begin;

-- ① 표 ----------------------------------------------------------------------------------------------------------------
create table public.wbs_item_links (
  id uuid primary key default gen_random_uuid(),
  wbs_item_id uuid not null,
  project_id uuid not null,
  link_type text not null default 'minute_block' constraint wbs_item_links_link_type_check check (link_type = 'minute_block'),
  minute_id uuid not null,
  minute_version_id uuid not null,
  minute_version_no integer not null constraint wbs_item_links_version_no_check check (minute_version_no > 0),
  source_project_id uuid,
  minute_title_snapshot text not null,
  minute_date_snapshot date not null,
  body_hash text not null constraint wbs_item_links_body_hash_check check (btrim(body_hash) <> ''),
  block_index integer not null constraint wbs_item_links_block_index_check check (block_index >= 0),
  block_hash text not null constraint wbs_item_links_block_hash_check check (btrim(block_hash) <> ''),
  excerpt_snapshot text not null constraint wbs_item_links_excerpt_check check (btrim(excerpt_snapshot) <> ''),
  source_kind text not null default 'manual' constraint wbs_item_links_source_kind_check check (source_kind in ('manual', 'action')),
  source_key text constraint wbs_item_links_source_key_check check (source_key is null or btrim(source_key) <> ''),
  created_at timestamptz not null default now(),
  constraint wbs_item_links_item_project_fk foreign key (wbs_item_id, project_id)
    references public.wbs_items(id, project_id) on delete cascade,
  constraint wbs_item_links_version_minute_fk foreign key (minute_version_id, minute_id)
    references public.minute_versions(id, minute_id) on delete restrict
);
create index wbs_item_links_item_created_idx on public.wbs_item_links (wbs_item_id, created_at);
create index wbs_item_links_minute_block_idx on public.wbs_item_links (minute_id, minute_version_id, block_index, block_hash, created_at);
create index wbs_item_links_project_created_idx on public.wbs_item_links (project_id, created_at desc);
create index wbs_item_links_source_key_idx on public.wbs_item_links (source_key) where source_key is not null;
-- action 줄의 중복 막기(§5.6) — 같은 프로젝트·회의록의 같은 문단 내용은 버전이 달라도 한 번만. RPC 의 사전 검사가 줄 번호와 함께 먼저 거부하고
-- 이 인덱스가 마지막 그물이다
create unique index wbs_item_links_action_block_uidx on public.wbs_item_links (project_id, minute_id, block_hash) where source_kind = 'action';

-- ② 권한·정책 — 기본 권한이 새 표에 준 세션 권한을 걷고 authenticated 에 SELECT 만 다시 준다 ------------------------------------
revoke all on public.wbs_item_links from public, anon, authenticated;
grant all on public.wbs_item_links to service_role;
grant select on public.wbs_item_links to authenticated;
alter table public.wbs_item_links enable row level security;
create policy wbs_item_links_ws_read on public.wbs_item_links for select to authenticated
  using (project_id in (select public.accessible_project_ids()));

-- ③ 회의록 워크스페이스 — 프로젝트 없는 회의록은 워크스페이스로만 스코프된다. 그 발췌를 다른 워크스페이스의 작업에 잇지 못하게 모든 쓰기 경로를
--    표에서 막는다(0009 ⑤ issue_links_minute_scope 와 같은 판정) -----------------------------------------------------------------
create function public.wbs_item_links_minute_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.minutes m join public.projects p on p.id = new.project_id
              where m.id = new.minute_id and m.workspace_id <> p.workspace_id) then
    raise exception using errcode = '23514', message = 'MINUTE_WORKSPACE_MISMATCH';
  end if;
  return new;
end
$$;
revoke all on function public.wbs_item_links_minute_scope() from public, anon, authenticated;
create trigger wbs_item_links_minute_scope before insert or update of minute_id, project_id on public.wbs_item_links
  for each row execute function public.wbs_item_links_minute_scope();

-- ④ 등록 RPC — p_rows 원소: { name, parent_id(uuid|null), planned_start·planned_end(YYYY-MM-DD|null), assignee_member_id(uuid|null),
--    block_index, block_hash, excerpt, source_kind('manual'|'action'), source_key(text|null), confirm_parent_leaf(bool) }.
--    반환 [{ row, item_id, code }, …](줄 순서). p_max_depth 는 단계 수 상한(null = 없음) — 새 작업의 깊이(0부터)가 상한보다 작아야 한다 ---------
create function public.create_wbs_items_from_minute(
  p_project_id uuid, p_actor uuid, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_max_depth integer, p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  -- JS String.prototype.trim() 의 공백 집합(0013·0060 과 같다) — 작업명은 수동 추가(addWbsItem 의 name.trim())와 같은 값으로 저장한다
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_iso_date constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  v_count integer;
  v_i integer;
  v_row jsonb;
  v_name text;
  v_parent uuid;
  v_parent_ids uuid[];
  v_parent_split boolean;
  v_parent_flow boolean;
  v_parent_actual numeric;
  v_depth integer;
  v_start date;
  v_end date;
  v_assignee uuid;
  v_action_hashes text[] := '{}';
  v_minute_project_id uuid;
  v_minute_archived_at timestamptz;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_title text;
  v_date date;
  v_version_no integer;
  v_sort integer;
  v_code text;
  v_item uuid;
  v_result jsonb := '[]'::jsonb;
begin
  -- 1. 줄 모양(잠금·조회보다 먼저) — 배열, 1~30줄, 원소는 객체. 필수 키: name(문자열)·block_index(0 이상 정수)·block_hash·excerpt(빈칸 아닌
  --    문자열 — 표 검사 제약과 같은 btrim)·source_kind('manual'|'action')·confirm_parent_leaf(참거짓). 선택 키(없거나 null): parent_id·
  --    assignee_member_id(uuid 꼴)·planned_start·planned_end(YYYY-MM-DD 의 실제 날짜)·source_key(빈칸 아닌 문자열).
  --    아래 형 변환(::uuid·::date·::integer·::boolean)은 이 검사를 통과한 값에만 한다. 각 항은 null 이 되지 않게 적었다
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'MINUTE_WBS_ROWS_INVALID';
  end if;
  v_count := pg_catalog.jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 30 then
    raise exception using errcode = '22023', message = 'MINUTE_WBS_ROWS_INVALID';
  end if;
  for v_i in 0 .. v_count - 1 loop
    v_row := p_rows -> v_i;
    if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_row -> 'name') is distinct from 'string'
       or pg_catalog.jsonb_typeof(v_row -> 'block_index') is distinct from 'number'
       or coalesce((v_row ->> 'block_index') !~ '^[0-9]{1,9}$', true)
       or pg_catalog.jsonb_typeof(v_row -> 'block_hash') is distinct from 'string'
       or coalesce(pg_catalog.btrim(v_row ->> 'block_hash') = '', true)
       or pg_catalog.jsonb_typeof(v_row -> 'excerpt') is distinct from 'string'
       or coalesce(pg_catalog.btrim(v_row ->> 'excerpt') = '', true)
       or coalesce((v_row ->> 'source_kind') not in ('manual', 'action'), true)
       or pg_catalog.jsonb_typeof(v_row -> 'confirm_parent_leaf') is distinct from 'boolean'
       or coalesce(pg_catalog.jsonb_typeof(v_row -> 'parent_id'), 'null') not in ('null', 'string')
       or coalesce((v_row ->> 'parent_id') !~ v_uuid, false)
       or coalesce(pg_catalog.jsonb_typeof(v_row -> 'assignee_member_id'), 'null') not in ('null', 'string')
       or coalesce((v_row ->> 'assignee_member_id') !~ v_uuid, false)
       or coalesce(pg_catalog.jsonb_typeof(v_row -> 'planned_start'), 'null') not in ('null', 'string')
       or coalesce((v_row ->> 'planned_start') !~ v_iso_date or not pg_catalog.pg_input_is_valid(v_row ->> 'planned_start', 'date'), false)
       or coalesce(pg_catalog.jsonb_typeof(v_row -> 'planned_end'), 'null') not in ('null', 'string')
       or coalesce((v_row ->> 'planned_end') !~ v_iso_date or not pg_catalog.pg_input_is_valid(v_row ->> 'planned_end', 'date'), false)
       or coalesce(pg_catalog.jsonb_typeof(v_row -> 'source_key'), 'null') not in ('null', 'string')
       or coalesce(pg_catalog.btrim(v_row ->> 'source_key') = '', false) then
      raise exception using errcode = '22023', message = 'MINUTE_WBS_ROWS_INVALID', detail = v_i::text;
    end if;
  end loop;
  -- 등급(DEFINER 라 RLS 가 빠진 자리 — 액션 가드 requireProjectAdmin 과 두 관문). 보관된 워크스페이스는 등급 판정이 거부한다(0056).
  -- 없는 프로젝트도 같은 거부다(존재를 알려 주지 않는다) — actor_is_project_admin 은 플랫폼 관리자면 프로젝트가 있는지 보지 않아 따로 본다
  if not exists (select 1 from public.projects p where p.id = p_project_id)
     or not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'WBS_ACTOR_FORBIDDEN';
  end if;

  -- 2. 같은 프로젝트의 등록을 한 줄로 세운다 — 아래 sort_order 채번과 action 중복 판정이 이 잠금 아래에서 일어난다 → 격리 가드
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('create_wbs_items_from_minute:' || p_project_id::text));
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 기존 연결·형제·부모의 하위를 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 프로젝트의 앞 등록 — 스냅샷이 고정된 수준에서는 보지 못해 아래 4 의 중복 판정을 지나 부분 유일 인덱스의 23505 가 나거나 sort_order 가 겹친다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'MINUTE_WBS_ISOLATION';
  end if;

  -- 3. 회의록·버전 — create_issue_from_minute_block(0030)과 같은 판정. 회의록은 이 프로젝트의 워크스페이스 것만 본다 — 다른 워크스페이스의 회의록은
  --    잠그지도, 상태(보관·버전·본문)를 드러내지도 않고 MINUTE_NOT_FOUND 다(표 트리거는 RPC 밖의 쓰기를 막는 마지막 그물로 남는다).
  --    회의록 행만 FOR SHARE 로 잡아 등록이 끝날 때까지 보관·이동을 막는다
  select m.project_id, m.archived_at
    into v_minute_project_id, v_minute_archived_at
    from public.minutes m
    join public.projects p on p.id = p_project_id
   where m.id = p_minute_id
     and m.workspace_id = p.workspace_id
     for share of m;
  if not found then
    raise exception using errcode = 'P0002', message = 'MINUTE_NOT_FOUND';
  end if;
  if v_minute_archived_at is not null then
    raise exception using errcode = '55000', message = 'MINUTE_ARCHIVED';
  end if;
  if v_minute_project_id is not null and v_minute_project_id <> p_project_id then
    raise exception using errcode = '23514', message = 'MINUTE_PROJECT_MISMATCH';
  end if;
  select mv.body_hash, mv.project_id, mv.title, mv.minute_date, mv.version_no
    into v_version_body_hash, v_version_project_id, v_title, v_date, v_version_no
    from public.minute_versions mv
   where mv.id = p_minute_version_id
     and mv.minute_id = p_minute_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MINUTE_VERSION_NOT_FOUND';
  end if;
  -- 낡은 화면 — 빈 값(null)도 다른 값으로 본다
  if p_body_hash is distinct from v_version_body_hash then
    raise exception using errcode = '22023', message = 'MINUTE_BODY_STALE';
  end if;

  -- 4. 줄 검사(쓰지 않는다 — 한 줄이라도 거부되면 아무것도 남지 않는다). 부모는 먼저 한 문장에서 id 순서로 FOR UPDATE 로 잡는다 — 작업 행을
  --    여럿 잠그는 다른 쓰기(custom_field_command 등)와 같은 순서라 줄 순서가 거꾸로여도 교착하지 않는다. 잡은 부모는 그 밑에 자식을 넣는 다른
  --    쓰기(FK 의 FOR KEY SHARE)와 부모의 흐름·실적 변경을 이 등록이 끝날 때까지 기다리게 한다. 이 프로젝트에 없는 부모는 잡히지 않고 아래에서
  --    그 줄의 WBS_PARENT_NOT_FOUND 가 된다
  select coalesce(pg_catalog.array_agg(distinct (e.value ->> 'parent_id')::uuid), '{}')
    into v_parent_ids
    from pg_catalog.jsonb_array_elements(p_rows) as e(value)
   where (e.value ->> 'parent_id') is not null;
  perform 1 from public.wbs_items w where w.project_id = p_project_id and w.id = any (v_parent_ids) order by w.id for update;
  for v_i in 0 .. v_count - 1 loop
    v_row := p_rows -> v_i;
    v_name := pg_catalog.btrim(v_row ->> 'name', v_space);
    if v_name = '' then
      raise exception using errcode = '22023', message = 'WBS_NAME_REQUIRED', detail = v_i::text;
    end if;
    if pg_catalog.char_length(v_name) > 200 then
      raise exception using errcode = '22023', message = 'WBS_NAME_TOO_LONG', detail = v_i::text;
    end if;
    v_parent := (v_row ->> 'parent_id')::uuid;
    if v_parent is not null then
      select w.is_owner_split, w.dev_workflow
        into v_parent_split, v_parent_flow
        from public.wbs_items w
       where w.id = v_parent
         and w.project_id = p_project_id;
      if not found then
        raise exception using errcode = 'P0002', message = 'WBS_PARENT_NOT_FOUND', detail = v_i::text;
      end if;
      -- 부모가 SUB-ACT 이거나 부모의 하위에 SUB-ACT 가 섞여 있으면(addWbsItem 의 SUB-ACT 형제 가드와 같은 결과)
      if v_parent_split or exists (select 1 from public.wbs_items c where c.parent_id = v_parent and c.is_owner_split) then
        raise exception using errcode = '23514', message = 'WBS_PARENT_SUB_ACT', detail = v_i::text;
      end if;
      -- 업무 흐름이 켜진 작업이거나 진행 중인 에이전트 주문(활성 유일 인덱스와 같은 집합)이 있는 작업
      if v_parent_flow or exists (select 1 from public.agent_work_orders o
                                   where o.wbs_item_id = v_parent and o.status in ('ready', 'claimed', 'reported')) then
        raise exception using errcode = '23514', message = 'WBS_PARENT_WORKFLOW', detail = v_i::text;
      end if;
      -- 깊이 상한 — 부모의 깊이(0부터 — 맨 위가 0) + 1 이 새 작업의 깊이다. 순환(있어서는 안 된다)이 있어도 걸음 상한에서 끝난다
      if p_max_depth is not null then
        with recursive up(id, parent_id, depth) as (
          select w.id, w.parent_id, 0 from public.wbs_items w where w.id = v_parent
          union all
          select w.id, w.parent_id, up.depth + 1 from public.wbs_items w join up on w.id = up.parent_id
           where up.depth < 1000
        )
        select pg_catalog.max(up.depth) into v_depth from up;
        if v_depth + 1 >= p_max_depth then
          raise exception using errcode = '23514', message = 'WBS_PARENT_DEPTH', detail = v_i::text;
        end if;
      end if;
      -- 하위가 없는 부모 — 첫 자식이 들어가면 부모의 직접 실적%가 지워진다. 사람이 그 영향을 확인한 줄만 넣는다(준비 뒤 하위를 잃은 부모를 막는다)
      if not (v_row ->> 'confirm_parent_leaf')::boolean
         and not exists (select 1 from public.wbs_items c where c.parent_id = v_parent) then
        raise exception using errcode = '23514', message = 'WBS_PARENT_LEAF_UNCONFIRMED', detail = v_i::text;
      end if;
    end if;
    v_start := (v_row ->> 'planned_start')::date;
    v_end := (v_row ->> 'planned_end')::date;
    if v_start is not null and v_end is not null and v_start > v_end then
      raise exception using errcode = '22023', message = 'WBS_DATE_RANGE_INVALID', detail = v_i::text;
    end if;
    -- 담당자 — 이 프로젝트의 활성 명단 행·활성 인물(setWbsAssignee 의 선행 조회와 같은 조건)
    v_assignee := (v_row ->> 'assignee_member_id')::uuid;
    if v_assignee is not null and not exists (
      select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
       where pm.id = v_assignee and pm.project_id = p_project_id and pm.active and pe.active) then
      raise exception using errcode = '22023', message = 'WBS_ASSIGNEE_INVALID', detail = v_i::text;
    end if;
    -- action 줄의 중복 — 같은 (프로젝트, 회의록, 문단 내용)의 action 연결이 이미 있거나 이 호출의 앞 줄에 있으면(부분 유일 인덱스와 같은 조건)
    if (v_row ->> 'source_kind') = 'action' then
      if (v_row ->> 'block_hash') = any (v_action_hashes)
         or exists (select 1 from public.wbs_item_links l
                     where l.project_id = p_project_id and l.minute_id = p_minute_id
                       and l.block_hash = (v_row ->> 'block_hash') and l.source_kind = 'action') then
        raise exception using errcode = '23505', message = 'MINUTE_BLOCK_ALREADY_LINKED', detail = v_i::text;
      end if;
      v_action_hashes := v_action_hashes || (v_row ->> 'block_hash');
    end if;
  end loop;

  -- 5. 쓰기 — 줄 순서대로 작업 → 원문 연결 → 변경 이력
  for v_i in 0 .. v_count - 1 loop
    v_row := p_rows -> v_i;
    v_name := pg_catalog.btrim(v_row ->> 'name', v_space);
    v_parent := (v_row ->> 'parent_id')::uuid;
    -- 말단이던 부모가 첫 자식을 얻는다 — 직접 입력 실적%를 지우고 이력에 남긴다(addWbsItem 의 discardRolledUpActual 과 같은 결과).
    -- 같은 부모로 가는 둘째 줄부터는 앞 줄의 자식이 보여 건너뛴다
    if v_parent is not null and not exists (select 1 from public.wbs_items c where c.parent_id = v_parent) then
      select w.actual_pct into v_parent_actual from public.wbs_items w where w.id = v_parent;
      if v_parent_actual is not null then
        update public.wbs_items w set actual_pct = null, updated_at = pg_catalog.now() where w.id = v_parent;
        insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
        values (p_actor, v_parent, 'actual_pct', v_parent_actual::text, null);
      end if;
    end if;
    -- 자리 — 그 부모 아래 맨 뒤(앞 줄이 넣은 형제가 보여 매번 다시 센다). 코드 — 수동 추가와 같은 규칙(이름의 첫 토큰, 없으면 이름 전체)
    select coalesce(pg_catalog.max(w.sort_order), 0) + 1 into v_sort
      from public.wbs_items w
     where w.project_id = p_project_id and w.parent_id is not distinct from v_parent;
    v_code := coalesce(nullif((pg_catalog.regexp_split_to_array(v_name, '[.\s]'))[1], ''), v_name);
    -- 흐름 다섯 열(stage·review_round·review_steps·dev_workflow·tags)은 쓰지 않는다 — 꺼진 채 생긴다(guard_workflow_columns)
    insert into public.wbs_items (project_id, parent_id, code, sort_order, name, planned_start, planned_end, assignee_member_id)
    values (p_project_id, v_parent, v_code, v_sort, v_name, (v_row ->> 'planned_start')::date, (v_row ->> 'planned_end')::date,
            (v_row ->> 'assignee_member_id')::uuid)
    returning id into v_item;
    insert into public.wbs_item_links (
      wbs_item_id, project_id, link_type, minute_id, minute_version_id, minute_version_no, source_project_id,
      minute_title_snapshot, minute_date_snapshot, body_hash, block_index, block_hash, excerpt_snapshot, source_kind, source_key
    ) values (
      v_item, p_project_id, 'minute_block', p_minute_id, p_minute_version_id, v_version_no, v_version_project_id,
      v_title, v_date, v_version_body_hash, (v_row ->> 'block_index')::integer, v_row ->> 'block_hash', v_row ->> 'excerpt',
      v_row ->> 'source_kind', v_row ->> 'source_key'
    );
    insert into public.change_logs (user_id, wbs_item_id, field, old_value, new_value)
    values (p_actor, v_item, 'created', null, v_name);
    v_result := v_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('row', v_i, 'item_id', v_item, 'code', v_code));
  end loop;

  -- 6. 결과 — 줄 번호·작업 id·코드
  return v_result;
end
$$;
revoke all on function public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb) to service_role;

-- ⑤ 사후검사 MINUTE_WBS_POSTCHECK — 카탈로그만 읽는다(행을 보지 않는다) ----------------------------------------------------------
do $$
declare
  v text;
begin
  -- 등록 RPC 는 service_role 전용
  if has_function_privilege('anon', 'public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)', 'EXECUTE') then
    raise exception 'MINUTE_WBS_POSTCHECK: 등록 RPC 실행권이 어긋났다(anon·authenticated 불가·service_role 가능이어야 한다)';
  end if;
  -- DEFINER·빈 search_path — 등록 RPC 와 트리거 함수
  select string_agg(p.proname, ', ') into v from pg_proc p
   where p.oid in ('public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)'::regprocedure,
                   'public.wbs_item_links_minute_scope()'::regprocedure)
     and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""']);
  if v is not null then raise exception 'MINUTE_WBS_POSTCHECK: DEFINER·search_path 가 어긋났다: %', v; end if;
  -- 잠금 뒤 다른 행을 읽는 RPC 의 격리 검사 문자열(H2 ③ — 0013 과 같은 문장)
  select p.prosrc into v from pg_proc p
   where p.oid = 'public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb)'::regprocedure;
  if position('if pg_catalog.current_setting(''transaction_isolation'') is distinct from ''read committed'' then' in v) = 0
     or position('MINUTE_WBS_ISOLATION' in v) = 0 then
    raise exception 'MINUTE_WBS_POSTCHECK: 등록 RPC 에 격리 수준 검사가 없다';
  end if;
  -- 표는 RLS 를 켰다
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.wbs_item_links'::regclass) then
    raise exception 'MINUTE_WBS_POSTCHECK: wbs_item_links 의 RLS 가 꺼져 있다';
  end if;
  -- 세션 권한은 authenticated 의 SELECT 하나뿐(열 단위 권한 포함) — 쓰기는 service_role(등록 RPC)만
  if not has_table_privilege('authenticated', 'public.wbs_item_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.wbs_item_links', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
     or has_any_column_privilege('authenticated', 'public.wbs_item_links', 'INSERT, UPDATE, REFERENCES')
     or has_table_privilege('anon', 'public.wbs_item_links', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
     or has_any_column_privilege('anon', 'public.wbs_item_links', 'SELECT, INSERT, UPDATE, REFERENCES') then
    raise exception 'MINUTE_WBS_POSTCHECK: wbs_item_links 의 세션 권한이 authenticated 의 SELECT 하나가 아니다';
  end if;
  -- action 문단 부분 유일 인덱스(§5.6 — 두 번 누름·재전송의 마지막 그물)
  if not exists (select 1 from pg_index i
                  where i.indexrelid = to_regclass('public.wbs_item_links_action_block_uidx')
                    and i.indrelid = 'public.wbs_item_links'::regclass and i.indisunique and i.indpred is not null) then
    raise exception 'MINUTE_WBS_POSTCHECK: 부분 유일 인덱스 wbs_item_links_action_block_uidx 가 없다';
  end if;
  -- 프로젝트 삭제(0058)가 모르는 참조·삭제 트리거가 생기지 않았다 — 이 표는 wbs_items 를 CASCADE 로 따라간다
  v := public.project_delete_unknown_references();
  if v is not null then raise exception 'MINUTE_WBS_POSTCHECK: delete_project 가 모르는 참조·삭제 트리거가 생겼다: %', v; end if;
end $$;

commit;
