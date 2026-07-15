-- Supabase may automatically grant API functions to anon when they are created.
-- This RPC exposes cross-user reservation state and must only be callable after login.
REVOKE ALL ON FUNCTION public.get_reserved_item_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reserved_item_ids() TO authenticated;
