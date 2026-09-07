-- Generated with Supabase CLI. Publish the FC200 purchase-customer delivery checklist for both existing
-- databases and fresh installations. The V2.3 confirmation sheet resolves the
-- optional-module conflict in the older V2.2 operation manual.

do $$
begin
  if not exists (
    select 1
    from public.sop_processes
    where id = 'fc200-customer-delivery'
  ) then
    update public.sop_processes
    set sort_order = sort_order + 1
    where sort_order >= 2;
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
  values (
    'fc200-customer-delivery',
    'operations',
    'FC200 购机用户交付',
    '订单核验、交机激活、实操培训、安全告知与交付归档',
    'ready',
    'package-open',
    null,
    null,
    null,
    null,
    $sop$
    {
      "materials": [
        {"id":"fc200-material-1","label":"核对订单：平台商、零售商、直销/分销及FC200机型；每单提交《DJI大疆运载广东交付收集表》"},
        {"id":"fc200-material-2","label":"核对服务类型、客户类型（C/B/G）、数量、套装、飞控SN及持证情况"},
        {"id":"fc200-material-3","label":"至少提前24小时确认同天或分天、到场时间地点、联系人、行程与提机安排"},
        {"id":"fc200-material-4","label":"分天交付时约定培训日与提机日，间隔建议不超过7天，并准备展示机/培训机"},
        {"id":"fc200-material-5","label":"勘察空旷平坦场地：无禁飞、无高压线和建筑遮挡，确认吊运路线与备降点"},
        {"id":"fc200-material-6","label":"核查天气适飞、现场通风及稳定网络；准备移动热点和最新固件U盘离线包"},
        {"id":"fc200-material-7","label":"工程师B控满电、飞机电池满电；分天培训备至少2组电池；充电设备到场"},
        {"id":"fc200-material-8","label":"确认工程师资质与外出审批；备齐安全帽、反光衣、手套和警示隔离用品"},
        {"id":"fc200-material-9","label":"打印《安全作业须知》《FC200交付确认书》各1份，准备签字盖章与拍照工具"},
        {"id":"fc200-material-10","label":"准备吊钩、绳具、协同配件（如适用）和测试负载，检查无磨损、缠绕及缺件"},
        {"id":"fc200-material-11","label":"准备负载连接线紧固件、WD40、安装工具和简易吊运临时加固胶带"},
        {"id":"fc200-material-12","label":"确认DJI Ag/大疆运服已登录工程师账号，用户DJI账号与UOM实名资料可用"},
        {"id":"fc200-material-13","label":"预建CRM归档记录，明确照片、签署件、版本号和异常记录的上传责任人"}
      ],
      "workflow": [
        {"id":"fc200-workflow-1","label":"到场复核《DJI大疆运载广东交付收集表》：平台商、零售商、销售类型及FC200机型"},
        {"id":"fc200-workflow-2","label":"确认服务分支：新机/补训/持证仅交机；模块5/6按客户类型执行，模块7均选做"},
        {"id":"fc200-workflow-3","label":"召开开工安全会：复核空域、天气、路线、备降点、PPE及大于10米隔离区"},
        {"id":"fc200-workflow-4","label":"地勤完成安全教育；用户亲手操作，工程师全程持B控，未确认安全不得移交控制"},
        {"id":"fc200-workflow-5","label":"核查箱数和外包装，无倒置、潮湿或破损后方可接收"},
        {"id":"fc200-workflow-6","label":"与用户共同开箱，按套装清单清点配件并检查机身、桨叶和吊运系统外观"},
        {"id":"fc200-workflow-7","label":"检查机身螺丝、遥控器天线/屏幕、吊钩与绳具；异常立即记录并转区域售后"},
        {"id":"fc200-workflow-8","label":"拍摄至少2张含飞控SN的整机照片并上传CRM"},
        {"id":"fc200-workflow-9","label":"逐一将8个电机桨叶缓慢展至180°，确认机臂与机身卡扣锁紧"},
        {"id":"fc200-workflow-10","label":"告知新旧电池不得混用；旧电池联系售后更换卡扣，多机作业仅用DB2400"},
        {"id":"fc200-workflow-11","label":"确认电池卡扣到位，并告知作业中持续关注推荐载重、电池温度和电量"},
        {"id":"fc200-workflow-12","label":"人工确认负载卡扣完全到位；FC200无负载卡扣在位检测，不得依赖设备判断"},
        {"id":"fc200-workflow-13","label":"安装负载连接线紧固件，喷涂WD40后插拔母端2-3次，按标准拍照回传CRM"},
        {"id":"fc200-workflow-14","label":"协助用户完成民航局UOM实名；按当地要求补充地方实名登记"},
        {"id":"fc200-workflow-15","label":"下载/登录大疆运服，核对账号信息与购机信息一致并完成实名"},
        {"id":"fc200-workflow-16","label":"连接遥控器与飞机完成设备激活，确认设备绑定到正确账号"},
        {"id":"fc200-workflow-17","label":"激活遥控器并选择超级基站或网络RTK；使用基站时记录基站编号与定位状态"},
        {"id":"fc200-workflow-18","label":"设置并讲解返航点、失联行为和降落规划，确认参数适合作业环境"},
        {"id":"fc200-workflow-19","label":"固件升级前确认电量至少50%并接入供电；升级中不得关机"},
        {"id":"fc200-workflow-20","label":"升级后重启，核对飞机、遥控器、电池和负载板版本一致，无报错告警并拍照"},
        {"id":"fc200-workflow-21","label":"告知当前版本限制：电线与后方避障能力有限，扬尘/长条货物等场景须谨慎"},
        {"id":"fc200-workflow-22","label":"激活发电机/充电器，核对型号；由用户完成一次启动充电并识别常见故障码"},
        {"id":"fc200-workflow-23","label":"逐条讲解《安全作业须知》，用户手写签名后拍照上传CRM"},
        {"id":"fc200-workflow-24","label":"持有效CAAC大型无人机执照者记录证书号，可免实操培训但不得省略交机与安全签署"},
        {"id":"fc200-workflow-25","label":"培训按真机演示后由用户操作；不设考核，以实操了解功能为闭环"},
        {"id":"fc200-workflow-26","label":"讲解动力与安全系统：桨叶/电机、雷达/FPV及手动优先的降落伞开伞逻辑"},
        {"id":"fc200-workflow-27","label":"讲解图传与定位：8天线、4G/Sub-2G、RTK/GNSS及轨迹复演的RTK要求"},
        {"id":"fc200-workflow-28","label":"讲解负载、照明与喊话器；演示主动挂钩、收放绳和弃绳应急用途"},
        {"id":"fc200-workflow-29","label":"飞前检查机臂/机身卡扣、180°桨叶、机头罩螺丝、吊绳走向和负载卡扣"},
        {"id":"fc200-workflow-30","label":"飞前检查通流柱、电池卡扣与保护盖；双电模式补齐另2个电池位盖帽并拧紧"},
        {"id":"fc200-workflow-31","label":"遥控器检查摇杆模式、避障、返航、限高限远、低电量阈值和RTK状态"},
        {"id":"fc200-workflow-32","label":"带用户识别信号、定位、电量/温度、载重、电机出力、雷达球、FPV与地图"},
        {"id":"fc200-workflow-33","label":"首架次先用N档练习平移、自转和转弯，再讲解S/T档风险及FPV切换/变焦"},
        {"id":"fc200-workflow-34","label":"用户完成手动/自动收放绳；摆动过大不得收绳，小金属环不得直接磨损挂钩"},
        {"id":"fc200-workflow-35","label":"地勤确认货物绑紧并撤离至少25米，通报飞手后方可缓慢提升"},
        {"id":"fc200-workflow-36","label":"完成吊运架次，核对实际/推荐载重并观察摆角与自动消摆；超重必须拆分"},
        {"id":"fc200-workflow-37","label":"严禁违规载人、超载或黑飞；飞行器触碰电线时勿接触，联系95598处理"},
        {"id":"fc200-workflow-38","label":"恶劣天气禁止起飞；突发强风、雨雾或异常时中止作业并按官方流程安全返航"},
        {"id":"fc200-workflow-39","label":"演示飞行器/遥控器/准星/坐标打点，并说明飞行器打点精度最高"},
        {"id":"fc200-workflow-40","label":"演示装卸点自动作业和智能规划；执行前人工确认全航路，自动避障不可替代目视"},
        {"id":"fc200-workflow-41","label":"演示轨迹录制与复演，确认RTK锁定；查看飞行记录和政策监管入口"},
        {"id":"fc200-workflow-42","label":"讲解刷新返航点、近地减速、视觉增强避障、限飞参数，非特殊场景不使用A档"},
        {"id":"fc200-workflow-43","label":"讲解吊运位置共享、自动消摆、C1/C2自定义及主从控切换"},
        {"id":"fc200-workflow-44","label":"双控RTK须同源；讲解电离层干扰、增强图传、辅助线、落点投影和人车高亮"},
        {"id":"fc200-workflow-45","label":"演示喊话器安装、预录/实时喊话与地勤撤离、紧急告警场景"},
        {"id":"fc200-workflow-46","label":"模块5：C端可选、B/G端必做；完成航线创建/编辑/调用、参数及障碍物复核"},
        {"id":"fc200-workflow-47","label":"讲解航线失联后继续执行设置；持续目视，发现障碍立即人工接管"},
        {"id":"fc200-workflow-48","label":"模块6：C端可选、B/G端必做；完成司运团队、设备、任务下发与记录查看"},
        {"id":"fc200-workflow-49","label":"模块7所有用户均选做；多机前完成官方学习，仅用DB2400并保持机间距大于15米"},
        {"id":"fc200-workflow-50","label":"如选做多机，讲解对频/组队/对齐/飞行及单机故障、货物偏斜应急处理"},
        {"id":"fc200-workflow-51","label":"现场复核设备激活、功能、版本与告警状态；强制项未完成不得进入收尾"}
      ],
      "followup": [
        {"id":"fc200-followup-1","label":"按V2.3确认书逐项复核；跳过/不适用项写明原因，严禁提交不实交付信息"},
        {"id":"fc200-followup-2","label":"接收方与交付方签署《交付确认书》，工程师签字/盖章并填写证书号"},
        {"id":"fc200-followup-3","label":"确认书原件由交付方留存，扫描件或照片上传CRM"},
        {"id":"fc200-followup-4","label":"归档开箱SN照片至少2张、培训现场照片至少1张（可见用户与设备）"},
        {"id":"fc200-followup-5","label":"归档负载连接线紧固件照片至少2张，覆盖WD40涂覆与安装完成状态"},
        {"id":"fc200-followup-6","label":"归档安全须知签署照、固件版本照、收集表字段、培训/免训依据与异常记录"},
        {"id":"fc200-followup-7","label":"告知24小时技术支持热线400-100-0234及专属对接人联系方式"},
        {"id":"fc200-followup-8","label":"发现电池、FPV、降落伞或线缆等已知问题时建立售后记录，不得隐瞒故障交付"},
        {"id":"fc200-followup-9","label":"协助装箱；电池保持30%-60%存储，车辆固定前后机框，恶劣路况避免平台运输"},
        {"id":"fc200-followup-10","label":"设备激活后满意度问卷由运服自动推送，现场不得索取或诱导评价"},
        {"id":"fc200-followup-11","label":"仅在强制项完成、签署件齐全、照片上传且遗留问题有责任人后关闭交付"}
      ]
    }
    $sop$::jsonb,
    2
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
