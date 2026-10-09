-- 0049_vocab_default_neutral.sql
-- 이슈 출처의 제품 기본 어휘에서 특정 방법론의 낱말을 걷는다 — 'As-Is 분석' → '현황 분석'.
-- 어느 조직·프로젝트에나 쓰는 플랫폼의 기본값이 한 방법론의 용어를 전제하고 있었다. code(as_is_analysis)는 저장된 행과 설정이 가리키는
-- 식별자라 그대로 둔다 — 바뀌는 것은 설정을 저장한 적 없는 프로젝트가 읽는 기본 라벨 한 칸뿐이다(TS DEFAULT_SOURCES 와 한 쌍,
-- tests/rls/config-vocabulary.test.ts 가 대조). 인자·반환·실행권·함수 설정은 0023 그대로다.

begin;

CREATE OR REPLACE FUNCTION public.project_vocab_default(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_key
    when 'attendance.types' then '[
      {"code":"work","label":"정상근무","short":"근무","color":"done","counts_as":"work","selectable":true,"sort":1,"active":true},
      {"code":"remote","label":"재택","short":"재택","color":"brand","counts_as":"remote","selectable":false,"sort":2,"active":true},
      {"code":"annual","label":"연차","short":"연차","color":"progress","counts_as":"leave","selectable":true,"sort":3,"active":true},
      {"code":"half","label":"반차","short":"반차","color":"progress","counts_as":"leave","selectable":true,"sort":4,"active":true},
      {"code":"quarter","label":"반반차","short":"반반차","color":"progress","counts_as":"leave","selectable":true,"sort":5,"active":true},
      {"code":"sick","label":"병가","short":"병가","color":"delayed","counts_as":"leave","selectable":true,"sort":6,"active":true},
      {"code":"trip","label":"출장","short":"출장","color":"accent","counts_as":"trip","selectable":true,"sort":7,"active":true},
      {"code":"official","label":"공가","short":"공가","color":"pending","counts_as":"work","selectable":false,"sort":8,"active":true},
      {"code":"absent","label":"결근","short":"결근","color":"delayed","counts_as":"absent","selectable":false,"sort":9,"active":true}]'::jsonb
    when 'meetings.categories' then '[
      {"code":"routine","label":"정례","color":"progress","sort":1,"announce_default":false,"active":true},
      {"code":"general","label":"일반","color":"brand","sort":2,"announce_default":false,"active":true},
      {"code":"kickoff","label":"킥오프","color":"done","sort":3,"announce_default":false,"active":true},
      {"code":"review","label":"리뷰","color":"pending","sort":4,"announce_default":false,"active":true},
      {"code":"report","label":"보고","color":"accent","sort":5,"announce_default":false,"active":true},
      {"code":"external","label":"외부/고객","color":"delayed","sort":6,"announce_default":false,"active":true}]'::jsonb
    when 'issues.severities' then '[
      {"code":"high","label":"높음","rank":1,"color":"delayed","active":true},
      {"code":"medium","label":"보통","rank":2,"color":"pending","active":true},
      {"code":"low","label":"낮음","rank":3,"color":"neutral","active":true}]'::jsonb
    when 'issues.sources' then '[
      {"code":"minutes","label":"회의록","sort":1,"active":true},
      {"code":"interview","label":"인터뷰","sort":2,"active":true},
      {"code":"deliverable","label":"산출물","sort":3,"active":true},
      {"code":"as_is_analysis","label":"현황 분석","sort":4,"active":true},
      {"code":"data_analysis","label":"데이터 분석","sort":5,"active":true},
      {"code":"other","label":"기타","sort":6,"active":true}]'::jsonb
    -- SP5b: 이슈 표시 상태 기본 4행 — TS DEFAULT_ISSUE_STATUSES 와 같다(code = 범주 code, 현 칩 색)
    when 'workflow.issue_statuses' then '[
      {"code":"open","label":"열림","category":"open","color":"delayed","sort":1,"active":true},
      {"code":"in_progress","label":"진행중","category":"in_progress","color":"progress","sort":2,"active":true},
      {"code":"resolved","label":"해결","category":"resolved","color":"done","sort":3,"active":true},
      {"code":"on_hold","label":"보류","category":"on_hold","color":"neutral","sort":4,"active":true}]'::jsonb
  end
$function$;

commit;
