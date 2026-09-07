import type { PersistedSopItem, SopStageKey } from '@/services/sop.service'

const makeItems = (prefix: string, labels: string[]): PersistedSopItem[] => labels.map((label, index) => ({
  id: `${prefix}-${index + 1}`,
  label,
}))

export interface CrmSystemSopGuide {
  id: string
  title: string
  description: string
  iconKey: 'shield-check' | 'contact-round' | 'clipboard-list'
  requiredRole: 'user'
  roleGroup: 'user'
  stages: Record<SopStageKey, PersistedSopItem[]>
}

export const crmSystemSopGuides: CrmSystemSopGuide[] = [
  {
    id: 'system-crm-login',
    title: 'CRM 登录',
    description: '安装纷享销客 CRM，并登录正确的企业账号',
    iconKey: 'shield-check',
    requiredRole: 'user',
    roleGroup: 'user',
    stages: {
      materials: makeItems('system-crm-login-entry', [
        '在手机应用商店搜索并安装官方“纷享销客 CRM”APP',
        '打开纷享销客 APP，点击“登录”',
      ]),
      workflow: makeItems('system-crm-login-workflow', [
        '选择“手机号/邮箱”，输入手机号码和短信验证码；阅读并勾选服务协议、隐私政策及接收验证码同意项后登录',
        '在企业列表选择“深圳市一探疆来科技有限公司”进入系统',
      ]),
      followup: [],
    },
  },
  {
    id: 'system-crm-customer',
    title: 'CRM 客户新建与编辑',
    description: '进入客户管理，新建客户或补充已有客户资料',
    iconKey: 'contact-round',
    requiredRole: 'user',
    roleGroup: 'user',
    stages: {
      materials: makeItems('system-crm-customer-entry', [
        '在纷享销客底部导航点击“CRM”',
        '在“客户及商机管理”区域点击“客户”',
      ]),
      workflow: makeItems('system-crm-customer-workflow', [
        '进入“全部-客户”列表，点击右下角橙色“+”新建客户',
        '填写客户名称、客户级别、上级客户、来源、1级/2级行业、联系方式等信息；确认负责人后点击“提交”',
        '需要补充已有客户时，在客户列表点击目标客户进入详情',
      ]),
      followup: makeItems('system-crm-customer-followup', [
        '在客户详情右上角点击铅笔“编辑”图标',
        '补充或修正客户信息；核对客户名称（只读）、负责人及源线索等字段后点击“提交”',
      ]),
    },
  },
  {
    id: 'system-crm-followup',
    title: 'CRM 客户跟进记录',
    description: '按项目进度填写销售记录、现场照片与抄送范围',
    iconKey: 'clipboard-list',
    requiredRole: 'user',
    roleGroup: 'user',
    stages: {
      materials: makeItems('system-crm-followup-entry', [
        '在客户详情底部点击“写跟进”，进入新建销售记录',
        '根据当前项目进度选择跟进类型：上门拜访、线上跟进、上门演示、视频辅导、报价/方案/投标/合同/发货跟进、安装调试、线下/线上培训或验收跟进',
      ]),
      workflow: makeItems('system-crm-followup-workflow', [
        '如为上门演示，选择“上门演示”；需要现场凭证时点击图片按钮添加照片',
        '上传本次跟进对应的“今日水印相机”打卡照片，避免选择无关或过期图片',
        '如实填写本次跟进内容，并确认“关联业务数据”为当前客户',
      ]),
      followup: makeItems('system-crm-followup-followup', [
        '选择抄送范围：行业负责人田潇、财务部林芷因、总经办马总，选中3人后点击“确定”',
        '按需使用附件、链接、列表、语音输入、关联 CRM 对象和表格；核对记录内容、客户与抄送范围后点击“提交”',
      ]),
    },
  },
]
