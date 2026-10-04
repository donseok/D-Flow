-- Roll back 0028 before 0027: no custom values, columns or audit receipts are removed here.
drop trigger issues_custom_touch on public.issues;
drop function public.touch_issue_custom_fields();
drop trigger wbs_items_broadcast on public.wbs_items;
CREATE OR REPLACE FUNCTION public.wbs_items_broadcast() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  begin
    perform realtime.send(
      jsonb_build_object(
        'id',         new.id,
        'project_id', new.project_id,
        'stage',      new.stage,
        'actual_pct', new.actual_pct,
        'updated_at', new.updated_at
      ),
      'wbs_changed',
      'project-' || new.project_id::text || '-wbs',
      true  -- private 채널
    );
  exception when others then
    null;  -- 송신 실패는 삼킨다 — 본 UPDATE 를 지키는 것이 우선
  end;
  return new;
end;
$$;
CREATE TRIGGER wbs_items_broadcast AFTER UPDATE OF stage, actual_pct ON public.wbs_items FOR EACH ROW
WHEN (old.stage IS DISTINCT FROM new.stage OR old.actual_pct IS DISTINCT FROM new.actual_pct)
EXECUTE FUNCTION public.wbs_items_broadcast();
