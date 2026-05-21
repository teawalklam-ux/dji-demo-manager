-- 种子数据

-- 分类
INSERT INTO public.categories (name, code, description, icon_name, sort_order) VALUES
  ('无人机', 'DRONE', 'DJI 无人机系列产品', 'Plane', 1),
  ('云台相机', 'GIMBAL_CAMERA', 'DJI 云台及相机产品', 'Camera', 2),
  ('手持云台', 'GIMBAL', 'DJI 手持稳定器', 'Smartphone', 3),
  ('配件', 'ACCESSORY', '电池、充电器、螺旋桨等配件', 'Package', 4),
  ('行业应用', 'ENTERPRISE', '行业应用产品', 'Building2', 5);

-- 默认审批链
INSERT INTO public.approval_chains (name, borrow_type, steps) VALUES
  ('客户借用审批', 'customer', '[
    {"level": 1, "type": "role", "role": "approver", "label": "销售主管审批"},
    {"level": 2, "type": "role", "role": "admin", "label": "管理员确认"}
  ]'::jsonb),
  ('营销演示审批', 'marketing', '[
    {"level": 1, "type": "role", "role": "approver", "label": "销售主管审批"}
  ]'::jsonb);
