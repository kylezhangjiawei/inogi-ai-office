import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "E:/workCoding/inogi-ai-office/outputs/jiawei-task-checklist-20260901";
const outputPath = `${outputDir}/佳伟个人任务确认清单_产品语言版.xlsx`;

const productTasks = [
  // Electron桌面端：用操作员和现场人员能理解的语言描述
  ["Electron桌面端", "工位开机自检", "操作员每天开机准备生产", "打开软件后自动检查设备连接、本地数据库、磁盘空间、电脑时间、软件版本和Recipe版本，并把问题逐条列出来。", "全部正常时显示“工位已就绪”；有问题时直接告诉操作员找谁、做什么。", "任何关键检查未通过都锁住“开始检测”，不能带病生产。", "主责", "✅ 属于我", "P0", "D1-D5", "IT/生产/QA", "未开始", "工位运维/锁站保护", ""],
  ["Electron桌面端", "插机自动识别", "操作员把待检产品插到USB工位", "软件自动找到刚插入的产品，读取设备唯一编号，不要求操作员寻找或选择COM口。", "页面自动出现“设备已连接”、设备UID和连接状态。", "识别到多个设备、未知设备或身份不完整时，明确提示并禁止开测。", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/设备样机", "未开始", "设备通信/设备身份", ""],
  ["Electron桌面端", "扫码防串机", "操作员扫描整机SN准备检测", "扫码后自动核对SN、设备UID、工单、型号和实际连接的产品，防止扫A机却测了B机。", "核对通过后显示绿色“身份一致”；不一致时显示具体冲突项。", "身份不一致、重复绑定或检测中换机时立即终止，不允许继续。", "主责", "✅ 属于我", "P0", "D1-D5", "生产/小韩/PC端", "未开始", "防串机/身份管理", ""],
  ["Electron桌面端", "开测条件清单", "操作员准备点击开始检测", "在开测前用一张清单检查设备、SN、工单、Recipe、固件、参数包和外部仪器是否满足要求。", "每个条件显示通过或失败；全部通过才出现可点击的“开始检测”。", "任一条件缺失都显示原因和下一步，不允许只弹警告后继续。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发/生产", "未开始", "版本匹配/测试会话", ""],
  ["Electron桌面端", "自动选择检测方案", "不同机型、市场和固件版本进入同一工位", "系统根据工单、型号、市场、硬件、固件和参数包自动选择已经批准的Recipe。", "操作员只看到系统选中的检测方案名称、版本和适用范围，不需要手工选择。", "没有唯一匹配方案、方案过期或Hash不一致时锁站。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发/PC端Recipe", "未开始", "Recipe执行/版本匹配", ""],
  ["Electron桌面端", "一键自动检测", "操作员确认产品身份后开始检测", "点击一次“开始检测”，软件按照Recipe自动发命令、读取数据、计算结果并完成全部必检项。", "操作员不需要逐项点击，页面自动推进直到得到检测结论。", "不能跳过必检项；异常中止后不能把未完成的检测当成通过。", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/QA/研发", "未开始", "自动检测/Recipe执行", ""],
  ["Electron桌面端", "检测进度页面", "操作员等待一台产品完成检测", "实时展示总进度、当前检测项目、已用时间、当前数值和剩余步骤。", "操作员能一眼看出现在测到哪里、是否卡住、还要多久。", "通信断开或事件中断时停止更新并显示异常，不能继续显示旧进度。", "主责", "✅ 属于我", "P0", "D1-D5", "生产/小韩", "未开始", "操作员界面/自动检测", ""],
  ["Electron桌面端", "检测结果与下一步", "单台检测结束", "把结果分为“EOL检测通过、产品不合格、系统异常、证据待补、检测中止”，并给出对应下一步。", "通过时显示“EOL检测通过，等待QA放行”；失败时告诉操作员转返修、重插设备或联系工程师。", "桌面端不能显示“QA已正式放行”或“仓库可出库”作为本地检测结果。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/生产", "未开始", "状态模型/操作员界面", ""],
  ["Electron桌面端", "拔线立即清屏", "操作员拔下当前产品并准备检测下一台", "设备拔线后立即清除上一台的SN、UID、测量值、进度和绿色结果。", "页面回到“等待连接设备”，避免下一台误看到上一台结果。", "设备重启、会话过期或后台断开时采用同样处理。", "主责", "✅ 属于我", "P0", "D1-D5", "设备样机/测试", "未开始", "界面安全/会话隔离", ""],
  ["Electron桌面端", "通信异常自动恢复", "USB松动、设备短暂掉线或响应超时", "系统按照设定次数自动重试和重新连接，并保留可安全恢复的检测上下文。", "短暂故障自动恢复；无法恢复时显示“系统异常”及处理建议。", "恢复后必须重新确认设备UID，不能把旧设备数据接到当前产品。", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/现场测试", "未开始", "通信协议/异常恢复", ""],
  ["Electron桌面端", "检测数据先保存再亮绿", "检测完成准备显示结果", "先把原始帧、测量值、阈值、Recipe版本和最终结果完整保存到本地数据库，保存成功后才能显示通过。", "操作员看到绿色结果时，代表这台产品的检测证据已经可靠落盘。", "数据库错误、磁盘不足或事务失败时只能显示系统异常，绝不能先亮绿。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/PC端数据契约", "未开始", "本地数据库/原子提交", ""],
  ["Electron桌面端", "断网继续检测", "工位网络临时中断但产线仍需检测", "检测结果先保存在工位电脑，进入待同步队列；网络恢复后自动补传。", "页面区分“本机已保存”和“中心已同步”，并显示待同步数量。", "本机保存不等于QA放行；同步冲突时锁定相关产品等待处理。", "主责", "✅ 属于我", "P0", "D1-D5", "PC端同步接口/IT", "未开始", "离线同步/Outbox", ""],
  ["Electron桌面端", "外部仪器证据关联", "氧浓度、流量等结果来自其他仪器", "把外部仪器给出的结果、文件或记录编号关联到当前SN和run_id。", "工程详情中可以同时看到设备检测结果和外部证据。", "必需证据没有关联成功时只能显示“待补证据”，不能通过。", "配合", "❓ 待确认", "P1", "D6-D10", "工艺/测试/仪器负责人", "未开始", "外部证据", "确认仪器数据由谁提供"],
  ["Electron桌面端", "工程诊断详情", "工程师处理NG或通信异常", "提供实际值、上下限、曲线、原始帧、错误码、软件版本和Recipe版本的只读详情。", "工程师可按SN或run_id查看本机历史并定位问题。", "操作员默认看不到调试入口；详情页也不能修改原始结果。", "主责", "✅ 属于我", "P1", "D6-D10", "工程/维修/小韩", "未开始", "工程界面/数据留存", ""],
  ["Electron桌面端", "人员权限切换", "操作员、班组长、工程师和维修人员使用同一工位", "根据登录人员显示对应页面和操作，普通操作员只看生产步骤，工程人员才能看诊断详情。", "不同角色登录后菜单和按钮自动变化。", "任何角色都不能获得“强制PASS”；返修写入必须进入独立工具。", "主责", "✅ 属于我", "P1", "D6-D10", "管理员/QA", "未开始", "权限/界面安全", ""],
  ["Electron桌面端", "独立返修工具", "维修人员需要清Debug、刷固件、改参数或标定", "单独提供返修工具，读取PC端签发的返修授权后才允许执行指定操作。", "维修人员能看到允许操作、有效时间和执行结果；每一步都有记录。", "终检页面没有写入按钮；没有授权或授权过期时不能执行。", "主责", "✅ 属于我", "P0", "D6-D10", "维修/QA/小韩/PC端", "未开始", "返修工具/权限", ""],
  ["Electron桌面端", "返修后完整重测", "产品刷固件、改参数、换件或重新绑定后回到检测工位", "自动识别产品配置已经变化，使旧通过结果失效，并创建新的run_id执行完整检测。", "操作员看到“旧结果已失效，需要完整重测”，不能只测上次失败项。", "任何影响质量指纹的变更都必须触发完整重测。", "主责", "✅ 属于我", "P0", "D6-D10", "维修/QA/PC端", "未开始", "失效重测/配置指纹", ""],
  ["Electron桌面端", "工位安装与复制", "部署正式工位和备用工位", "提供可安装的Windows程序，并为每台工位设置独立工位编号、证书、版本和Recipe配置。", "安装后可以通过自检确认当前工位是否配置正确。", "复制工位软件时不能复制station_id和密钥；升级失败需要可回滚。", "配合", "❓ 待确认", "P1", "D11-D14", "IT/生产/证书负责人", "未开始", "Windows发布/工位复制", "确认IT与软件负责人边界"],

  // 当前项目PC端
  ["当前项目PC端", "产品与工单配置", "生产或管理员准备新的生产工单", "维护产品型号、市场、硬件版本、固件要求、参数包要求和允许使用的Recipe。", "工单详情清楚列出这批产品应该使用什么配置，Electron自动下载使用。", "配置未批准或版本不完整时不能下发到生产工位。", "主责", "✅ 属于我", "P0", "D1-D5", "生产/研发/QA", "未开始", "主数据/版本管理", ""],
  ["当前项目PC端", "SN与UID身份档案", "产品第一次进入检测或发生重绑", "建立每台产品的SN、完整MCU UID、工单、型号和历史绑定档案。", "输入SN或UID可以看到当前绑定关系和每次变更记录。", "重复UID、错误工单或未授权重绑必须阻止并进入异常处理。", "主责", "✅ 属于我", "P0", "D1-D5", "生产/小韩/QA", "未开始", "身份管理/中心数据", ""],
  ["当前项目PC端", "Recipe管理中心", "研发和QA准备或更新检测标准", "提供Recipe导入、查看、审核、发布、停用和历史版本管理，并保存版本号与Hash。", "QA能看到每版规则包含哪些项目、阈值和适用产品；发布后工位自动获取。", "普通操作员不能修改；已经发布的版本不能原地覆盖。", "主责", "✅ 属于我", "P0", "D1-D5", "研发/QA", "未开始", "Recipe管理/发布", ""],
  ["当前项目PC端", "工位开测授权", "多台工位同时生产或临时断网", "开测前给工位发放当前SN或工单范围的授权，离线时使用预先分配且互不重叠的范围。", "工位能明确知道自己可以检测哪些产品。", "没有授权或授权冲突时不能开测，防止多工位离线重复检测同一产品。", "主责", "✅ 属于我", "P0", "D1-D5", "生产计划/IT/Electron", "未开始", "离线防重/租约", ""],
  ["当前项目PC端", "工位接入与认证", "新工位首次接入或软件重新安装", "登记工位编号、证书、软件版本和允许使用的环境，为Electron提供受控接口。", "管理员能看到工位是否已授权、最近在线时间和当前版本。", "未知工位、过期证书或版本不兼容时拒绝连接。", "主责", "✅ 属于我", "P0", "D1-D5", "IT/Electron", "未开始", "工位接口/认证", ""],
  ["当前项目PC端", "检测数据同步中心", "Electron把离线或实时检测数据上传中心", "接收工位上传的数据，自动去重、检查缺失顺序、核对Hash，并显示同步失败和冲突。", "管理员能看到每个工位待同步多少条、哪一台产品数据不完整以及失败原因。", "数据没收完整、内容冲突或Hash异常时不能进入QA放行。", "主责", "✅ 属于我", "P0", "D6-D10", "Electron/IT", "未开始", "数据接收/完整性校验", ""],
  ["当前项目PC端", "中心检测档案", "QA、生产或售后查询一台产品完整历史", "集中保存每次run、全部测量值、原始失败、Recipe、版本、工位、人员、返修和重测记录。", "任何人按权限查询时看到的是同一份完整事实档案。", "新的通过记录不能覆盖旧NG；失效记录只能追加原因，不能删除。", "主责", "✅ 属于我", "P0", "D6-D10", "Electron/QA", "未开始", "中心追溯/质量数据库", ""],
  ["当前项目PC端", "QA放行中心", "QA审核已经完成EOL检测的产品", "提供待审核列表和单机详情，集中展示身份、Recipe、版本、实测值、外部证据、NG及返修历史。", "QA确认资料完整后执行“正式放行、拒绝或撤销”，系统记录人员、时间和原因。", "EOL失败、数据未同步完整、版本错误或证据缺失时批准按钮不可用。", "主责", "✅ 属于我", "P0", "D6-D10", "QA", "未开始", "QA界面/QA服务", ""],
  ["当前项目PC端", "三段状态展示", "生产、QA和仓库查看同一台产品状态", "在列表和详情中分别显示“EOL检测、QA放行、仓库出库”三条状态，避免都叫PASS。", "一眼能看出产品是检测通过但待QA、QA已放行但未出库，还是已经出库。", "三个状态不能互相覆盖；Electron只能产生EOL状态。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/仓库/生产", "未开始", "状态模型/QA界面", ""],
  ["当前项目PC端", "一机一码全程追溯", "QA、仓库、生产或售后按SN查产品", "支持按SN、UID、run_id、工单、工位和时间查询，串联检测、NG、返修、重测、QA和出库记录。", "用户输入一个SN即可看到从检测到出库的时间线和所有证据。", "无权限人员不能查看敏感原始帧；查询结果不能修改历史事实。", "主责", "✅ 属于我", "P1", "D6-D10", "QA/生产/仓库", "未开始", "追溯页面/中心数据", ""],
  ["当前项目PC端", "NG与返修闭环", "检测失败后需要流转到维修并重新验证", "从失败run直接创建NG流转单和返修单，指定允许操作、负责人和有效期，接收返修结果并要求完整重测。", "维修、QA和生产都能看到当前处理到哪一步、下一位责任人是谁。", "返修后旧EOL、旧QA和未使用的出库资格自动失效。", "主责", "✅ 属于我", "P1", "D6-D10", "维修/QA/生产", "未开始", "返修管理/返修失效", ""],
  ["当前项目PC端", "逐台出库互锁", "仓库准备把成品出库", "按每个SN检查EOL是否有效、QA是否正式放行、是否存在返修或质量冻结，并生成一次性出库资格。", "仓库扫描SN后明确显示“允许出库”或“禁止出库及原因”。", "不能只看SKU库存数量；未放行、资格已用或被撤销的产品不能出库。", "主责", "✅ 属于我", "P0", "D6-D10", "仓库/QA/订单模块", "未开始", "仓库数据/仓库互锁", ""],
  ["当前项目PC端", "角色与操作权限", "操作员、维修、QA、仓库和管理员登录系统", "为不同角色配置可见页面和可执行动作，例如Recipe发布、QA放行、返修授权和出库。", "用户只看到自己有权使用的功能；关键动作需要再次确认或重新认证。", "前端隐藏按钮之外，后端也必须拒绝越权请求；系统不提供强制PASS权限。", "主责", "✅ 属于我", "P0", "D6-D10", "QA/管理员/安全", "未开始", "权限/动作级权限", ""],
  ["当前项目PC端", "不可覆盖的质量审计", "发生Recipe发布、QA放行、返修、失效或出库", "自动记录谁在什么时间对哪台产品做了什么、修改前后状态及原因。", "QA或管理员可以按SN和时间查询完整操作轨迹。", "质量审计不能被普通日志清理、人工修改或因接口失败而漏记。", "主责", "✅ 属于我", "P0", "D6-D10", "QA/体系/安全", "未开始", "质量审计", ""],
  ["当前项目PC端", "质量与产能报表", "管理人员每日查看检测和回检进度", "统计产量、通过率、NG原因、返修率、完整重测率、检测耗时、通信成功率和同步积压。", "按日期、工单、机型和工位筛选，并可导出日结结果。", "报表数字必须能点回原始产品记录，不能只保存汇总数。", "主责", "✅ 属于我", "P1", "D11-D14", "生产/QA", "未开始", "报表", ""],
  ["当前项目PC端", "工位运行看板", "IT和生产负责人查看6+1工位运行情况", "展示每个工位在线状态、软件版本、Recipe Hash、最近检测、同步积压和健康异常。", "负责人能快速找到掉线、版本漂移或积压严重的工位。", "看板只负责监控；异常工位仍由Electron本地fail-closed锁站。", "主责", "✅ 属于我", "P1", "D11-D14", "IT/Electron/生产", "未开始", "工位管理", ""],
  ["当前项目PC端", "备份与恢复", "数据库故障、服务器迁移或版本升级", "制定中心数据库自动备份、恢复步骤和定期恢复演练，并记录最近一次成功恢复时间。", "管理员能确认备份是否成功以及是否经过恢复验证。", "只有备份文件但未验证恢复不算完成。", "配合", "❓ 待确认", "P1", "D11-D14", "IT/数据库管理员", "未开始", "备份恢复", "确认DBA或IT主责"],

  // 两个系统共同完成
  ["共享接口", "统一业务词典", "Electron和PC端同时开发并交换数据", "统一SN、UID、run_id、Recipe、单位、错误码以及EOL/QA/仓库状态的含义和数据格式。", "两个系统看到同一个状态时含义完全一致，不再出现各叫各的PASS。", "公共定义只能维护一份，修改时需要版本升级和兼容检查。", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/QA/研发/仓库", "未开始", "公共契约", ""],
  ["共享接口", "同一套判定规则", "Electron现场判定，PC端复核完整性", "把Recipe计算、上下限比较、缺值处理和状态判定做成两个系统共同使用的版本化规则包。", "相同数据在Electron和PC端得到同一个EOL结论。", "不能让两个团队各写一套阈值判断；规则版本不一致时锁站。", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发", "未开始", "共享判定引擎", ""],
  ["共享接口", "设备与故障模拟器", "真实设备数量不足或需要重复测试异常场景", "提供模拟设备和固定数据场景，覆盖正常通过、产品NG、掉线、半帧、旧帧、数据库失败、断网和重复上传。", "开发和测试人员可以稳定复现问题并自动回归。", "模拟器结果不能代替真实设备OQ，但必须作为开发验收门禁。", "主责", "✅ 属于我", "P0", "D6-D10", "小韩/测试/QA", "未开始", "故障注入/自动化测试", ""],
  ["共享接口", "试运行与扩展门禁", "从1台工位逐步扩展到30台样本、100台平行和6+1工位", "记录试运行问题、实际单台节拍、NG率、重测能力、错误放行和故障恢复结果，达标后再扩大规模。", "每天有一张清晰的问题清单和放量结论，知道能否进入下一阶段。", "未达到错误放行0和稳定节拍前，不直接承诺2000台批量回检。", "配合", "❓ 待确认", "P0", "D6-D14", "项目经理/QA/生产/工艺", "未开始", "试运行支持/批量回检", "确认试运行总负责人"],
];

const tasks = [
  // Electron 桌面端
  ["Electron桌面端", "总体架构", "冻结 Electron 主进程、Preload、渲染进程和后台任务的安全边界", "主责", "✅ 属于我", "P0", "D1-D5", "产品/嵌入式", "桌面端架构说明", "页面不能直接访问 USB、串口或 SQLite", "未开始", ""],
  ["Electron桌面端", "安全基线", "配置contextIsolation、sandbox、CSP和导航白名单", "主责", "✅ 属于我", "P0", "D1-D5", "安全/架构", "Electron安全配置", "渲染页面无法直接访问系统能力或任意外链", "未开始", ""],
  ["Electron桌面端", "IPC契约", "通过contextBridge暴露最小化、类型化的工位命令与snapshot接口", "主责", "✅ 属于我", "P0", "D1-D5", "共享契约/后台服务", "类型化IPC接口", "Preload不暴露通用文件、Shell或进程执行能力", "未开始", ""],
  ["Electron桌面端", "应用实例", "实现Electron单实例和重复启动聚焦", "主责", "✅ 属于我", "P1", "D1-D5", "Windows环境", "单实例控制", "重复启动不会产生两个可操作的检测会话", "未开始", ""],
  ["Electron桌面端", "设备通信", "实现 USB 设备自动发现，不依赖 COM 口号", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/设备样机", "设备发现模块", "插拔后能在目标时间内识别正确设备", "未开始", ""],
  ["Electron桌面端", "设备通信", "使用 VID/PID、完整 USB Serial 和 MCU UID 确认设备身份", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/协议字段", "设备身份模型", "不使用可变化的 COM 号作为唯一身份", "未开始", ""],
  ["Electron桌面端", "设备通信", "实现进程级设备独占和多程序抢占保护", "主责", "✅ 属于我", "P0", "D1-D5", "IT/现场工具", "设备互斥模块", "同一设备不能被两个检测会话同时占用", "未开始", ""],
  ["Electron桌面端", "通信协议", "实现握手、协议编解码和 CRC 校验", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/协议文档", "协议适配器", "正常帧可解析，CRC 错误帧不可进入判定", "未开始", ""],
  ["Electron桌面端", "通信协议", "处理粘包、半帧、重复帧、乱序帧和旧帧", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/测试样机", "流式解帧器", "故障注入下不串帧、不误判", "未开始", ""],
  ["Electron桌面端", "通信协议", "实现 Session、Sequence、BootID 和会话隔离", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/固件配合", "会话状态机", "设备重启或旧会话数据不会污染当前结果", "未开始", ""],
  ["Electron桌面端", "通信协议", "实现超时、重试、断线重连和退避策略", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/现场网络", "通信恢复策略", "异常可恢复；不可恢复时进入系统阻断", "未开始", ""],
  ["Electron桌面端", "数据校验", "校验字段类型、范围、单位、Quality 和 Error Code", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/QA/研发", "字段校验器", "字段缺失或质量异常时禁止 EOL_PASS", "未开始", ""],
  ["Electron桌面端", "防串机", "扫码后核对 SN、UID、工单和实际连接设备", "主责", "✅ 属于我", "P0", "D1-D5", "生产/PC端接口", "身份核对流程", "扫 A 机检测 B 机的情况必须被拦截", "未开始", ""],
  ["Electron桌面端", "防串机", "检测过程中持续锁定设备身份，并在最终提交前复核 UID", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/设备样机", "身份锁定机制", "检测中换机、重启或 UID 变化会使会话失效", "未开始", ""],
  ["Electron桌面端", "版本匹配", "核对工单、机型、市场、硬件、固件、Bootloader 和参数包", "主责", "✅ 属于我", "P0", "D1-D5", "PC端配置/QA研发", "版本指纹校验", "任一关键版本不匹配时不可开测或放行", "未开始", ""],
  ["Electron桌面端", "测试会话", "建立 run_id 和完整测试运行生命周期", "主责", "✅ 属于我", "P0", "D1-D5", "PC端数据契约", "测试状态机", "每次重测产生新 run_id，旧记录不可覆盖", "未开始", ""],
  ["Electron桌面端", "Recipe执行", "下载、缓存并校验已批准 Recipe 的版本、Hash 和签名", "主责", "✅ 属于我", "P0", "D1-D5", "PC端Recipe发布", "Recipe本地缓存", "未批准、Hash错误或过期Recipe不可执行", "未开始", ""],
  ["Electron桌面端", "Recipe执行", "按照工单和完整版本指纹自动匹配 Recipe", "主责", "✅ 属于我", "P0", "D1-D5", "QA研发/PC端规则", "Recipe匹配器", "操作员不能手选Recipe；无唯一匹配时锁站", "未开始", ""],
  ["Electron桌面端", "自动检测", "实现 Recipe 驱动的自动测试序列", "主责", "✅ 属于我", "P0", "D1-D5", "QA研发/小韩", "测试编排引擎", "必检项完整执行且顺序可追溯", "未开始", ""],
  ["Electron桌面端", "自动判定", "实现确定性判定引擎和 fail-closed 规则", "主责", "✅ 属于我", "P0", "D1-D5", "QA研发/共享引擎", "EOL判定模块", "信息缺失、异常或不确定时不得判PASS", "未开始", ""],
  ["Electron桌面端", "状态模型", "实现 EOL_PASS、FAIL_PRODUCT、BLOCKED_SYSTEM、PENDING、ABORTED、INVALIDATED", "主责", "✅ 属于我", "P0", "D1-D5", "PC端状态契约", "状态机实现", "状态含义明确，不能用一个PASS代替三段放行", "未开始", ""],
  ["Electron桌面端", "外部证据", "关联氧浓度、流量等外部测试证据", "配合", "❓ 待确认", "P1", "D6-D10", "工艺/测试/仪器接口", "证据关联模块", "证据缺失时只能PENDING，不能EOL_PASS", "未开始", "确认由谁提供仪器数据接口"],
  ["Electron桌面端", "本地数据库", "设计 SQLite 表、迁移、索引和本地数据生命周期", "主责", "✅ 属于我", "P0", "D1-D5", "PC端数据模型", "SQLite数据库", "支持离线运行、按SN查询和升级迁移", "未开始", ""],
  ["Electron桌面端", "数据留存", "保存原始帧、解码值、计算值、单位、阈值和Quality", "主责", "✅ 属于我", "P0", "D1-D5", "协议/Recipe契约", "完整测试事实记录", "必填记录完整率100%，原始失败不可覆盖", "未开始", ""],
  ["Electron桌面端", "原子提交", "最终判定、质量事件和 Outbox 在同一事务提交", "主责", "✅ 属于我", "P0", "D1-D5", "PC端同步协议", "原子完成流程", "事务成功前界面不得显示EOL_PASS", "未开始", ""],
  ["Electron桌面端", "锁站保护", "数据库失败、磁盘不足、系统时间异常时锁站", "主责", "✅ 属于我", "P0", "D1-D5", "IT/运维", "工位健康检查", "任何关键持久化异常都不能先亮绿", "未开始", ""],
  ["Electron桌面端", "离线同步", "实现 Outbox、event_id、本地序号和待同步队列", "主责", "✅ 属于我", "P0", "D1-D5", "PC端接收API", "Outbox模块", "断网不丢数据，重启后可继续同步", "未开始", ""],
  ["Electron桌面端", "离线同步", "实现批量上传、ACK、重试、缺号检查和冲突上报", "主责", "✅ 属于我", "P1", "D6-D10", "PC端接收API", "同步客户端", "重复上传不重复入库；冲突时不可自行覆盖", "未开始", ""],
  ["Electron桌面端", "操作员界面", "实现设备状态、SN/UID、进度、结果、失败原因和下一步", "主责", "✅ 属于我", "P0", "D1-D5", "生产/QA确认文案", "操作员首页", "操作员无需理解技术细节即可正确操作", "未开始", ""],
  ["Electron桌面端", "工程界面", "实现实际值、阈值、曲线、原始帧和本机历史查询", "主责", "✅ 属于我", "P1", "D6-D10", "工程/维修", "工程详情页", "支持现场定位通信和测试问题", "未开始", ""],
  ["Electron桌面端", "界面安全", "拔线、设备重启或会话过期后立即清空身份和绿灯", "主责", "✅ 属于我", "P0", "D1-D5", "设备故障注入", "界面快照策略", "上一台设备结果不会残留到下一台", "未开始", ""],
  ["Electron桌面端", "桌面测试", "编写Electron关键状态、IPC和断线恢复的自动化测试", "主责", "✅ 属于我", "P0", "D6-D10", "测试/设备模拟器", "桌面端测试集", "覆盖重复扫码、断线清屏、DB失败无PASS和重连恢复", "未开始", ""],
  ["Electron桌面端", "返修工具", "将终检与清Debug、刷固件、改参数等写入能力物理隔离", "主责", "✅ 属于我", "P0", "D6-D10", "维修/QA/小韩", "独立返修工具", "终检界面不存在设备写入按钮", "未开始", ""],
  ["Electron桌面端", "返修工具", "校验PC端返修授权并记录实际写入结果", "主责", "✅ 属于我", "P1", "D6-D10", "维修/PC端返修流程", "返修授权执行器", "无授权不能写设备；操作全程可审计", "未开始", ""],
  ["Electron桌面端", "失效重测", "固件、参数、标定、换件、重绑后使旧PASS失效并完整重测", "主责", "✅ 属于我", "P0", "D6-D10", "PC端失效契约/维修", "失效与重测流程", "返修后完整重测率100%", "未开始", ""],
  ["Electron桌面端", "工位运维", "实现开机自检、Recipe Hash、版本一致性和本地备份恢复", "主责", "✅ 属于我", "P1", "D6-D10", "IT/PC端配置", "工位自检与恢复工具", "自检失败锁站；备份可恢复验证", "未开始", ""],
  ["Electron桌面端", "Windows发布", "建立固定运行时、签名安装包、升级健康检查和失败回滚", "配合", "❓ 待确认", "P1", "D11-D14", "IT/证书负责人", "Windows发布包", "干净工位可安装；升级失败可回滚", "未开始", "确认签名证书和IT归属"],
  ["Electron桌面端", "工位复制", "为6+1工位配置独立station_id、凭证和配置核对", "配合", "❓ 待确认", "P1", "D11-D14", "IT/生产/工艺", "工位部署清单", "配置可复制但工位身份和密钥不能复制", "未开始", ""],

  // 当前项目 PC 端
  ["当前项目PC端", "中心数据模型", "新增产品身份、test_run、测量值、证据、Recipe、QA和仓库模型", "主责", "✅ 属于我", "P0", "D1-D5", "QA/仓库/生产", "Prisma/PostgreSQL模型", "三段状态独立，历史记录不可覆盖", "未开始", ""],
  ["当前项目PC端", "主数据", "实现工单、机型、市场和版本要求管理", "主责", "✅ 属于我", "P0", "D1-D5", "生产/研发/QA", "主数据管理", "Electron可获取唯一、有效的生产配置", "未开始", ""],
  ["当前项目PC端", "身份管理", "实现SN与完整MCU UID全局唯一绑定和历史记录", "主责", "✅ 属于我", "P0", "D1-D5", "生产/嵌入式", "身份绑定服务", "重复绑定、错误工单和错误型号必须拦截", "未开始", ""],
  ["当前项目PC端", "离线防重", "实现开测租约或工位签名SN/工单分片", "主责", "✅ 属于我", "P0", "D1-D5", "生产计划/桌面端", "租约与离线授权服务", "多工位离线时不能测试相同授权范围", "未开始", ""],
  ["当前项目PC端", "Recipe管理", "定义Recipe Schema并实现受控导入和只读查看", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发", "Recipe管理基础", "非法类型、单位或缺字段不能导入", "未开始", ""],
  ["当前项目PC端", "Recipe管理", "实现Recipe审核、发布、停用、不可变版本和Hash", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发审批人", "Recipe发布流程", "发布后内容不可原地修改，审批可追溯", "未开始", ""],
  ["当前项目PC端", "Recipe分发", "向Electron发布Recipe并管理版本失效", "主责", "✅ 属于我", "P1", "D6-D10", "Electron桌面端", "Recipe分发API", "错误或失效Recipe不能继续用于新测试", "未开始", ""],
  ["当前项目PC端", "工位接口", "实现工位注册、身份认证和配置下发接口", "主责", "✅ 属于我", "P0", "D1-D5", "IT/Electron", "Station API", "未知工位或无效凭证不能接入", "未开始", ""],
  ["当前项目PC端", "数据接收", "实现event_id、station_id、local_seq和payload_hash幂等接收", "主责", "✅ 属于我", "P0", "D1-D5", "Electron同步协议", "工位事件接收API", "重复请求不重复入库，不同内容同键必须报冲突", "未开始", ""],
  ["当前项目PC端", "完整性校验", "校验测试Manifest、事件缺口、Recipe Hash和证据完整性", "主责", "✅ 属于我", "P0", "D6-D10", "Electron/QA", "Manifest校验服务", "数据未完整同步前禁止QA_RELEASED", "未开始", ""],
  ["当前项目PC端", "同步管理", "提供同步积压、缺号、失败和冲突处理队列", "主责", "✅ 属于我", "P1", "D6-D10", "IT/Electron", "同步运维页面", "异常有明确原因、责任人和处理记录", "未开始", ""],
  ["当前项目PC端", "中心追溯", "中心保存全部测试事实、NG、返修、重测和失效历史", "主责", "✅ 属于我", "P0", "D6-D10", "Electron数据", "质量追溯库", "原始失败不可被新结果覆盖或删除", "未开始", ""],
  ["当前项目PC端", "QA界面", "将现有放行页改造成QA待审核、详情和决策中心", "主责", "✅ 属于我", "P0", "D6-D10", "QA", "QA放行中心", "页面同时展示EOL、QA、仓库三条状态轴", "未开始", ""],
  ["当前项目PC端", "QA服务", "实现QA_RELEASED、QA_REJECTED、QA_REVOKED及状态并发控制", "主责", "✅ 属于我", "P0", "D6-D10", "QA/权限模块", "QA状态服务", "重复审批或并发操作不会产生矛盾状态", "未开始", ""],
  ["当前项目PC端", "QA互锁", "实现信息缺失、版本错误、证据不全时不可正式放行", "主责", "✅ 属于我", "P0", "D6-D10", "QA/Manifest校验", "QA放行闸门", "未完整测试却QA放行的数量为0", "未开始", ""],
  ["当前项目PC端", "返修管理", "实现NG流转单、返修单、授权范围和有效期", "主责", "✅ 属于我", "P1", "D6-D10", "维修/QA", "返修管理流程", "无有效返修授权时桌面工具不能写设备", "未开始", ""],
  ["当前项目PC端", "返修失效", "接收返修动作并失效旧run、QA状态和未消费出库资格", "主责", "✅ 属于我", "P0", "D6-D10", "Electron返修工具/仓库", "质量失效服务", "任何影响指纹的变更都触发完整重测", "未开始", ""],
  ["当前项目PC端", "仓库数据", "建立逐台SN库存台账，关联当前有效质量状态", "主责", "✅ 属于我", "P0", "D6-D10", "仓库/现有库存模块", "SN库存台账", "不能只按SKU数量判断是否可出库", "未开始", ""],
  ["当前项目PC端", "仓库互锁", "生成一次性warehouse_authorization出库资格", "主责", "✅ 属于我", "P0", "D6-D10", "QA/仓库", "出库授权服务", "只有有效QA_RELEASED且无冻结时才能生成", "未开始", ""],
  ["当前项目PC端", "仓库出库", "在同一事务中逐台校验并消费出库资格", "主责", "✅ 属于我", "P0", "D6-D10", "仓库/订单模块", "逐台出库事务", "无授权、已消费或已撤销的SN不能出库", "未开始", ""],
  ["当前项目PC端", "权限", "增加Recipe、QA、返修、仓库等动作级权限和必要的重新认证", "主责", "✅ 属于我", "P0", "D6-D10", "管理员/QA", "动作级权限模型", "普通操作员不能改阈值、强制PASS或QA放行", "未开始", ""],
  ["当前项目PC端", "质量审计", "建立与业务事务同步提交的append-only质量审计", "主责", "✅ 属于我", "P0", "D6-D10", "QA/法务或体系", "质量审计日志", "关键状态变化均有操作者、原因和前后状态", "未开始", ""],
  ["当前项目PC端", "追溯页面", "将现有追溯页接入真实数据，支持SN、UID、run_id和工单查询", "主责", "✅ 属于我", "P1", "D6-D10", "QA/生产/仓库", "中心追溯页面", "按SN查询目标不超过10秒", "未开始", ""],
  ["当前项目PC端", "报表", "实现日结、NG、返修、重测、检测耗时和通信成功率报表", "主责", "✅ 属于我", "P1", "D11-D14", "生产/QA", "质量运营报表", "指标定义一致且可追溯到原始记录", "未开始", ""],
  ["当前项目PC端", "工位管理", "展示工位在线状态、版本、Recipe Hash、同步积压和健康状态", "主责", "✅ 属于我", "P1", "D11-D14", "IT/Electron", "工位监控页面", "6+1工位配置和异常一目了然", "未开始", ""],
  ["当前项目PC端", "Web验收测试", "增加QA放行、追溯、权限、仓库互锁和并发冲突测试", "主责", "✅ 属于我", "P0", "D6-D10", "测试/QA/仓库", "PC端自动化测试集", "覆盖NG禁放、权限拒绝、重复操作和撤销联动", "未开始", ""],
  ["当前项目PC端", "备份恢复", "制定中心数据库备份、恢复和恢复演练流程", "配合", "❓ 待确认", "P1", "D11-D14", "IT/数据库管理员", "备份恢复方案", "RC1前完成可验证的恢复演练", "未开始", "确认DBA/IT主责边界"],

  // 共享契约与联调
  ["共享接口", "公共契约", "统一状态枚举、DTO、单位、错误码和Manifest格式", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/QA/PC与Electron", "版本化契约包", "两个系统引用同一份定义，不复制维护", "未开始", ""],
  ["共享接口", "判定引擎", "建立Electron与PC复核共用的确定性Recipe判定引擎", "主责", "✅ 属于我", "P0", "D1-D5", "QA/研发", "共享判定包", "相同输入、版本和Recipe始终得到相同结论", "未开始", ""],
  ["共享接口", "配置指纹", "统一SN、UID、工单、软硬件、参数和Debug配置指纹", "主责", "✅ 属于我", "P0", "D1-D5", "小韩/QA/维修", "配置指纹规范", "影响质量的变更均可检测并触发失效", "未开始", ""],
  ["共享接口", "接口兼容", "定义Electron与PC端API版本、兼容矩阵和升级顺序", "主责", "✅ 属于我", "P1", "D6-D10", "IT/发布负责人", "兼容性矩阵", "新旧版本组合不兼容时明确锁站而非静默失败", "未开始", ""],
  ["共享接口", "故障注入", "建立设备模拟器和USB、帧、数据库、网络、重启故障测试", "主责", "✅ 属于我", "P0", "D6-D10", "小韩/测试/QA", "自动化故障测试集", "覆盖粘包、半帧、掉线、旧帧、磁盘满和重复同步", "未开始", ""],
  ["共享接口", "试运行支持", "配合30台Alpha、OQ、100台平行试运行并关闭问题", "配合", "❓ 待确认", "P0", "D6-D10", "QA/生产/工艺/小韩", "试运行问题清单", "错误放行0，阻塞和NG原因可追溯", "未开始", "确认试运行总负责人"],
  ["共享接口", "批量回检", "支持6+1工位和2000台回检的数据汇总与异常处理", "配合", "❓ 待确认", "P1", "D11-D14", "生产/QA/仓库/IT", "批量回检支持方案", "满足实际节拍后再扩大；每日状态可核对", "未开始", "需以pilot节拍作为扩展门禁"],
];

const boundaries = [
  ["嵌入式", "嵌入式字段采集和底层安全控制", "小韩", "定义接口、校验字段、完成联调和异常互锁", "不能替代嵌入式负责人修改底层安全策略"],
  ["质量标准", "阈值、必检项和产品合格标准的决定", "研发/QA", "把批准后的标准做成Recipe和系统互锁", "不能自行放宽阈值或删减必检项"],
  ["Recipe审批", "Recipe内容的正式批准和质量签字", "研发/QA", "实现版本、Hash、审批、发布和审计流程", "不能用管理员权限代替QA审批"],
  ["QA放行", "对具体产品执行最终QA_RELEASED的业务决定", "QA", "实现放行闸门、证据展示、权限和审计", "不能代替QA把NG改成PASS"],
  ["工艺测试", "工装设计、仪器校准和MSA", "工艺/测试", "读取校准状态和证据，过期时锁站", "不能自行签发校准合格或MSA结论"],
  ["维修处置", "返修方案、换件范围和产品处置决定", "维修/研发/QA", "实现授权、执行记录、旧结果失效和完整重测", "不能自行决定有质量影响的维修方案"],
  ["仓库业务", "实际拣货、复核和物理出库操作", "仓库", "实现逐台SN出库资格、互锁和记录", "不能用软件放行代替仓库实物复核"],
  ["生产管理", "生产计划、人员排班和回检批次优先级", "生产负责人", "提供系统能力、节拍数据和异常报表", "不能自行改变生产计划或质量门禁"],
];

const statusAxes = [
  ["EOL检测状态", "EOL_PASS / FAIL_PRODUCT / BLOCKED_SYSTEM / PENDING / ABORTED / INVALIDATED", "Electron桌面端", "产生并保存原始检测结论", "接收、验证、追溯"],
  ["QA放行状态", "QA_PENDING / QA_RELEASED / QA_REJECTED / QA_REVOKED", "当前项目PC端", "只读显示，不得修改", "QA按权限正式决策"],
  ["仓库出库状态", "WAREHOUSE_HOLD / WAREHOUSE_ALLOWED / SHIPPED", "当前项目PC端", "只读显示，不得生成", "自动计算、一次性授权、出库消费"],
];

const systemMatrix = [
  ["USB设备发现与通信", "主责", "不负责", "PC网页不能直接访问设备"],
  ["协议、CRC、会话和重连", "主责", "不负责", "由Electron后台进程持有设备"],
  ["扫码与现场防串机", "主责", "提供工单与全局绑定规则", "最终提交前复核UID"],
  ["SN/UID全局唯一", "本地检查", "主责", "离线依赖租约或签名分片"],
  ["Recipe制定与审批", "不负责", "主责", "标准由研发/QA批准"],
  ["Recipe自动匹配与执行", "主责", "发布并复核", "操作员不能手选Recipe"],
  ["EOL检测结论", "产生", "接收验证", "EOL_PASS不等于QA放行"],
  ["QA正式放行", "只读显示", "主责", "Electron不得产生QA_RELEASED"],
  ["仓库出库资格", "只读显示", "主责", "必须逐台SN互锁"],
  ["本地离线数据库", "SQLite主责", "不负责", "提交成功后才可亮绿"],
  ["中心质量数据库", "不能直连", "PostgreSQL主责", "仅通过受控API同步"],
  ["设备写入/返修执行", "独立返修工具", "下发授权", "终检界面无写入按钮"],
  ["追溯、审计和报表", "本机查询/上传", "中心主责", "原始失败不可覆盖"],
  ["工位升级与健康检查", "执行、自检", "发布、监控", "每个工位使用独立身份"],
];

const redLines = [
  ["未完整测试却显示EOL_PASS", "0", "Electron桌面端", "PC端复核"],
  ["SN/UID错绑未拦截", "0", "Electron现场互锁", "PC端全局唯一"],
  ["数据库保存失败仍亮绿", "0", "Electron桌面端", "—"],
  ["原始失败记录被覆盖", "0", "Electron本地记录", "PC端中心记录"],
  ["普通工人可改阈值或强制PASS", "0", "Electron界面", "PC端权限"],
  ["必填记录完整率", "100%", "Electron采集", "PC端Manifest校验"],
  ["返修后完整重测率", "100%", "Electron重测", "PC端监督"],
  ["100台平行试运行错误放行", "0", "Electron检测", "PC端QA/仓库互锁"],
  ["通信首次成功率", "≥99%", "Electron桌面端", "PC端统计"],
  ["单台检测目标", "≤3分钟", "Electron桌面端", "PC端统计"],
  ["按SN查询", "≤10秒", "—", "PC端"],
];

const workbook = Workbook.create();
const productSheet = workbook.worksheets.add("产品版任务清单");
const taskSheet = workbook.worksheets.add("我的任务清单");
const boundarySheet = workbook.worksheets.add("非我的职责边界");
const splitSheet = workbook.worksheets.add("系统分工速查");
const acceptanceSheet = workbook.worksheets.add("验收红线");

const palette = {
  navy: "#16324F",
  teal: "#0F766E",
  blue: "#2563EB",
  lightBlue: "#EAF2FF",
  green: "#15803D",
  lightGreen: "#DCFCE7",
  amber: "#B45309",
  lightAmber: "#FEF3C7",
  red: "#B91C1C",
  lightRed: "#FEE2E2",
  gray: "#6B7280",
  lightGray: "#F3F4F6",
  border: "#D7DEE8",
  white: "#FFFFFF",
  text: "#172033",
};

function titleBand(sheet, range, title, subtitleRange, subtitle) {
  sheet.showGridLines = false;
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[title]];
  sheet.getRange(range).format = {
    fill: palette.navy,
    font: { bold: true, color: palette.white, size: 18 },
    verticalAlignment: "center",
  };
  sheet.getRange(range).format.rowHeightPx = 42;
  sheet.getRange(subtitleRange).merge();
  sheet.getRange(subtitleRange).values = [[subtitle]];
  sheet.getRange(subtitleRange).format = {
    fill: "#E8EEF5",
    font: { color: "#344054", size: 10 },
    wrapText: true,
    verticalAlignment: "center",
  };
  sheet.getRange(subtitleRange).format.rowHeightPx = 34;
}

function setColumnWidths(sheet, lastRow, widths) {
  for (const [col, width] of Object.entries(widths)) {
    sheet.getRange(`${col}1:${col}${lastRow}`).format.columnWidthPx = width;
  }
}

titleBand(
  productSheet,
  "A1:O1",
  "佳伟产品版任务清单｜先看要做什么，再看技术怎么做",
  "A2:O2",
  "阅读顺序：先看“具体开发内容”和“用户怎么用/看到”；需要技术细节时再查看“我的任务清单”。归属确认同样支持 ✅属于我 / ❌不属于我 / ❓待确认。"
);

const productStartRow = 7;
const productLastRow = productStartRow + productTasks.length - 1;
const productCards = [
  ["A3:B3", "A4:B4", "产品功能总数", `=COUNTA($A$${productStartRow}:$A$${productLastRow})`, palette.blue],
  ["C3:D3", "C4:D4", "✅ 属于我", `=COUNTIF($B$${productStartRow}:$B$${productLastRow},\"✅ 属于我\")`, palette.green],
  ["E3:F3", "E4:F4", "❌ 不属于我", `=COUNTIF($B$${productStartRow}:$B$${productLastRow},\"❌ 不属于我\")`, palette.red],
  ["G3:H3", "G4:H4", "❓ 待确认", `=COUNTIF($B$${productStartRow}:$B$${productLastRow},\"❓ 待确认\")`, palette.amber],
  ["I3:J3", "I4:J4", "已完成", `=COUNTIF($M$${productStartRow}:$M$${productLastRow},\"已完成\")`, palette.teal],
  ["K3:L3", "K4:L4", "P0核心功能", `=COUNTIF($J$${productStartRow}:$J$${productLastRow},\"P0\")`, palette.red],
  ["M3:O3", "M4:O4", "我的主责功能", `=COUNTIFS($B$${productStartRow}:$B$${productLastRow},\"✅ 属于我\",$I$${productStartRow}:$I$${productLastRow},\"主责\")`, palette.navy],
];
for (const [labelRange, valueRange, label, formula, color] of productCards) {
  productSheet.getRange(labelRange).merge();
  productSheet.getRange(labelRange).values = [[label]];
  productSheet.getRange(labelRange).format = {
    fill: "#F8FAFC",
    font: { bold: true, color },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: palette.border },
  };
  productSheet.getRange(valueRange).merge();
  productSheet.getRange(valueRange.split(":")[0]).formulas = [[formula]];
  productSheet.getRange(valueRange).format = {
    fill: palette.white,
    font: { bold: true, color, size: 18 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: palette.border },
  };
}

productSheet.getRange("A6:O6").values = [[
  "序号", "归属确认", "系统", "产品功能", "谁在什么场景使用", "具体开发内容（产品语言）",
  "用户怎么用 / 最终看到什么", "异常时系统怎么处理", "建议角色", "优先级", "阶段",
  "协作/依赖", "进度状态", "对应技术模块", "备注"
]];
const productRows = productTasks.map((r, i) => [
  i + 1, r[7], r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[8], r[9], r[10], r[11], r[12], r[13],
]);
productSheet.getRange(`A${productStartRow}:O${productLastRow}`).values = productRows;
const productTable = productSheet.tables.add(`A6:O${productLastRow}`, true, "ProductTasksTable");
productTable.style = "TableStyleMedium2";
productTable.showFilterButton = true;
productTable.showBandedRows = true;
productSheet.getRange(`A6:O${productLastRow}`).format = {
  font: { color: palette.text, size: 10 },
  verticalAlignment: "center",
};
productSheet.getRange("A6:O6").format = {
  fill: palette.navy,
  font: { bold: true, color: palette.white, size: 10 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
productSheet.getRange(`A${productStartRow}:D${productLastRow}`).format.horizontalAlignment = "center";
productSheet.getRange(`I${productStartRow}:M${productLastRow}`).format.horizontalAlignment = "center";
productSheet.getRange(`D${productStartRow}:O${productLastRow}`).format.wrapText = true;
productSheet.getRange(`A${productStartRow}:O${productLastRow}`).format.rowHeightPx = 76;
productSheet.getRange(`B${productStartRow}:B${productLastRow}`).dataValidation = {
  rule: { type: "list", values: ["✅ 属于我", "❌ 不属于我", "❓ 待确认"] },
};
productSheet.getRange(`I${productStartRow}:I${productLastRow}`).dataValidation = {
  rule: { type: "list", values: ["主责", "配合", "不属于我"] },
};
productSheet.getRange(`J${productStartRow}:J${productLastRow}`).dataValidation = {
  rule: { type: "list", values: ["P0", "P1", "P2"] },
};
productSheet.getRange(`K${productStartRow}:K${productLastRow}`).dataValidation = {
  rule: { type: "list", values: ["D1-D5", "D6-D10", "D11-D14", "D6-D14", "持续"] },
};
productSheet.getRange(`M${productStartRow}:M${productLastRow}`).dataValidation = {
  rule: { type: "list", values: ["未开始", "进行中", "已完成", "已阻塞", "不适用"] },
};
const productBody = productSheet.getRange(`A${productStartRow}:O${productLastRow}`);
productBody.conditionalFormats.addCustom(`=$B${productStartRow}=\"❌ 不属于我\"`, {
  fill: palette.lightGray,
  font: { color: "#9CA3AF", italic: true },
});
productBody.conditionalFormats.addCustom(`=$B${productStartRow}=\"❓ 待确认\"`, {
  fill: palette.lightAmber,
  font: { color: "#7C4A03" },
});
productSheet.getRange(`J${productStartRow}:J${productLastRow}`).conditionalFormats.add("containsText", {
  text: "P0",
  format: { fill: palette.lightRed, font: { bold: true, color: palette.red } },
});
productSheet.getRange(`M${productStartRow}:M${productLastRow}`).conditionalFormats.add("containsText", {
  text: "已完成",
  format: { fill: palette.lightGreen, font: { bold: true, color: palette.green } },
});
productSheet.getRange(`C${productStartRow}:C${productLastRow}`).conditionalFormats.add("containsText", {
  text: "Electron",
  format: { fill: palette.lightBlue, font: { bold: true, color: palette.blue } },
});
productSheet.getRange(`C${productStartRow}:C${productLastRow}`).conditionalFormats.add("containsText", {
  text: "PC端",
  format: { fill: palette.lightGreen, font: { bold: true, color: palette.green } },
});
productSheet.getRange(`C${productStartRow}:C${productLastRow}`).conditionalFormats.add("containsText", {
  text: "共享接口",
  format: { fill: palette.lightAmber, font: { bold: true, color: palette.amber } },
});
productSheet.freezePanes.freezeRows(6);
productSheet.freezePanes.freezeColumns(2);
setColumnWidths(productSheet, productLastRow, {
  A: 54, B: 110, C: 112, D: 150, E: 200, F: 360, G: 330, H: 300,
  I: 72, J: 62, K: 82, L: 170, M: 90, N: 190, O: 180,
});

titleBand(
  taskSheet,
  "A1:M1",
  "佳伟个人任务确认清单｜Electron桌面端 + 当前项目PC端",
  "A2:M2",
  "使用方法：在“归属确认”列选择 ✅属于我 / ❌不属于我 / ❓待确认；选择❌后整行自动变灰。再用筛选器只查看自己的任务。"
);

const taskStartRow = 7;
const taskLastRow = taskStartRow + tasks.length - 1;
const cards = [
  ["A3:B3", "A4:B4", "候选任务总数", `=COUNTA($A$${taskStartRow}:$A$${taskLastRow})`, palette.blue],
  ["C3:D3", "C4:D4", "✅ 属于我", `=COUNTIF($E$${taskStartRow}:$E$${taskLastRow},\"✅ 属于我\")`, palette.green],
  ["E3:F3", "E4:F4", "❌ 不属于我", `=COUNTIF($E$${taskStartRow}:$E$${taskLastRow},\"❌ 不属于我\")`, palette.red],
  ["G3:H3", "G4:H4", "❓ 待确认", `=COUNTIF($E$${taskStartRow}:$E$${taskLastRow},\"❓ 待确认\")`, palette.amber],
  ["I3:J3", "I4:J4", "已完成", `=COUNTIF($L$${taskStartRow}:$L$${taskLastRow},\"已完成\")`, palette.teal],
  ["K3:M3", "K4:M4", "我的主责任务", `=COUNTIFS($E$${taskStartRow}:$E$${taskLastRow},\"✅ 属于我\",$D$${taskStartRow}:$D$${taskLastRow},\"主责\")`, palette.navy],
];
for (const [labelRange, valueRange, label, formula, color] of cards) {
  taskSheet.getRange(labelRange).merge();
  taskSheet.getRange(labelRange).values = [[label]];
  taskSheet.getRange(labelRange).format = {
    fill: "#F8FAFC",
    font: { bold: true, color },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: palette.border },
  };
  taskSheet.getRange(valueRange).merge();
  taskSheet.getRange(valueRange.split(":")[0]).formulas = [[formula]];
  taskSheet.getRange(valueRange).format = {
    fill: palette.white,
    font: { bold: true, color, size: 18 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { preset: "outside", style: "thin", color: palette.border },
  };
}

const taskHeaders = [["序号", "系统归属", "模块", "建议角色", "归属确认", "优先级", "阶段", "任务事项", "协作/依赖", "交付物", "验收口径", "进度状态", "备注"]];
taskSheet.getRange("A6:M6").values = taskHeaders;
const taskRows = tasks.map((r, i) => [i + 1, r[0], r[1], r[3], r[4], r[5], r[6], r[2], r[7], r[8], r[9], r[10], r[11]]);
taskSheet.getRange(`A${taskStartRow}:M${taskLastRow}`).values = taskRows;
const taskTable = taskSheet.tables.add(`A6:M${taskLastRow}`, true, "JiaweiTasksTable");
taskTable.style = "TableStyleMedium2";
taskTable.showFilterButton = true;
taskTable.showBandedRows = true;

taskSheet.getRange(`A6:M${taskLastRow}`).format = {
  font: { color: palette.text, size: 10 },
  verticalAlignment: "center",
};
taskSheet.getRange(`A6:M6`).format = {
  fill: palette.navy,
  font: { bold: true, color: palette.white, size: 10 },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
};
taskSheet.getRange(`A${taskStartRow}:G${taskLastRow}`).format.horizontalAlignment = "center";
taskSheet.getRange(`H${taskStartRow}:M${taskLastRow}`).format.wrapText = true;
taskSheet.getRange(`A${taskStartRow}:M${taskLastRow}`).format.rowHeightPx = 42;
taskSheet.getRange(`E${taskStartRow}:E${taskLastRow}`).dataValidation = {
  rule: { type: "list", values: ["✅ 属于我", "❌ 不属于我", "❓ 待确认"] },
};
taskSheet.getRange(`D${taskStartRow}:D${taskLastRow}`).dataValidation = {
  rule: { type: "list", values: ["主责", "配合", "不属于我"] },
};
taskSheet.getRange(`F${taskStartRow}:F${taskLastRow}`).dataValidation = {
  rule: { type: "list", values: ["P0", "P1", "P2"] },
};
taskSheet.getRange(`G${taskStartRow}:G${taskLastRow}`).dataValidation = {
  rule: { type: "list", values: ["D1-D5", "D6-D10", "D11-D14", "持续"] },
};
taskSheet.getRange(`L${taskStartRow}:L${taskLastRow}`).dataValidation = {
  rule: { type: "list", values: ["未开始", "进行中", "已完成", "已阻塞", "不适用"] },
};
const taskBody = taskSheet.getRange(`A${taskStartRow}:M${taskLastRow}`);
taskBody.conditionalFormats.addCustom(`=$E${taskStartRow}=\"❌ 不属于我\"`, {
  fill: palette.lightGray,
  font: { color: "#9CA3AF", italic: true },
});
taskBody.conditionalFormats.addCustom(`=$E${taskStartRow}=\"❓ 待确认\"`, {
  fill: palette.lightAmber,
  font: { color: "#7C4A03" },
});
taskSheet.getRange(`F${taskStartRow}:F${taskLastRow}`).conditionalFormats.add("containsText", {
  text: "P0",
  format: { fill: palette.lightRed, font: { bold: true, color: palette.red } },
});
taskSheet.getRange(`L${taskStartRow}:L${taskLastRow}`).conditionalFormats.add("containsText", {
  text: "已完成",
  format: { fill: palette.lightGreen, font: { bold: true, color: palette.green } },
});
taskSheet.freezePanes.freezeRows(6);
taskSheet.freezePanes.freezeColumns(1);
setColumnWidths(taskSheet, taskLastRow, {
  A: 54, B: 112, C: 100, D: 72, E: 104, F: 62, G: 82,
  H: 300, I: 160, J: 180, K: 260, L: 88, M: 190,
});

titleBand(
  boundarySheet,
  "A1:E1",
  "明确不属于佳伟决定的职责边界",
  "A2:E2",
  "佳伟负责把规则、权限和互锁落实到软件中，但不替代嵌入式、研发、QA、工艺、维修和仓库作业务决定。"
);
boundarySheet.getRange("A4:E4").values = [["类别", "不属于佳伟的决定或交付", "责任方", "佳伟负责什么", "不能做什么"]];
boundarySheet.getRange(`A5:E${4 + boundaries.length}`).values = boundaries;
const boundaryTable = boundarySheet.tables.add(`A4:E${4 + boundaries.length}`, true, "ResponsibilityBoundariesTable");
boundaryTable.style = "TableStyleMedium9";
boundarySheet.getRange(`A4:E${4 + boundaries.length}`).format = {
  verticalAlignment: "center",
  wrapText: true,
  font: { color: palette.text, size: 10 },
};
boundarySheet.getRange("A4:E4").format = {
  fill: palette.red,
  font: { bold: true, color: palette.white },
  horizontalAlignment: "center",
};
boundarySheet.getRange(`A5:E${4 + boundaries.length}`).format.rowHeightPx = 54;
boundarySheet.freezePanes.freezeRows(4);
setColumnWidths(boundarySheet, 4 + boundaries.length, { A: 100, B: 300, C: 120, D: 340, E: 300 });

titleBand(
  splitSheet,
  "A1:E1",
  "系统分工速查｜谁产生什么状态、谁负责什么功能",
  "A2:E2",
  "核心原则：Electron只产生EOL检测结论；PC端负责QA正式放行和仓库出库资格。"
);
splitSheet.getRange("A4:E4").values = [["状态轴", "状态示例", "产生系统", "Electron桌面端", "当前项目PC端"]];
splitSheet.getRange(`A5:E${4 + statusAxes.length}`).values = statusAxes;
const statusTable = splitSheet.tables.add(`A4:E${4 + statusAxes.length}`, true, "StatusAxesTable");
statusTable.style = "TableStyleMedium4";
const matrixHeaderRow = 10;
splitSheet.getRange(`A${matrixHeaderRow}:D${matrixHeaderRow}`).values = [["功能", "Electron桌面端", "当前项目PC端", "边界说明"]];
splitSheet.getRange(`A${matrixHeaderRow + 1}:D${matrixHeaderRow + systemMatrix.length}`).values = systemMatrix;
const matrixTable = splitSheet.tables.add(`A${matrixHeaderRow}:D${matrixHeaderRow + systemMatrix.length}`, true, "SystemSplitTable");
matrixTable.style = "TableStyleMedium2";
splitSheet.getRange(`A4:E${matrixHeaderRow + systemMatrix.length}`).format = {
  verticalAlignment: "center",
  wrapText: true,
  font: { color: palette.text, size: 10 },
};
splitSheet.getRange("A4:E4").format = { fill: palette.teal, font: { bold: true, color: palette.white }, horizontalAlignment: "center" };
splitSheet.getRange(`A${matrixHeaderRow}:D${matrixHeaderRow}`).format = { fill: palette.navy, font: { bold: true, color: palette.white }, horizontalAlignment: "center" };
splitSheet.getRange(`A5:E${4 + statusAxes.length}`).format.rowHeightPx = 52;
splitSheet.getRange(`A${matrixHeaderRow + 1}:D${matrixHeaderRow + systemMatrix.length}`).format.rowHeightPx = 42;
splitSheet.freezePanes.freezeRows(4);
setColumnWidths(splitSheet, matrixHeaderRow + systemMatrix.length, { A: 170, B: 270, C: 190, D: 270, E: 250 });

titleBand(
  acceptanceSheet,
  "A1:D1",
  "项目验收红线与系统责任",
  "A2:D2",
  "这些指标是系统验收门禁，不代表佳伟可以自行决定质量标准；质量标准仍由研发/QA批准。"
);
acceptanceSheet.getRange("A4:D4").values = [["验收指标", "目标", "Electron桌面端责任", "当前项目PC端责任"]];
acceptanceSheet.getRange(`A5:D${4 + redLines.length}`).values = redLines;
const redLineTable = acceptanceSheet.tables.add(`A4:D${4 + redLines.length}`, true, "AcceptanceRedLinesTable");
redLineTable.style = "TableStyleMedium3";
acceptanceSheet.getRange(`A4:D${4 + redLines.length}`).format = {
  verticalAlignment: "center",
  wrapText: true,
  font: { color: palette.text, size: 10 },
};
acceptanceSheet.getRange("A4:D4").format = { fill: palette.red, font: { bold: true, color: palette.white }, horizontalAlignment: "center" };
acceptanceSheet.getRange(`A5:D${4 + redLines.length}`).format.rowHeightPx = 42;
acceptanceSheet.getRange(`B5:B${4 + redLines.length}`).format = { fill: palette.lightRed, font: { bold: true, color: palette.red }, horizontalAlignment: "center" };
acceptanceSheet.freezePanes.freezeRows(4);
setColumnWidths(acceptanceSheet, 4 + redLines.length, { A: 300, B: 100, C: 230, D: 250 });

await fs.mkdir(outputDir, { recursive: true });

const previews = [
  [productSheet, "preview-product.png", `A1:O${Math.min(productLastRow, 17)}`],
  [taskSheet, "preview-tasks.png", `A1:M${Math.min(taskLastRow, 22)}`],
  [boundarySheet, "preview-boundaries.png", `A1:E${4 + boundaries.length}`],
  [splitSheet, "preview-split.png", `A1:E${matrixHeaderRow + systemMatrix.length}`],
  [acceptanceSheet, "preview-acceptance.png", `A1:D${4 + redLines.length}`],
];
for (const [sheet, fileName, range] of previews) {
  const preview = await workbook.render({ sheetName: sheet.name, range, scale: 1.2, format: "png" });
  await fs.writeFile(`${outputDir}/${fileName}`, new Uint8Array(await preview.arrayBuffer()));
}

const inspectTasks = await workbook.inspect({
  kind: "table",
  range: `产品版任务清单!A1:O14`,
  include: "values,formulas",
  tableMaxRows: 14,
  tableMaxCols: 15,
  maxChars: 10000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  productTaskCount: productTasks.length,
  taskCount: tasks.length,
  sheets: [productSheet.name, taskSheet.name, boundarySheet.name, splitSheet.name, acceptanceSheet.name],
  inspect: inspectTasks.ndjson,
  formulaErrors: formulaErrors.ndjson,
}, null, 2));
