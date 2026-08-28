import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Liquid } from 'liquid-gooey'
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  MapPinned,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import './sop-guide.css'

type StageKey = 'materials' | 'workflow' | 'followup'

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
  stages: Record<StageKey, SopItem[]>
}

interface StageDefinition {
  key: StageKey
  shortLabel: string
  title: string
  helper: string
  icon: LucideIcon
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

const initialProcesses: SopProcess[] = [
  {
    id: 'dock-site-selection',
    title: '机场选址',
    description: '出发准备、现场勘察与接电接网确认',
    status: 'ready',
    icon: MapPinned,
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
    stages: { materials: [], workflow: [], followup: [] },
  },
]

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}`
}

export function SopGuidePage() {
  const { isAdmin } = useAuth()
  const location = useLocation()
  const canEdit = isAdmin || (import.meta.env.DEV && new URLSearchParams(location.search).has('adminPreview'))
  const [processes, setProcesses] = useState<SopProcess[]>(initialProcesses)
  const [activeProcessId, setActiveProcessId] = useState(initialProcesses[0].id)
  const [activeStage, setActiveStage] = useState<StageKey>('materials')
  const [completedItems, setCompletedItems] = useState<Set<string>>(() => new Set())
  const [menuOpen, setMenuOpen] = useState(false)
  const [cardCollapsed, setCardCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newItemLabel, setNewItemLabel] = useState('')
  const [undoState, setUndoState] = useState<{
    processes: SopProcess[]
    activeProcessId: string
    message: string
  } | null>(null)
  const menuFirstItemRef = useRef<HTMLButtonElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)

  const activeProcess = useMemo(
    () => processes.find((process) => process.id === activeProcessId) ?? processes[0],
    [activeProcessId, processes],
  )
  const stageDefinition = stageDefinitions.find((stage) => stage.key === activeStage) ?? stageDefinitions[0]
  const editingEnabled = editing && canEdit
  const activeItems = activeProcess?.stages[activeStage] ?? []
  const completedCount = activeItems.filter((item) => completedItems.has(`${activeProcess?.id}:${activeStage}:${item.id}`)).length
  const totalReadyItems = activeProcess
    ? Object.values(activeProcess.stages).reduce((total, items) => total + items.length, 0)
    : 0
  const totalCompletedItems = activeProcess
    ? stageDefinitions.reduce(
      (total, stage) => total + activeProcess.stages[stage.key].filter(
        (item) => completedItems.has(`${activeProcess.id}:${stage.key}:${item.id}`),
      ).length,
      0,
    )
    : 0

  useEffect(() => {
    if (!menuOpen) return
    const frame = requestAnimationFrame(() => menuFirstItemRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuTriggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!undoState) return
    const timer = window.setTimeout(() => setUndoState(null), 8000)
    return () => window.clearTimeout(timer)
  }, [undoState])

  if (!activeProcess) return null

  const selectProcess = (processId: string) => {
    setActiveProcessId(processId)
    setActiveStage('materials')
    setCardCollapsed(false)
    setMenuOpen(false)
    menuTriggerRef.current?.focus()
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
    const currentIndex = stageDefinitions.findIndex((stage) => stage.key === stageKey)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % stageDefinitions.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + stageDefinitions.length) % stageDefinitions.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = stageDefinitions.length - 1
    else return
    event.preventDefault()
    selectStage(stageDefinitions[nextIndex].key, true)
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
    setProcesses((current) => current.map((process) => (
      process.id === activeProcess.id ? updater(process) : process
    )))
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

  const addProcess = () => {
    const id = createId('sop')
    const newProcess: SopProcess = {
      id,
      title: '新建流程',
      description: '请补充这套 SOP 的适用场景',
      status: 'draft',
      icon: BookOpenCheck,
      stages: { materials: [], workflow: [], followup: [] },
    }
    setProcesses((current) => [...current, newProcess])
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
    setActiveProcessId(remaining[0].id)
    setActiveStage('materials')
    setCardCollapsed(false)
  }

  const undoLastRemoval = () => {
    if (!undoState) return
    setProcesses(undoState.processes)
    setActiveProcessId(undoState.activeProcessId)
    setUndoState(null)
  }

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
          <div className="sop-mega-nav__identity">
            <activeProcess.icon aria-hidden="true" />
            <span>
              <strong>{activeProcess.title}</strong>
              <small>{activeProcess.description}</small>
            </span>
          </div>
          <div className="sop-mega-nav__actions">
            {canEdit && (
              <button
                type="button"
                className={`sop-admin-toggle ${editingEnabled ? 'is-active' : ''}`}
                onClick={() => setEditing((value) => !value)}
                aria-pressed={editingEnabled}
              >
                <Pencil aria-hidden="true" />
                {editingEnabled ? '退出编辑' : '编辑 SOP'}
              </button>
            )}
            <button
              ref={menuTriggerRef}
              type="button"
              className="sop-mega-nav__trigger"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-controls="sop-process-menu"
            >
              切换流程
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
        </div>

        <div id="sop-process-menu" className="sop-mega-panel" hidden={!menuOpen}>
          <div className="sop-mega-panel__head">
            <div>
              <h2>选择本次现场任务</h2>
              <p>同一套三阶段结构，可以承载不同业务 SOP。</p>
            </div>
            <button
              type="button"
              className="sop-icon-button"
              onClick={() => setMenuOpen(false)}
              aria-label="关闭流程菜单"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="sop-mega-panel__grid">
            {processes.map((process, index) => {
              const Icon = process.icon
              const itemCount = Object.values(process.stages).reduce((total, items) => total + items.length, 0)
              return (
                <button
                  key={process.id}
                  ref={index === 0 ? menuFirstItemRef : undefined}
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
            })}
          </div>
          {canEdit && (
            <div className="sop-mega-panel__admin">
              <button type="button" className="sop-text-button" onClick={addProcess}>
                <Plus aria-hidden="true" />
                新增流程
              </button>
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
          </div>
          <button
            type="button"
            className="sop-danger-button"
            onClick={removeProcess}
            disabled={processes.length <= 1}
          >
            <Trash2 aria-hidden="true" />
            删除流程
          </button>
        </section>
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
            {stageDefinitions.map((stage, index) => {
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
                    <span>保存接口尚未接入，刷新页面后会恢复示例内容。</span>
                  </form>
                )}
              </section>
            )}
          </Liquid.Item>
        </Liquid>
      </main>

      <footer className="sop-page__foot">
        <span>依次完成：物料准备 → 现场工作 → 后续交接</span>
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
