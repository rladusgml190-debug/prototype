-- 회원 탈퇴 기능 (Supabase 대시보드 > SQL Editor에 붙여 넣고 Run)
-- 로그인한 사용자가 자기 계정만 지울 수 있어요. 작품·리뷰·알림도 함께 지워져요.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
