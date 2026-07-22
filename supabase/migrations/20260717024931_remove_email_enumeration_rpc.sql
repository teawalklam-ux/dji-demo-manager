-- Account existence checks must not be exposed to anonymous clients. Supabase
-- Auth handles duplicate sign-up responses without exposing the profiles table.
revoke all on function public.check_email_exists(text) from public, anon, authenticated, service_role;
drop function public.check_email_exists(text);

notify pgrst, 'reload schema';
