-- Generated with Supabase CLI. Add the three source-faithful Fxiaoke CRM guides to the
-- system SOP collection for both existing databases and fresh installations.

do $$
declare
  crm_sort_start integer;
begin
  if not exists (
    select 1
    from public.sop_processes
    where id in ('system-crm-login', 'system-crm-customer', 'system-crm-followup')
  ) then
    select min(sort_order)
    into crm_sort_start
    from public.sop_processes
    where kind = 'system';

    if crm_sort_start is null then
      select coalesce(max(sort_order) + 1, 0)
      into crm_sort_start
      from public.sop_processes;
    end if;

    update public.sop_processes
    set sort_order = sort_order + 3
    where sort_order >= crm_sort_start;
  else
    select min(sort_order)
    into crm_sort_start
    from public.sop_processes
    where id in ('system-crm-login', 'system-crm-customer', 'system-crm-followup');
  end if;

  insert into public.sop_processes (
    id,
    kind,
    title,
    description,
    status,
    icon_key,
    required_role,
    role_group,
    entry_href,
    entry_label,
    stages,
    sort_order
  )
  select
    guide.id,
    'system',
    guide.title,
    guide.description,
    'ready',
    guide.icon_key,
    'user',
    'user',
    null,
    null,
    guide.stages,
    crm_sort_start + guide.sort_offset
  from jsonb_to_recordset(
    $crm_sop$
    [
      {
        "id": "system-crm-login",
        "title": "CRM 登录",
        "description": "安装纷享销客 CRM，并登录正确的企业账号",
        "icon_key": "shield-check",
        "sort_offset": 0,
        "stages": {
          "materials": [
            {"id":"system-crm-login-entry-1","label":"在手机应用商店搜索并安装官方“纷享销客 CRM”APP"},
            {"id":"system-crm-login-entry-2","label":"打开纷享销客 APP，点击“登录”"}
          ],
          "workflow": [
            {"id":"system-crm-login-workflow-1","label":"选择“手机号/邮箱”，输入手机号码和短信验证码；阅读并勾选服务协议、隐私政策及接收验证码同意项后登录"},
            {"id":"system-crm-login-workflow-2","label":"在企业列表选择“深圳市一探疆来科技有限公司”进入系统"}
          ],
          "followup": []
        }
      },
      {
        "id": "system-crm-customer",
        "title": "CRM 客户新建与编辑",
        "description": "进入客户管理，新建客户或补充已有客户资料",
        "icon_key": "contact-round",
        "sort_offset": 1,
        "stages": {
          "materials": [
            {"id":"system-crm-customer-entry-1","label":"在纷享销客底部导航点击“CRM”"},
            {"id":"system-crm-customer-entry-2","label":"在“客户及商机管理”区域点击“客户”"}
          ],
          "workflow": [
            {"id":"system-crm-customer-workflow-1","label":"进入“全部-客户”列表，点击右下角橙色“+”新建客户"},
            {"id":"system-crm-customer-workflow-2","label":"填写客户名称、客户级别、上级客户、来源、1级/2级行业、联系方式等信息；确认负责人后点击“提交”"},
            {"id":"system-crm-customer-workflow-3","label":"需要补充已有客户时，在客户列表点击目标客户进入详情"}
          ],
          "followup": [
            {"id":"system-crm-customer-followup-1","label":"在客户详情右上角点击铅笔“编辑”图标"},
            {"id":"system-crm-customer-followup-2","label":"补充或修正客户信息；核对客户名称（只读）、负责人及源线索等字段后点击“提交”"}
          ]
        }
      },
      {
        "id": "system-crm-followup",
        "title": "CRM 客户跟进记录",
        "description": "按项目进度填写销售记录、现场照片与抄送范围",
        "icon_key": "clipboard-list",
        "sort_offset": 2,
        "stages": {
          "materials": [
            {"id":"system-crm-followup-entry-1","label":"在客户详情底部点击“写跟进”，进入新建销售记录"},
            {"id":"system-crm-followup-entry-2","label":"根据当前项目进度选择跟进类型：上门拜访、线上跟进、上门演示、视频辅导、报价/方案/投标/合同/发货跟进、安装调试、线下/线上培训或验收跟进"}
          ],
          "workflow": [
            {"id":"system-crm-followup-workflow-1","label":"如为上门演示，选择“上门演示”；需要现场凭证时点击图片按钮添加照片"},
            {"id":"system-crm-followup-workflow-2","label":"上传本次跟进对应的“今日水印相机”打卡照片，避免选择无关或过期图片"},
            {"id":"system-crm-followup-workflow-3","label":"如实填写本次跟进内容，并确认“关联业务数据”为当前客户"}
          ],
          "followup": [
            {"id":"system-crm-followup-followup-1","label":"选择抄送范围：行业负责人田潇、财务部林芷因、总经办马总，选中3人后点击“确定”"},
            {"id":"system-crm-followup-followup-2","label":"按需使用附件、链接、列表、语音输入、关联 CRM 对象和表格；核对记录内容、客户与抄送范围后点击“提交”"}
          ]
        }
      }
    ]
    $crm_sop$::jsonb
  ) as guide(
    id text,
    title text,
    description text,
    icon_key text,
    sort_offset integer,
    stages jsonb
  )
  on conflict (id) do update
  set
    kind = excluded.kind,
    title = excluded.title,
    description = excluded.description,
    status = excluded.status,
    icon_key = excluded.icon_key,
    required_role = excluded.required_role,
    role_group = excluded.role_group,
    entry_href = excluded.entry_href,
    entry_label = excluded.entry_label,
    stages = excluded.stages,
    sort_order = excluded.sort_order,
    updated_at = now();
end;
$$;
