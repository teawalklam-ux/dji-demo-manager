-- 用户客户地址簿
-- 每个用户可保存常用客户信息（名称+联系方式），借用申请时快速填充
-- 用户只能读写自己的客户；super_admin 可读取所有人的客户

CREATE TABLE public.user_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id),
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一用户下客户名称+联系方式唯一（NULL contact 用 '' 替代参与比较）
CREATE UNIQUE INDEX user_customers_user_name_contact_idx
  ON public.user_customers (user_id, customer_name, COALESCE(customer_contact, ''));

-- updated_at 自动更新（复用已有触发器函数）
CREATE TRIGGER trg_user_customers_updated_at
  BEFORE UPDATE ON public.user_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 启用 RLS
ALTER TABLE public.user_customers ENABLE ROW LEVEL SECURITY;

-- SELECT: 用户看自己的，super_admin 看所有人的
CREATE POLICY "用户可查看自己的客户"
  ON public.user_customers FOR SELECT
  USING (user_id = (select auth.uid()));

CREATE POLICY "超级管理员可查看所有客户"
  ON public.user_customers FOR SELECT
  USING (public.get_current_user_role() = 'super_admin');

-- INSERT: 用户只能为自己添加
CREATE POLICY "用户可添加自己的客户"
  ON public.user_customers FOR INSERT
  WITH CHECK (user_id = (select auth.uid()));

-- UPDATE: 用户只能修改自己的
CREATE POLICY "用户可修改自己的客户"
  ON public.user_customers FOR UPDATE
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- DELETE: 用户只能删除自己的
CREATE POLICY "用户可删除自己的客户"
  ON public.user_customers FOR DELETE
  USING (user_id = (select auth.uid()));
