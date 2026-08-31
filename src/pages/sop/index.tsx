import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Liquid } from 'liquid-gooey'
import {
  ArrowRight,
  AlertCircle,
  BadgeCheck,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  ContactRound,
  DatabaseBackup,
  Download,
  FolderCog,
  History,
  ListChecks,
  LoaderCircle,
  MapPinned,
  MousePointerClick,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCcw,
  Repeat2,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCog,
  UsersRound,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import type { UserRole } from '@/lib/constants'
import { sopService, type PersistedSopProcess } from '@/services/sop.service'
import './sop-guide.css'

type StageKey = 'materials' | 'workflow' | 'followup'
type SopKind = 'operations' | 'system'
type SopRoleGroup = 'user' | 'admin' | 'super_admin'

interface SopItem {
  id: string
  label: string
}

interface SopProcess {
  id: string
  title: string
  description: string
  status: 'ready' | 'draft'
  icon: LucideIcon
  kind: SopKind
  requiredRole?: UserRole
  roleGroup?: SopRoleGroup
  entry?: {
    href: string
    label: string
  }
  stages: Record<StageKey, SopItem[]>
}

interface StageDefinition {
  key: StageKey
  shortLabel: string
  title: string
  helper: string
  icon: LucideIcon
}

const sopIconRegistry: Record<string, LucideIcon> = {
  'alert-circle': AlertCircle,
  'badge-check': BadgeCheck,
  'book-open-check': BookOpenCheck,
  'clipboard-list': ClipboardList,
  'contact-round': ContactRound,
  'database-backup': DatabaseBackup,
  download: Download,
  'folder-cog': FolderCog,
  history: History,
  'map-pinned': MapPinned,
  'package-open': PackageOpen,
  'refresh-ccw': RefreshCcw,
  'repeat-2': Repeat2,
  settings: Settings2,
  'shield-check': ShieldCheck,
  'sliders-horizontal': SlidersHorizontal,
  trash: Trash2,
  'user-cog': UserCog,
  'users-round': UsersRound,
  wrench: Wrench,
}

function getSopIconKey(icon: LucideIcon) {
  return Object.entries(sopIconRegistry).find(([, registeredIcon]) => registeredIcon === icon)?.[0]
    ?? 'book-open-check'
}

function hydrateSopProcess(process: PersistedSopProcess): SopProcess {
  return {
    id: process.id,
    kind: process.kind,
    title: process.title,
    description: process.description,
    status: process.status,
    icon: sopIconRegistry[process.icon_key] ?? BookOpenCheck,
    requiredRole: process.required_role ?? undefined,
    roleGroup: process.role_group ?? undefined,
    entry: process.entry_href
      ? { href: process.entry_href, label: process.entry_label ?? '打开功能页面' }
      : undefined,
    stages: process.stages,
  }
}

function serializeSopProcess(process: SopProcess, sortOrder: number): PersistedSopProcess {
  return {
    id: process.id,
    kind: process.kind,
    title: process.title.trim(),
    description: process.description.trim(),
    status: process.status,
    icon_key: getSopIconKey(process.icon),
    required_role: process.requiredRole ?? null,
    role_group: process.roleGroup ?? null,
    entry_href: process.entry?.href.trim() || null,
    entry_label: process.entry?.label.trim() || null,
    stages: process.stages,
    sort_order: sortOrder,
  }
}

const stageDefinitions: StageDefinition[] = [
  {
    key: 'materials',
    shortLabel: '物料',
    title: '外出前，逐项带齐',
    helper: '离开公司前完成核对，避免现场缺件。',
    icon: PackageCheck,
  },
  {
    key: 'workflow',
    shortLabel: '现场',
    title: '到达现场，按顺序推进',
    helper: '每一步都可以勾选，完成状态只保留在当前页面会话。',
    icon: ClipboardCheck,
  },
  {
    key: 'followup',
    shortLabel: '后续',
    title: '技术结束，收好尾巴',
    helper: '记录后续确认项，为部署和工单交接留出明确入口。',
    icon: BookOpenCheck,
  },
]

const systemStageDefinitions: StageDefinition[] = [
  {
    key: 'materials',
    shortLabel: '入口',
    title: '先找对入口',
    helper: '确认账号权限与所需资料，再进入对应功能页面。',
    icon: MousePointerClick,
  },
  {
    key: 'workflow',
    shortLabel: '操作',
    title: '按页面顺序完成',
    helper: '依次处理必填项、核对信息，并在提交前完成最后检查。',
    icon: ListChecks,
  },
  {
    key: 'followup',
    shortLabel: '核对',
    title: '提交后，确认结果',
    helper: '返回记录或列表确认状态，必要时保存导出文件或交接信息。',
    icon: BadgeCheck,
  },
]

const makeItems = (prefix: string, labels: string[]): SopItem[] => labels.map((label, index) => ({
  id: `${prefix}-${index + 1}`,
  label,
}))

const makeSystemGuide = ({
  id,
  title,
  description,
  icon,
  requiredRole,
  roleGroup,
  href,
  entryLabel,
  entry,
  workflow,
  followup,
}: {
  id: string
  title: string
  description: string
  icon: LucideIcon
  requiredRole: UserRole
  roleGroup: SopRoleGroup
  href: string
  entryLabel: string
  entry: string[]
  workflow: string[]
  followup: string[]
}): SopProcess => ({
  id,
  title,
  description,
  status: 'ready',
  icon,
  kind: 'system',
  requiredRole,
  roleGroup,
  entry: { href, label: entryLabel },
  stages: {
    materials: makeItems(`${id}-entry`, entry),
    workflow: makeItems(`${id}-workflow`, workflow),
    followup: makeItems(`${id}-followup`, followup),
  },
})

const initialProcesses: SopProcess[] = [
  {
    id: 'dock-site-selection',
    title: '机场选址',
    description: '出发准备、现场勘察与接电接网确认',
    status: 'ready',
    icon: MapPinned,
    kind: 'operations',
    stages: {
      materials: [
        { id: 'm4-aircraft', label: 'Matrice 4 系列无人机' },
        { id: 'm4-battery', label: 'Matrice 4 系列电池' },
        { id: 'rc-plus-2', label: 'RC Plus 2 遥控器' },
      ],
      workflow: [
        { id: 'approval', label: '外出审批' },
        { id: 'arrival', label: '到达现场' },
        { id: 'watermark', label: '报备水印' },
        { id: 'obstruction', label: '确认遮挡' },
        { id: 'interference', label: '确认电磁干扰' },
        { id: 'mounting', label: '确认固定方式' },
        { id: 'construction', label: '确认施工条件' },
        { id: 'controller-site', label: '遥控器选址' },
        { id: 'flight-route', label: '进离场航线（如有）' },
        { id: 'finish', label: '结束选址' },
      ],
      followup: [
        { id: 'power', label: '确认接电方式' },
        { id: 'network', label: '确认接网方式' },
      ],
    },
  },
  {
    id: 'dock-deployment',
    title: '机场安装部署',
    description: '固定部署：设备安装、接地接网接电、配置调试与验收',
    status: 'ready',
    icon: Settings2,
    kind: 'operations',
    stages: {
      materials: [
        { id: 'deploy-dock-kit', label: '大疆机场 3 主机、原装附件与紧固件' },
        { id: 'deploy-aircraft-kit', label: 'Matrice 4D / 4TD、飞行器电池与 microSD 卡' },
        { id: 'deploy-android-app', label: '安卓手机（已安装大疆行业 App）与双头 USB-C 数据线' },
        { id: 'deploy-controller', label: 'DJI RC Plus 2 行业版遥控器' },
        { id: 'deploy-computer-account', label: '电脑、DJI 账号、组织 ID 与设备绑定码' },
        { id: 'deploy-ppe', label: '安全帽、护目镜、绝缘手套、绝缘鞋与防尘口罩' },
        { id: 'deploy-drill', label: '冲击钻、Φ12 mm 钻头与羊角锤' },
        { id: 'deploy-measure', label: '水平尺与卷尺' },
        { id: 'deploy-handling', label: '手动液压搬运叉车、人字梯；吊装时另备吊篮与索具' },
        { id: 'deploy-electric-tools', label: '斜口钳、电缆剥线钳、剥线钳与压线钳' },
        { id: 'deploy-fastener-tools', label: '内六角扳手、活口扳手与 M8 螺丝螺母' },
        { id: 'deploy-network-tools', label: '网线钳与网线测试仪' },
        { id: 'deploy-testers', label: '万用表与接地电阻测试仪' },
        { id: 'deploy-cable-reel', label: '电缆线盘' },
        { id: 'deploy-power-material', label: '1.5 mm² 三芯户外护套电缆与电工胶带' },
        { id: 'deploy-network-material', label: '超六类或以上双绞线与超六类水晶头' },
        { id: 'deploy-conduit', label: '波纹管与波纹管堵头' },
        { id: 'deploy-grounding', label: '接地线、接地针及现场接地连接件' },
        { id: 'deploy-power-protection', label: '2P 16A 漏电断路器与 40 kA 浪涌保护器（现场配电）' },
        { id: 'deploy-waterproof-box', label: '户外防水配电箱（电缆超过 50 m 时建议）' },
        { id: 'deploy-4g', label: 'DJI 增强图传模块与 SIM / eSIM（4G 接入时选装）' },
        { id: 'deploy-optional-hardware', label: '卡箍、排水管与 T 型导风隔板（按场景选装）' },
      ],
      workflow: [
        { id: 'deploy-approval-safety', label: '完成外出审批；确认安装人员资质、个人防护与现场天气满足安全要求' },
        { id: 'deploy-site-acceptance', label: '复核选址结果与土建验收，确认安装点偏差不超过 20 m' },
        { id: 'deploy-utilities', label: '确认接地、电源和网络已按方案施工，电源线与网线分管敷设' },
        { id: 'deploy-transport', label: '按搬运扣手位转运和卸货，必要时由合格人员执行吊装' },
        { id: 'deploy-unbox', label: '开箱清点，检查机场、飞行器、附件型号及外观' },
        { id: 'deploy-orientation', label: '确认机场朝向与安装位置，保证舱盖开启方向无障碍且风速计相机避开阳光直射' },
        { id: 'deploy-drilling', label: '使用包装定位模板复测孔位，钻 4 个 Φ12 mm、深度不小于 60 mm 的安装孔并清理碎屑' },
        { id: 'deploy-fixing', label: '两人配合就位机场，安装并拧紧膨胀螺栓' },
        { id: 'deploy-level', label: '检查机场固定稳固、无晃动，整体倾斜小于 3°' },
        { id: 'deploy-modules', label: '安装风速计模块、外置 RTK 模块及喊话器或探照灯等配件' },
        { id: 'deploy-enhanced-link', label: '按网络方案安装机场与飞行器增强图传模块（如有）' },
        { id: 'deploy-ground-first', label: '先连接保护地线，确认无盘绕、无缠绕并测得接地电阻小于 10 Ω' },
        { id: 'deploy-network-cable', label: '按 T568B 制作并测试网线，接入机场并确认机房端及信号浪涌保护器连接牢固' },
        { id: 'deploy-power-cable', label: '断开上级电源并验电，由持证低压电工制作、检查和连接电源线' },
        { id: 'deploy-prepower-check', label: '完成通电前检查：地线、网线、电源线、机场固定、舱内清洁、急停释放与开盖区域' },
        { id: 'deploy-voltage-test', label: '闭合上级电源，在接线测试孔测量电压；结果异常时停止上电并排查' },
        { id: 'deploy-power-on', label: '拨上机场交流电源开关，核对电源、UPS、有线网络或 4G 指示灯状态' },
        { id: 'deploy-firmware', label: '将机场、飞行器和遥控器升级至最新固件，microSD 卡格式化为 exFAT' },
        { id: 'deploy-manual-flight', label: '机场与飞行器对频前，使用遥控器完成手动飞行安全测试' },
        { id: 'deploy-flighthub-project', label: '在司空 2 创建项目、添加人员并生成机场设备绑定码' },
        { id: 'deploy-app-connect', label: '用双头 USB-C 连接安卓设备与机场，在大疆行业 App 选择固定部署' },
        { id: 'deploy-install-check', label: '按 App 完成机场部件与选装配件检查' },
        { id: 'deploy-network-config', label: '配置并检测网络；静态 IP 避开机场内部通信网段' },
        { id: 'deploy-pair-activate', label: '完成机场与飞行器对频、激活，并通过组织 ID 和绑定码接入司空 2' },
        { id: 'deploy-rtk', label: '清空 RTK 天线周边，人员远离 2 m，完成 RTK 坐标标定' },
        { id: 'deploy-entry-route', label: '导入选址二维码或照片中的进离场航线（如有）' },
        { id: 'deploy-alternate-site', label: '在机场 1-50 m 内设置备降点，并设置 15-100 m 的无障碍备降转移高度' },
        { id: 'deploy-compass', label: '在开阔无磁干扰位置完成首次飞行前指南针校准' },
        { id: 'deploy-aircraft-placement', label: '机头对齐停机坪箭头放置飞行器，整理桨叶至舱内并保持两片桨叶成 90°' },
        { id: 'deploy-local-debug', label: '进入机场本地调试，核对机场与飞行器状态并将遥控器配置为 B 控' },
        { id: 'deploy-functional-test', label: '在司空 2 创建测试航线与计划，验证开关舱、起降、返航、充电、网络和任务执行' },
        { id: 'deploy-closeout', label: '移除 USB-C 线，关闭并锁紧配电柜门，清理包装、金属异物和施工遗留物' },
      ],
      followup: [
        { id: 'deploy-proof-site-survey', label: '拍摄并上传机场勘察选址结果照片' },
        { id: 'deploy-proof-overview', label: '飞行器在机场正上方 30-50 m 悬停、云台 -90°，拍摄安装环境俯视照片' },
        { id: 'deploy-proof-grounding', label: '拍摄并上传机场地线连接处照片' },
        { id: 'deploy-proof-routing', label: '拍摄并上传电源线与网线外部走线照片' },
        { id: 'deploy-proof-screen', label: '拍摄并上传大疆行业 App / 司空 2 部署完成界面' },
        { id: 'deploy-record', label: '记录设备 SN、供电与联网方式、RTK 标定方式、组织 ID 和项目归属' },
        { id: 'deploy-submit', label: '通过企业微信水印拍照并提交安装验收材料及技术工单' },
        { id: 'deploy-handover', label: '完成客户操作与安全注意事项交接，确认无遗留问题后关闭工单' },
      ],
    },
  },
  {
    id: 'dock-maintenance',
    title: '机场维修',
    description: '流程框架已预留，等待管理员录入业务标准',
    status: 'draft',
    icon: Wrench,
    kind: 'operations',
    stages: { materials: [], workflow: [], followup: [] },
  },
]

const systemProcesses: SopProcess[] = [
  makeSystemGuide({
    id: 'system-borrow-apply',
    title: '提交借用申请',
    description: '选择样机、借用类型、日期与审批链',
    icon: ClipboardList,
    requiredRole: 'user',
    roleGroup: 'user',
    href: '/borrow/apply',
    entryLabel: '打开借用申请',
    entry: ['从「借用申请」进入，确认账号已通过审核', '准备用途、借用日期、预计归还日期及客户信息（如适用）'],
    workflow: ['选择需要借用的样机并确认库存状态', '选择借用类型，填写用途、日期及客户信息', '核对系统展示的审批链后提交申请'],
    followup: ['在「我的申请」确认记录已生成及当前审批状态', '申请内容变化时先取消原申请，再按最新信息重新提交'],
  }),
  makeSystemGuide({
    id: 'system-transfer-apply',
    title: '提交转借申请',
    description: '将同一借用人名下样机转给新使用人',
    icon: Repeat2,
    requiredRole: 'user',
    roleGroup: 'user',
    href: '/borrow/apply',
    entryLabel: '打开借用申请',
    entry: ['从「借用申请」选择转借类型', '确认待转借样机均为借出或逾期状态，且当前借用人一致'],
    workflow: ['选择全部待转借样机', '填写新使用人、客户信息、用途与日期', '核对转借审批链并提交'],
    followup: ['在「我的申请」跟踪审批进度', '最终审批通过后，核对样机借用人已更新'],
  }),
  makeSystemGuide({
    id: 'system-renew-apply',
    title: '提交续借申请',
    description: '从已有借用记录发起延期',
    icon: RefreshCcw,
    requiredRole: 'user',
    roleGroup: 'user',
    href: '/borrow/my-requests',
    entryLabel: '打开我的申请',
    entry: ['进入「我的申请」，找到可续借的借用记录', '准备新的预计归还日期与续借原因'],
    workflow: ['打开记录操作菜单并选择续借', '设置晚于当前归还日的新日期', '填写续借原因并提交审批'],
    followup: ['确认续借申请已生成', '审批通过后核对原记录的预计归还日期'],
  }),
  makeSystemGuide({
    id: 'system-report-export',
    title: '报表导出',
    description: '筛选并导出样机、借用或审批数据',
    icon: Download,
    requiredRole: 'user',
    roleGroup: 'user',
    href: '/reports',
    entryLabel: '打开报表导出',
    entry: ['进入「报表导出」', '明确需要的报表类型、日期范围与状态范围'],
    workflow: ['选择样机、借用记录或审批记录报表', '设置筛选条件并预览结果', '确认字段与数据范围后导出 Excel'],
    followup: ['打开导出文件抽查记录数量与关键字段', '按团队规则命名并保存文件，避免包含无关敏感数据'],
  }),
  makeSystemGuide({
    id: 'system-return-item',
    title: '归还样机',
    description: '选择归还设备，拍照并提交归还记录',
    icon: PackageOpen,
    requiredRole: 'user',
    roleGroup: 'user',
    href: '/borrow/my-requests',
    entryLabel: '打开我的申请',
    entry: ['进入「我的申请」，找到需要归还的借用记录', '准备设备现状与附件，确保可以现场拍摄归还照片'],
    workflow: ['打开归还操作并选择本次归还的样机', '拍摄清晰的归还照片', '补充备注并核对设备后提交'],
    followup: ['确认归还记录提交成功并返回申请列表', '核对样机状态；异常或缺件时及时联系管理员'],
  }),
  makeSystemGuide({
    id: 'system-item-approval',
    title: '样机审批',
    description: '审批人处理待办并记录审批意见',
    icon: ShieldCheck,
    requiredRole: 'approver',
    roleGroup: 'admin',
    href: '/approval/queue',
    entryLabel: '打开审批队列',
    entry: ['进入「审批队列」查看分配给当前账号的待办', '准备申请背景、库存或当前借用状态等核验信息'],
    workflow: ['打开申请详情并核对样机、用途、日期与审批链', '填写审批意见，选择通过或驳回', '高风险或信息不全时先与申请人确认'],
    followup: ['返回审批队列确认待办已更新', '需要撤销审批时联系超级管理员按权限处理'],
  }),
  makeSystemGuide({
    id: 'system-approval-chain',
    title: '审批链配置',
    description: '维护借用类型与逐级审批节点',
    icon: SlidersHorizontal,
    requiredRole: 'admin',
    roleGroup: 'admin',
    href: '/admin/approval-chains',
    entryLabel: '打开审批链配置',
    entry: ['进入「审批链配置」', '明确适用借用类型、节点顺序与每级审批人'],
    workflow: ['选择现有审批链编辑，或新建适用规则', '按实际责任顺序配置审批节点', '保存前检查是否遗漏必需审批人'],
    followup: ['用一笔测试申请核对审批链预览', '业务职责变化后及时复查并更新配置'],
  }),
  makeSystemGuide({
    id: 'system-record-cleanup',
    title: '记录清理',
    description: '永久清理测试或用户已取消的申请',
    icon: Trash2,
    requiredRole: 'admin',
    roleGroup: 'admin',
    href: '/admin/request-cleanup',
    entryLabel: '打开记录清理',
    entry: ['进入「记录清理」，先确认记录属于测试申请或用户已取消申请', '确认相关数据已无需保留；永久删除不可撤销'],
    workflow: ['按条件定位目标记录并核对申请人、设备和状态', '检查关联审批、借用、通知与库存影响', '仅对确认无误的记录执行永久删除'],
    followup: ['刷新列表确认目标记录已清除', '测试记录清理后抽查关联样机库存已正确恢复'],
  }),
  makeSystemGuide({
    id: 'system-request-history',
    title: '申请历史查询与备份规则',
    description: '查询历史，并按权限核验归档留存',
    icon: History,
    requiredRole: 'admin',
    roleGroup: 'admin',
    href: '/admin/request-history',
    entryLabel: '打开申请历史',
    entry: ['进入「申请历史」并明确人员、状态或时间范围', '涉及审计或清理前，先确认团队的留存和备份要求'],
    workflow: ['组合筛选条件定位目标申请', '打开详情核对申请、审批与借用时间线', '超级管理员可进一步使用 NAS 归档检索核验留存'],
    followup: ['按最小必要原则导出或记录查询结果', '清理前完成备份核验；普通管理员不能以页面查询替代 NAS 归档确认'],
  }),
  makeSystemGuide({
    id: 'system-inventory-maintenance',
    title: '样机建档与库存维护',
    description: '新增样机并维护可借用状态',
    icon: FolderCog,
    requiredRole: 'admin',
    roleGroup: 'admin',
    href: '/items',
    entryLabel: '打开样机管理',
    entry: ['进入「样机管理」', '准备设备名称、序列号、分类及当前状态'],
    workflow: ['新增或打开目标样机记录', '填写基础信息并核对序列号唯一性', '根据实际占用与维修情况维护状态'],
    followup: ['返回列表检索新记录并核对展示结果', '状态异常时先核查关联借用记录，避免直接覆盖业务事实'],
  }),
  makeSystemGuide({
    id: 'system-user-management',
    title: '用户管理',
    description: '审核账号、调整角色与处理登录问题',
    icon: UsersRound,
    requiredRole: 'super_admin',
    roleGroup: 'super_admin',
    href: '/admin/users',
    entryLabel: '打开用户管理',
    entry: ['进入「用户管理」，确认操作对象与其岗位职责', '角色调整或禁用前先核实影响范围'],
    workflow: ['处理待审核账号，或查找已有用户', '按最小权限原则设置角色与账号状态', '需要时执行邀请、密码重置或超级管理员转移'],
    followup: ['确认列表中的角色与状态已更新', '通知相关用户重新登录验证权限，保留必要的变更说明'],
  }),
  makeSystemGuide({
    id: 'system-customer-address-book',
    title: '客户地址簿规则与管理',
    description: '维护全局客户联系人并控制数据边界',
    icon: ContactRound,
    requiredRole: 'super_admin',
    roleGroup: 'super_admin',
    href: '/admin/customers',
    entryLabel: '打开客户地址簿',
    entry: ['进入「客户地址簿」查看各用户维护的客户资料', '删除或修订前核对客户归属与关联申请'],
    workflow: ['按名称、联系人或归属用户定位记录', '核对联系人、电话与地址等必要字段', '合并规则不明时先保留记录；确认无用后再删除'],
    followup: ['抽查借用申请中的客户选择是否正常', '定期清理重复、失效资料，并避免采集业务无关信息'],
  }),
  makeSystemGuide({
    id: 'system-global-settings',
    title: '系统设置与通知',
    description: '维护组织信息、逾期提醒与企微通知',
    icon: Settings2,
    requiredRole: 'super_admin',
    roleGroup: 'super_admin',
    href: '/admin/settings',
    entryLabel: '打开系统设置',
    entry: ['进入「系统设置」并记录修改前配置', '准备组织名称、提醒天数或企业微信 Webhook 等有效信息'],
    workflow: ['按业务需要修改组织与逾期提醒规则', '配置通知开关及 Webhook', '保存前复核敏感地址与提醒范围'],
    followup: ['执行一次受控测试，确认通知可达且内容正确', '配置异常时恢复原值并检查 Webhook 权限'],
  }),
  makeSystemGuide({
    id: 'system-super-admin-transfer',
    title: '超级管理员权限转移',
    description: '在人员变更时安全交接最高权限',
    icon: UserCog,
    requiredRole: 'super_admin',
    roleGroup: 'super_admin',
    href: '/admin/users',
    entryLabel: '打开用户管理',
    entry: ['确认接任人账号正常、身份无误且已知悉职责', '在交接窗口内准备双方在线验证'],
    workflow: ['在用户管理中选中接任人', '发起超级管理员转移并再次核对目标账号', '完成确认后由新管理员重新登录'],
    followup: ['验证新管理员可以访问用户、地址簿与系统设置', '原管理员确认自身权限已按预期调整并完成交接记录'],
  }),
  makeSystemGuide({
    id: 'system-archive-audit',
    title: 'NAS 归档检索与留存核验',
    description: '按申请历史核验备份与长期留存',
    icon: DatabaseBackup,
    requiredRole: 'super_admin',
    roleGroup: 'super_admin',
    href: '/admin/request-history',
    entryLabel: '打开申请历史',
    entry: ['进入「申请历史」并切换到 NAS 归档检索', '准备可缩小范围的申请编号、人员或时间信息'],
    workflow: ['使用最小必要条件检索归档记录', '对照系统申请详情核验关键字段与附件', '清理业务数据前确认所需记录已进入归档'],
    followup: ['记录核验时间、范围与异常项', '归档缺失或不一致时暂停清理，并交由维护人员排查'],
  }),
]

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}`
}

export function SopGuidePage() {
  const { profile, hasRole, isAdmin, isSuperAdmin } = useAuth()
  const location = useLocation()
  const adminPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('adminPreview')
  const canEdit = isAdmin || adminPreview
  const [processes, setProcesses] = useState<SopProcess[]>(() => [...initialProcesses, ...systemProcesses])
  const [activeProcessId, setActiveProcessId] = useState(initialProcesses[0].id)
  const [activeStage, setActiveStage] = useState<StageKey>('materials')
  const [completedItems, setCompletedItems] = useState<Set<string>>(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [cardCollapsed, setCardCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newItemLabel, setNewItemLabel] = useState('')
  const [menuFocusKind, setMenuFocusKind] = useState<SopKind>('operations')
  const [isSopLoading, setIsSopLoading] = useState(true)
  const [isSopSaving, setIsSopSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [persistenceSource, setPersistenceSource] = useState<'database' | 'defaults' | 'local'>('defaults')
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<{
    processes: SopProcess[]
    activeProcessId: string
    message: string
  } | null>(null)
  const menuFirstItemRef = useRef<HTMLButtonElement>(null)
  const menuFirstSystemItemRef = useRef<HTMLButtonElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuSystemTriggerRef = useRef<HTMLButtonElement>(null)

  const visibleProcesses = useMemo(() => processes.filter((process) => (
    process.kind === 'operations'
      || adminPreview
      || !process.requiredRole
      || hasRole(process.requiredRole)
  )), [adminPreview, hasRole, processes])
  const operationsProcesses = visibleProcesses.filter((process) => process.kind === 'operations')
  const visibleSystemProcesses = visibleProcesses.filter((process) => process.kind === 'system')
  const activeProcess = useMemo(
    () => visibleProcesses.find((process) => process.id === activeProcessId) ?? visibleProcesses[0],
    [activeProcessId, visibleProcesses],
  )
  const activeStageDefinitions = activeProcess?.kind === 'system' ? systemStageDefinitions : stageDefinitions
  const stageDefinition = activeStageDefinitions.find((stage) => stage.key === activeStage) ?? activeStageDefinitions[0]
  const editingEnabled = editing && canEdit
  const activeItems = activeProcess?.stages[activeStage] ?? []
  const completedCount = activeItems.filter((item) => completedItems.has(`${activeProcess?.id}:${activeStage}:${item.id}`)).length
  const totalReadyItems = activeProcess
    ? Object.values(activeProcess.stages).reduce((total, items) => total + items.length, 0)
    : 0
  const totalCompletedItems = activeProcess
    ? activeStageDefinitions.reduce(
      (total, stage) => total + activeProcess.stages[stage.key].filter(
        (item) => completedItems.has(`${activeProcess.id}:${stage.key}:${item.id}`),
      ).length,
      0,
    )
    : 0

  const currentRoleLabel = adminPreview
    ? '管理员预览'
    : profile?.role === 'super_admin'
      ? '超级管理员'
      : profile?.role === 'admin'
        ? '管理员'
        : profile?.role === 'approver'
          ? '审批人'
          : '使用人'

  useEffect(() => {
    let cancelled = false

    const loadProcesses = async () => {
      setIsSopLoading(true)
      setPersistenceError(null)
      try {
        const persistedProcesses = await sopService.getAll({ localOnly: adminPreview })
        if (cancelled) return
        if (persistedProcesses.length > 0) {
          const hydratedProcesses = persistedProcesses.map(hydrateSopProcess)
          if (isSuperAdmin && !hydratedProcesses.some((process) => process.roleGroup === 'super_admin')) {
            hydratedProcesses.push(...systemProcesses.filter((process) => process.roleGroup === 'super_admin'))
          }
          setProcesses(hydratedProcesses)
          setActiveProcessId(hydratedProcesses[0].id)
          setPersistenceSource(adminPreview ? 'local' : 'database')
        } else {
          setPersistenceSource('defaults')
        }
        setHasUnsavedChanges(false)
      } catch (error) {
        if (cancelled) return
        console.error('load SOP processes error:', error)
        setPersistenceSource('defaults')
        setPersistenceError('暂时无法读取已保存的 SOP，当前显示内置示例。')
      } finally {
        if (!cancelled) setIsSopLoading(false)
      }
    }

    void loadProcesses()
    return () => {
      cancelled = true
    }
  }, [adminPreview, isSuperAdmin])

  useEffect(() => {
    if (!menuOpen) return
    const frame = requestAnimationFrame(() => {
      const target = menuFocusKind === 'system' ? menuFirstSystemItemRef : menuFirstItemRef
      target.current?.focus()
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        const trigger = menuFocusKind === 'system' ? menuSystemTriggerRef : menuTriggerRef
        trigger.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuFocusKind, menuOpen])

  useEffect(() => {
    if (!undoState) return
    const timer = window.setTimeout(() => setUndoState(null), 8000)
    return () => window.clearTimeout(timer)
  }, [undoState])

  if (!activeProcess) return null

  const selectProcess = (processId: string) => {
    const selectedKind = visibleProcesses.find((process) => process.id === processId)?.kind ?? 'operations'
    setActiveProcessId(processId)
    setMenuFocusKind(selectedKind)
    setActiveStage('materials')
    setCardCollapsed(false)
    setMenuOpen(false)
    const trigger = selectedKind === 'system' ? menuSystemTriggerRef : menuTriggerRef
    trigger.current?.focus()
  }

  const openProcessMenu = (kind: SopKind) => {
    setMenuFocusKind(kind)
    setMenuOpen(true)
  }

  const selectStage = (stageKey: StageKey, moveFocus = false) => {
    setActiveStage(stageKey)
    setCardCollapsed(false)
    setNewItemLabel('')
    if (moveFocus) {
      requestAnimationFrame(() => document.getElementById(`sop-tab-${stageKey}`)?.focus())
    }
  }

  const handleStageKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, stageKey: StageKey) => {
    const currentIndex = activeStageDefinitions.findIndex((stage) => stage.key === stageKey)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % activeStageDefinitions.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + activeStageDefinitions.length) % activeStageDefinitions.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = activeStageDefinitions.length - 1
    else return
    event.preventDefault()
    selectStage(activeStageDefinitions[nextIndex].key, true)
  }

  const toggleItem = (itemId: string) => {
    const key = `${activeProcess.id}:${activeStage}:${itemId}`
    setCompletedItems((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const updateActiveProcess = (updater: (process: SopProcess) => SopProcess) => {
    setHasUnsavedChanges(true)
    setPersistenceError(null)
    setProcesses((current) => current.map((process) => (
      process.id === activeProcess.id ? updater(process) : process
    )))
  }

  const updateSystemRole = (requiredRole: UserRole) => {
    const roleGroup: SopRoleGroup = requiredRole === 'super_admin'
      ? 'super_admin'
      : requiredRole === 'user'
        ? 'user'
        : 'admin'
    updateActiveProcess((process) => ({ ...process, requiredRole, roleGroup }))
  }

  const renameItem = (itemId: string, label: string) => {
    updateActiveProcess((process) => ({
      ...process,
      stages: {
        ...process.stages,
        [activeStage]: process.stages[activeStage].map((item) => (
          item.id === itemId ? { ...item, label } : item
        )),
      },
    }))
  }

  const addItem = (event: FormEvent) => {
    event.preventDefault()
    const label = newItemLabel.trim()
    if (!label) return
    updateActiveProcess((process) => ({
      ...process,
      status: 'ready',
      stages: {
        ...process.stages,
        [activeStage]: [
          ...process.stages[activeStage],
          { id: createId(activeStage), label },
        ],
      },
    }))
    setNewItemLabel('')
  }

  const removeItem = (itemId: string) => {
    setUndoState({ processes, activeProcessId, message: '已移除一个清单项' })
    updateActiveProcess((process) => ({
      ...process,
      stages: {
        ...process.stages,
        [activeStage]: process.stages[activeStage].filter((item) => item.id !== itemId),
      },
    }))
  }

  const addProcess = (kind: SopKind) => {
    const id = createId('sop')
    const systemRole: UserRole = isSuperAdmin ? 'super_admin' : 'admin'
    const newProcess: SopProcess = {
      id,
      title: kind === 'system' ? '新建系统指引' : '新建业务流程',
      description: kind === 'system' ? '请补充功能入口与操作步骤' : '请补充这套 SOP 的适用场景',
      status: 'draft',
      icon: BookOpenCheck,
      kind,
      requiredRole: kind === 'system' ? systemRole : undefined,
      roleGroup: kind === 'system' ? systemRole : undefined,
      stages: { materials: [], workflow: [], followup: [] },
    }
    setProcesses((current) => [...current, newProcess])
    setHasUnsavedChanges(true)
    setPersistenceError(null)
    setActiveProcessId(id)
    setActiveStage('materials')
    setCardCollapsed(false)
    setEditing(true)
    setMenuOpen(false)
  }

  const removeProcess = () => {
    if (processes.length <= 1) return
    setUndoState({ processes, activeProcessId, message: `已移除“${activeProcess.title}”` })
    const remaining = processes.filter((process) => process.id !== activeProcess.id)
    setProcesses(remaining)
    setHasUnsavedChanges(true)
    setPersistenceError(null)
    const nextVisible = remaining.find((process) => (
      process.kind === 'operations'
      || adminPreview
      || !process.requiredRole
      || hasRole(process.requiredRole)
    ))
    if (nextVisible) setActiveProcessId(nextVisible.id)
    setActiveStage('materials')
    setCardCollapsed(false)
  }

  const undoLastRemoval = () => {
    if (!undoState) return
    setProcesses(undoState.processes)
    setHasUnsavedChanges(true)
    setPersistenceError(null)
    setActiveProcessId(undoState.activeProcessId)
    setUndoState(null)
  }

  const saveProcesses = async () => {
    if (processes.some((process) => !process.title.trim())) {
      setPersistenceError('流程名称不能为空，请补充后再保存。')
      return
    }

    setIsSopSaving(true)
    setPersistenceError(null)
    try {
      await sopService.replaceAll(
        visibleProcesses.map(serializeSopProcess),
        { localOnly: adminPreview },
      )
      setHasUnsavedChanges(false)
      setPersistenceSource(adminPreview ? 'local' : 'database')
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (error) {
      console.error('save SOP processes error:', error)
      setPersistenceError(error instanceof Error ? error.message : 'SOP 保存失败，请稍后重试。')
    } finally {
      setIsSopSaving(false)
    }
  }

  const renderProcessOption = (process: SopProcess, focusFirst: SopKind | null = null) => {
    const Icon = process.icon
    const itemCount = Object.values(process.stages).reduce((total, items) => total + items.length, 0)
    return (
      <button
        key={process.id}
        ref={focusFirst === 'system' ? menuFirstSystemItemRef : focusFirst === 'operations' ? menuFirstItemRef : undefined}
        type="button"
        className={`sop-process-option ${process.id === activeProcess.id ? 'is-active' : ''}`}
        onClick={() => selectProcess(process.id)}
        aria-current={process.id === activeProcess.id ? 'page' : undefined}
      >
        <span className="sop-process-option__icon"><Icon aria-hidden="true" /></span>
        <span className="sop-process-option__copy">
          <strong>{process.title}</strong>
          <small>{process.description}</small>
        </span>
        <span className="sop-process-option__meta">
          {itemCount ? `${itemCount} 项` : '待配置'}
        </span>
      </button>
    )
  }

  const systemRoleGroups: Array<{ key: SopRoleGroup; label: string; helper: string }> = [
    { key: 'user', label: '使用人', helper: '所有已启用账号' },
    { key: 'admin', label: '管理员', helper: '审批人仅显示审批指引' },
    { key: 'super_admin', label: '超级管理员', helper: '最高权限与全局规则' },
  ]

  return (
    <div className="hm-page sop-page">
      <section className="sop-intro" aria-labelledby="sop-page-title">
        <div className="sop-intro__copy">
          <h1 id="sop-page-title" className="sop-page__title">把下一步，做成看得见的路径。</h1>
          <p className="sop-page__lede">
            先选任务，再逐项完成。清单会跟着当前阶段展开，技术结束后仍能看到需要交接的事项。
          </p>
        </div>
        <div className="sop-intro__status" aria-label="当前 SOP 进度">
          <span className="sop-intro__status-label">当前流程</span>
          <strong>{activeProcess.title}</strong>
          <span>{totalReadyItems ? `${totalCompletedItems} / ${totalReadyItems} 已完成` : '内容待配置'}</span>
        </div>
      </section>

      <header className={`sop-mega-nav ${menuOpen ? 'is-open' : ''}`}>
        <div className="sop-mega-nav__bar">
          <div className="sop-mega-nav__quick-grid">
            <button
              ref={menuTriggerRef}
              type="button"
              className={`sop-mega-nav__quick ${activeProcess.kind === 'operations' ? 'is-active' : ''}`}
              onClick={() => openProcessMenu('operations')}
              aria-expanded={menuOpen && menuFocusKind === 'operations'}
              aria-controls="sop-process-menu"
            >
              <span className="sop-mega-nav__quick-icon"><MapPinned aria-hidden="true" /></span>
              <span className="sop-mega-nav__quick-copy">
                <small>业务作业 SOP</small>
                <strong>{activeProcess.kind === 'operations' ? activeProcess.title : `${operationsProcesses.length} 条可选流程`}</strong>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
            <button
              ref={menuSystemTriggerRef}
              type="button"
              className={`sop-mega-nav__quick ${activeProcess.kind === 'system' ? 'is-active' : ''}`}
              onClick={() => openProcessMenu('system')}
              aria-expanded={menuOpen && menuFocusKind === 'system'}
              aria-controls="sop-process-menu"
            >
              <span className="sop-mega-nav__quick-icon"><MousePointerClick aria-hidden="true" /></span>
              <span className="sop-mega-nav__quick-copy">
                <small>系统使用 SOP</small>
                <strong>{activeProcess.kind === 'system' ? activeProcess.title : `${visibleSystemProcesses.length} 条当前可见`}</strong>
              </span>
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
          {canEdit && (
            <div className="sop-mega-nav__actions">
              <button
                type="button"
                className={`sop-admin-toggle ${editingEnabled ? 'is-active' : ''}`}
                onClick={() => setEditing((value) => !value)}
                aria-pressed={editingEnabled}
              >
                <Pencil aria-hidden="true" />
                {editingEnabled ? '退出编辑' : '编辑 SOP'}
              </button>
            </div>
          )}
        </div>

        <div id="sop-process-menu" className="sop-mega-panel" hidden={!menuOpen}>
          <div className="sop-mega-panel__head">
            <div>
              <h2>选择一条可执行路径</h2>
              <p>左侧是现场作业，右侧是系统操作；仅显示当前账号可用的内容。</p>
            </div>
            <div className="sop-mega-panel__head-actions">
              <span className="sop-role-chip">当前权限 · {currentRoleLabel}</span>
              <button
                type="button"
                className="sop-icon-button"
                onClick={() => {
                  setMenuOpen(false)
                  const trigger = menuFocusKind === 'system' ? menuSystemTriggerRef : menuTriggerRef
                  trigger.current?.focus()
                }}
                aria-label="关闭流程菜单"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="sop-mega-panel__catalog">
            <section className="sop-process-column" aria-labelledby="operations-sop-title">
              <header className="sop-process-column__head">
                <div>
                  <h3 id="operations-sop-title">业务作业 SOP</h3>
                  <p>选址、安装部署与维修等现场路径</p>
                  <span>{operationsProcesses.length} 条可用流程</span>
                </div>
              </header>
              <div className="sop-mega-panel__grid">
                {operationsProcesses.map((process, index) => renderProcessOption(process, index === 0 ? 'operations' : null))}
              </div>
            </section>

            <section className="sop-process-column sop-process-column--system" aria-labelledby="system-sop-title">
              <header className="sop-process-column__head">
                <div>
                  <h3 id="system-sop-title">系统使用 SOP</h3>
                  <p>按账号权限展开，可直接进入对应功能</p>
                  <span>{visibleSystemProcesses.length} 条当前可见</span>
                </div>
              </header>
              <div className="sop-system-groups">
                {systemRoleGroups.map((group) => {
                  const groupProcesses = visibleSystemProcesses.filter((process) => process.roleGroup === group.key)
                  if (!groupProcesses.length) return null
                  return (
                    <section key={group.key} className="sop-system-group" aria-labelledby={`sop-role-${group.key}`}>
                      <header>
                        <h4 id={`sop-role-${group.key}`}>{group.label}</h4>
                        <span>{group.helper}</span>
                      </header>
                      <div className="sop-mega-panel__grid">
                        {groupProcesses.map((process) => renderProcessOption(
                          process,
                          process.id === visibleSystemProcesses[0]?.id ? 'system' : null,
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            </section>
          </div>
          {canEdit && (
            <div className="sop-mega-panel__admin">
              <div>
                <button type="button" className="sop-text-button" onClick={() => addProcess('operations')}>
                  <Plus aria-hidden="true" />
                  新增业务流程
                </button>
                <button type="button" className="sop-text-button" onClick={() => addProcess('system')}>
                  <Plus aria-hidden="true" />
                  新增系统指引
                </button>
              </div>
              <span>原型中的修改仅保留在当前页面会话。</span>
            </div>
          )}
        </div>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="sop-mega-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="关闭流程菜单"
          tabIndex={-1}
        />
      )}

      {editingEnabled && (
        <section className="sop-editor-strip" aria-label="管理员编辑工具">
          <div className="sop-editor-strip__fields">
            <label>
              <span>流程名称</span>
              <input
                value={activeProcess.title}
                onChange={(event) => updateActiveProcess((process) => ({ ...process, title: event.target.value }))}
              />
            </label>
            <label>
              <span>适用说明</span>
              <input
                value={activeProcess.description}
                onChange={(event) => updateActiveProcess((process) => ({ ...process, description: event.target.value }))}
              />
            </label>
            {activeProcess.kind === 'system' && (
              <>
                <label>
                  <span>最低可见权限</span>
                  <select
                    value={activeProcess.requiredRole ?? 'admin'}
                    onChange={(event) => updateSystemRole(event.target.value as UserRole)}
                  >
                    <option value="user">使用人及以上</option>
                    <option value="approver">审批人及以上</option>
                    <option value="admin">管理员及以上</option>
                    {(isSuperAdmin || adminPreview) && <option value="super_admin">仅超级管理员</option>}
                  </select>
                </label>
                <label>
                  <span>功能入口</span>
                  <input
                    value={activeProcess.entry?.href ?? ''}
                    placeholder="例如：/borrow/apply"
                    onChange={(event) => updateActiveProcess((process) => ({
                      ...process,
                      entry: {
                        href: event.target.value,
                        label: process.entry?.label ?? '打开功能页面',
                      },
                    }))}
                  />
                </label>
              </>
            )}
          </div>
          <div className="sop-editor-strip__actions">
            <button
              type="button"
              className="sop-save-button"
              onClick={() => void saveProcesses()}
              disabled={!hasUnsavedChanges || isSopSaving || isSopLoading}
            >
              {isSopSaving ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {isSopSaving ? '保存中' : '保存 SOP'}
            </button>
            <button
              type="button"
              className="sop-danger-button"
              onClick={removeProcess}
              disabled={processes.length <= 1 || isSopSaving}
            >
              <Trash2 aria-hidden="true" />
              删除流程
            </button>
          </div>
        </section>
      )}

      {(canEdit || persistenceError) && (
        <div
          className={`sop-persistence-status ${persistenceError ? 'is-error' : hasUnsavedChanges ? 'is-dirty' : 'is-saved'}`}
          role="status"
          aria-live="polite"
        >
          {persistenceError
            ? <AlertCircle aria-hidden="true" />
            : isSopLoading || isSopSaving
              ? <LoaderCircle className="is-spinning" aria-hidden="true" />
              : <Save aria-hidden="true" />}
          <span>
            {persistenceError
              ?? (isSopLoading
                ? '正在读取已保存的 SOP…'
                : isSopSaving
                  ? '正在写入 SOP…'
                  : hasUnsavedChanges
                    ? '有未保存修改，确认内容后点击“保存 SOP”。'
                    : lastSavedAt
                      ? `${lastSavedAt} 已保存，刷新页面后仍会保留。`
                      : persistenceSource === 'database'
                        ? '已载入云端 SOP，修改后请点击保存。'
                        : persistenceSource === 'local'
                          ? '已载入本机预览版本。'
                          : '当前使用内置示例；首次保存后将建立持久化版本。')}
          </span>
        </div>
      )}

      <main className="sop-workspace">
        <Liquid
          blur={10}
          contrast={18}
          fill="var(--color-liquid-surface)"
          shadow="0 14px 40px var(--color-liquid-shadow)"
          className="sop-liquid-group"
        >
          <div className="sop-stage-tabs" role="tablist" aria-label="SOP 阶段">
            {activeStageDefinitions.map((stage, index) => {
              const Icon = stage.icon
              const isActive = activeStage === stage.key
              const stageItems = activeProcess.stages[stage.key]
              const stageComplete = stageItems.length > 0 && stageItems.every(
                (item) => completedItems.has(`${activeProcess.id}:${stage.key}:${item.id}`),
              )
              return (
                <Liquid.Item
                  key={stage.key}
                  morph={{ shape: true, speed: 1.15, bounce: 0.18, contentBlur: 2 }}
                  className="sop-stage-tab-item"
                >
                  <button
                    type="button"
                    role="tab"
                    id={`sop-tab-${stage.key}`}
                    className={`sop-stage-tab ${isActive ? 'is-active' : ''} ${stageComplete ? 'is-complete' : ''}`}
                    onClick={() => selectStage(stage.key)}
                    onKeyDown={(event) => handleStageKeyDown(event, stage.key)}
                    aria-selected={isActive}
                    aria-controls="sop-stage-panel"
                    aria-label={`${index + 1}，${stage.shortLabel}`}
                  >
                    <span className="sop-stage-tab__number">{stageComplete ? <Check aria-hidden="true" /> : index + 1}</span>
                    {isActive && (
                      <span className="sop-stage-tab__label">
                        <Icon aria-hidden="true" />
                        {stage.shortLabel}
                      </span>
                    )}
                  </button>
                </Liquid.Item>
              )
            })}
          </div>

          <Liquid.Item
            morph={{ shape: true, speed: 1.05, bounce: 0.12, contentBlur: 3 }}
            className="sop-stage-panel-item"
          >
            {cardCollapsed ? (
              <button
                type="button"
                className="sop-collapsed-card"
                onClick={() => setCardCollapsed(false)}
                aria-label={`展开${stageDefinition.shortLabel}清单`}
              >
                <stageDefinition.icon aria-hidden="true" />
                <span>展开{stageDefinition.shortLabel}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            ) : (
              <section
                id="sop-stage-panel"
                className="sop-stage-card"
                role="tabpanel"
                aria-labelledby={`sop-tab-${activeStage}`}
              >
                <header className="sop-stage-card__head">
                  <div>
                    <h2>{stageDefinition.title}</h2>
                    <span>{stageDefinition.helper}</span>
                  </div>
                  <div className="sop-stage-card__meta">
                    <strong>{activeItems.length ? `${completedCount} / ${activeItems.length}` : '—'}</strong>
                    <span>{activeItems.length ? '本阶段完成' : '等待配置'}</span>
                    <button
                      type="button"
                      className="sop-icon-button"
                      onClick={() => setCardCollapsed(true)}
                      aria-label="收起当前阶段"
                    >
                      <ChevronUp aria-hidden="true" />
                    </button>
                  </div>
                </header>

                {activeProcess.kind === 'system' && activeProcess.entry && (
                  <aside className="sop-system-entry" aria-label="功能页面入口">
                    <span className="sop-system-entry__icon"><MousePointerClick aria-hidden="true" /></span>
                    <div>
                      <span>功能入口</span>
                      <strong>{activeProcess.entry.label}</strong>
                    </div>
                    <Link className="sop-entry-link" to={activeProcess.entry.href}>
                      现在前往
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </aside>
                )}

                {activeItems.length > 0 ? (
                  <ol className="sop-checklist">
                    {activeItems.map((item, index) => {
                      const itemKey = `${activeProcess.id}:${activeStage}:${item.id}`
                      const checked = completedItems.has(itemKey)
                      return (
                        <li key={item.id} className={`sop-checklist__item ${checked ? 'is-complete' : ''}`}>
                          <label className="sop-checklist__check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleItem(item.id)}
                              disabled={editingEnabled}
                            />
                            <span className="sop-checklist__box" aria-hidden="true"><Check /></span>
                            <span className="sop-checklist__number">{String(index + 1).padStart(2, '0')}</span>
                            {editingEnabled ? (
                              <input
                                className="sop-checklist__edit"
                                value={item.label}
                                onChange={(event) => renameItem(item.id, event.target.value)}
                                aria-label={`编辑第 ${index + 1} 项`}
                              />
                            ) : (
                              <span className="sop-checklist__label">{item.label}</span>
                            )}
                          </label>
                          {editingEnabled && (
                            <button
                              type="button"
                              className="sop-icon-button sop-icon-button--danger"
                              onClick={() => removeItem(item.id)}
                              aria-label={`移除“${item.label}”`}
                            >
                              <Trash2 aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <div className="sop-empty-state">
                    <stageDefinition.icon aria-hidden="true" />
                    <div>
                      <h3>这一阶段还没有内容</h3>
                      <p>{canEdit ? '打开编辑模式，录入第一项清单。' : '请联系管理员补充这套 SOP。'}</p>
                    </div>
                  </div>
                )}

                {editingEnabled && (
                  <form className="sop-add-item" onSubmit={addItem}>
                    <label htmlFor="sop-new-item">新增清单项</label>
                    <div>
                      <input
                        id="sop-new-item"
                        value={newItemLabel}
                        onChange={(event) => setNewItemLabel(event.target.value)}
                        placeholder="例如：填写工单编号"
                        required
                        maxLength={80}
                      />
                      <button type="submit" disabled={!newItemLabel.trim()}>
                        <Plus aria-hidden="true" />
                        添加
                      </button>
                    </div>
                    <span>新增内容会在点击“保存 SOP”后与整套流程一起写入。</span>
                  </form>
                )}
              </section>
            )}
          </Liquid.Item>
        </Liquid>
      </main>

      <footer className="sop-page__foot">
        <span>
          {activeProcess.kind === 'system'
            ? '依次完成：找到入口 → 按页面操作 → 确认处理结果'
            : '依次完成：物料准备 → 现场工作 → 后续交接'}
        </span>
        <button
          type="button"
          className="sop-text-button"
          onClick={() => {
            setActiveStage('materials')
            setCardCollapsed(false)
          }}
        >
          <RotateCcw aria-hidden="true" />
          回到第一阶段
        </button>
      </footer>

      {undoState && (
        <div className="sop-undo" role="status" aria-live="polite">
          <span>{undoState.message}</span>
          <button type="button" onClick={undoLastRemoval}>撤销</button>
          <button type="button" onClick={() => setUndoState(null)} aria-label="关闭撤销提示">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
