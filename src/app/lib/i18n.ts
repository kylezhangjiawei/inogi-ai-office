/**
 * i18n 基建（P0）——轻量自研，不引第三方框架。
 *
 * 设计（docs/i18n-双语方案.md 定稿）：
 * - 「中文即 key」：t("批量转派") 在英文态查服务端字典 { 中文原文: 英文 }，
 *   缺 key 回退中文原文，永不白屏；中文态零查找直接返回。
 * - 字典存 systemSetting KV（i18n.dict.en），启动拉一次缓存；翻译管理页改完刷新即生效，不需发版。
 * - 语言偏好按用户存服务端（美国成员设英文后全模块英文，中方同页面看中文），
 *   localStorage 兜底缓存避免登录后闪中文。
 * - 模板插值：t("移交任务给 {name}", { name }) —— 字典里英文同样写 "Hand over to {name}"。
 */
import { useSyncExternalStore } from "react";
import { authFetch } from "./authSession";

export type I18nLang = "zh" | "en";

const LANG_CACHE_KEY = "inogi-lang";

let currentLang: I18nLang = (() => {
  try {
    const cached = localStorage.getItem(LANG_CACHE_KEY);
    return cached === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
})();

/**
 * 发布关键路径的内置英文兜底。线上字典仍拥有最高优先级；这里仅防止新页面文案在
 * 字典 seed 尚未同步或请求暂时失败时回退成中文，保证中美协同核心导航和操作可用。
 */
const BUILTIN_EN_FALLBACKS: Record<string, string> = {
  "协同任务详情": "Collaboration Task Details",
  "待指派": "Unassigned",
  "未指派": "Unassigned",
  "任务小结": "Task Brief",
  "（AI 未配置，基础事实版）": " (Basic summary — AI not configured)",
  "刷新": "Refresh",
  "搜索任务": "Search tasks",
  "搜索任务、编号、负责人、路径": "Search task, ID, owner, or category",
  "搜索任务全部内容": "Search all task content",
  "搜索任务全部内容（描述、人员、进度、工作项等）": "Search all task content (description, people, progress, work items, etc.)",
  "清空搜索": "Clear search",
  "管理员视角": "Admin View",
  "任务范围": "Task Scope",
  "筛选中": "Filtering",
  "再次点击恢复全部人员": "Click again to show everyone",
  "只看此人的留痕与操作记录": "Show only this person's progress and activity",
  "留言": "Comments",
  "留痕留言": "Progress comments",
  "正在加载留言": "Loading comments",
  "留言加载失败": "Failed to load comments",
  "还没有留言，来写第一条吧": "No comments yet. Start the conversation.",
  "收起留言": "Collapse comments",
  "展开其余 {n} 条留言": "Show {n} more comments",
  "加载更早留言": "Load earlier comments",
  "写下留言…": "Write a comment…",
  "支持 @ 成员、附件和逐层回复": "Supports @mentions, attachments, and nested replies",
  "当前账号可查看留言，但没有发送权限。": "You can view comments, but you don't have permission to post.",
  "协助": "Assisting",
  "{name} 以协作人身份参与此任务": "{name} is participating in this task as a collaborator",
  "上传知识库文件": "Upload Knowledge Base Files",
  "选择或拖拽知识库文件": "Choose or drag knowledge base files",
  "选择知识库文件": "Choose knowledge base files",
  "知识库分类": "Knowledge Base Category",
  "访问权限分值": "Access Level",
  "关闭上传弹窗": "Close upload dialog",
  "删除任务？": "Delete task?",
  "确认删除「{title}」？该操作不可恢复": "Delete “{title}”? This action cannot be undone",
  "，且会一并删除其 {n} 个子任务": ", including its {n} subtasks",
  "确认删除": "Delete",
  "任务已删除": "Task deleted",
  "已选文件（{n}）": "Selected Files ({n})",
  "没有符合条件的条目": "No matching items",
  "知识库暂无内容": "The knowledge base is empty",
  "尝试修改搜索词或筛选条件": "Try changing your search or filters",
  "上传第一个文件开始构建知识库": "Upload the first file to start building the knowledge base",
  // 协同三配置页（2026-07-15）：导航与页头级兜底，完整词条在 seed-i18n-en.mjs
  "协同审批流配置": "Collab Approval Flow",
  "协同操作留痕": "Collab Activity Audit",
  "协同 AI 策略": "Collab AI Policy",
  "审计查询台 · 追责、复盘、抽查、异常定位": "Audit console · Accountability, review, spot checks, incident tracing",
  "配置「立项 / 任务封存 / 转派」等流程的审核节点 · 池成员由「角色权限」页分配": "Configure review nodes for kickoff / archive / reassign flows · Pool members are assigned on the Role Permissions page",
  // 员工入职归档：列表、导入校验与 CRUD 关键路径兜底
  "花名册人员": "Roster Employees",
  "{count} 人已完成": "{count} completed",
  "已完成归档": "Archived",
  "字段与材料均已核对": "Fields and documents verified",
  "待处理归档": "Archives Requiring Action",
  "缺项 / 复核 / 入职中": "Missing / Review / Onboarding",
  "字段缺口": "Missing Required Fields",
  "来自 {count} 个必备字段": "Across {count} required fields",
  "花名册列表": "Employee Roster",
  "共 {count} 条记录，点击详情再展开字段与材料。": "{count} records. Open details to review fields and documents.",
  "搜索花名册": "Search roster",
  "搜索姓名、工号、部门、岗位...": "Search name, employee ID, department, or position...",
  "显示列": "Columns",
  "选择列表显示项": "Choose visible columns",
  "恢复默认": "Reset",
  "设置会保存在当前浏览器。": "Settings are saved in this browser.",
  "员工": "Employee",
  "组织": "Organization",
  "岗位": "Position",
  "入职 / 转正": "Hire / Regularization",
  "归档": "Archive",
  "缺项": "Missing",
  "操作": "Actions",
  "全部状态": "All Statuses",
  "已完成": "Completed",
  "待复核": "Pending Review",
  "入职中": "Onboarding",
  "归档完成": "Archive Complete",
  "缺项待补": "Missing Fields",
  "暂无匹配的花名册记录": "No matching roster records",
  "序号 {number}": "Roster No. {number}",
  "在职": "Active",
  "转正提醒": "Regularization Reminder",
  "预计转正": "Expected Regularization",
  "最后一个月提醒": "Final-month reminders",
  "本月生日": "Birthdays This Month",
  "{month} 月生日人员": "Birthdays in month {month}",
  "生日 / 星座": "Birthday / Zodiac Sign",
  "今天生日": "Birthday Today",
  "{month}月{day}日": "{month}/{day}",
  "已转正": "Regularized",
  "转正日期": "Regularization Date",
  "转正": "Regularize",
  "转正待确认": "Regularization Pending Confirmation",
  "日期待补充": "Date Pending",
  "将 {name} 转为正式员工": "Regularize {name}",
  "确认员工转正": "Confirm Employee Regularization",
  "确认后将更新员工状态，并保存实际转正日期。": "This updates the employee status and saves the actual regularization date.",
  "工号待补充": "Employee ID Pending",
  "部门待补充": "Department Pending",
  "岗位待补充": "Position Pending",
  "实际转正日期": "Actual Regularization Date",
  "预计转正日期": "Expected Regularization Date",
  "本次为提前转正，比预计日期提前 {days} 天。请确认日期与审批结果一致。": "This is an early regularization, {days} days before the expected date. Confirm that the date matches the approval.",
  "系统将记录本次操作人员和转正日期。": "The system will record the operator and regularization date.",
  "转正日期须介于入职日期和今天之间。": "The regularization date must be between the hire date and today.",
  "转正处理中": "Regularizing",
  "确认转正": "Confirm Regularization",
  "{name} 已于 {date} 转正": "{name} was regularized on {date}",
  "转正失败：{message}": "Regularization failed: {message}",
  "转正失败，请稍后重试": "Regularization failed. Please try again later.",
  "缺少出生日期": "Birth Date Missing",
  "无缺项": "No Missing Fields",
  "编辑 {name}": "Edit {name}",
  "删除 {name}": "Delete {name}",
  "查看 {name} 详情": "View {name} details",
  "共 {count} 条记录": "{count} records",
  "每页 {count} 条": "{count} per page",
  "第 {page}/{total} 页": "Page {page} of {total}",
  "上一页": "Previous",
  "下一页": "Next",
  "末页": "Last",
  "新增人员": "Add Employee",
  "导入花名册": "Import Roster",
  "导出人员名单": "Export Employee List",
  "已识别花名册表头，但未发现员工数据，请从表头下一行开始填写": "The roster header was found, but there are no employee rows. Start entering employees on the row below the header.",
  "未识别到花名册表头，请检查是否包含「姓名 / 证件号码」": "The roster header was not found. Make sure it includes Name / ID Number.",
  "编辑人员信息": "Edit Employee",
  "建立人员主档，保存后同步到服务端": "Create an employee profile and sync it to the server after saving.",
  "{name} · {number}，保存后同步更新服务端档案": "{name} · {number}. Saving updates the server archive.",
  "关闭编辑": "Close Editor",
  "必填规则已按当前花名册确认": "Required fields match the confirmed roster rules.",
  "红色 * 为归档必备；结算日期不归档，社保号、社保首月日期为选填。司龄、出生月日、生肖、星座、年龄由系统自动计算。": "Red * marks required archive fields. Settlement date is excluded; Social Security No. and first contribution month are optional. Company tenure, birthday, Chinese zodiac, zodiac sign, and age are calculated automatically.",
  "组织与入职": "Organization & Onboarding",
  "员工编号、所属组织和任职信息": "Employee numbers, organization, and position information.",
  "身份与学历": "Identity & Education",
  "身份证修改后会自动刷新出生信息、生肖、性别和年龄": "Updating the ID number refreshes birth information, zodiac, gender, and age.",
  "地址与联系人": "Address & Contacts",
  "新号码保存后仅保留脱敏结果": "New numbers are masked immediately after saving.",
  "银行与社保": "Banking & Social Security",
  "敏感号码只用于本次更新并在服务端即时脱敏": "Sensitive numbers are used only for this update and masked immediately on the server.",
  "序号": "Roster No.",
  "隶属": "Company",
  "入职日期": "Hire Date",
  "结算日期": "Settlement Date",
  "状态": "Status",
  "例如：在职、试用期": "For example: Active or Probation",
  "工作地": "Work Location",
  "部门": "Department",
  "职务": "Position",
  "工号": "Employee ID",
  "星座": "Zodiac Sign",
  "水瓶座": "Aquarius",
  "双鱼座": "Pisces",
  "白羊座": "Aries",
  "金牛座": "Taurus",
  "双子座": "Gemini",
  "巨蟹座": "Cancer",
  "狮子座": "Leo",
  "处女座": "Virgo",
  "天秤座": "Libra",
  "天蝎座": "Scorpio",
  "射手座": "Sagittarius",
  "摩羯座": "Capricorn",
  "费用归属（内部选填）": "Cost Center (Internal, Optional)",
  "姓名": "Name",
  "新身份证号码": "New ID Number",
  "不修改请留空": "Leave blank to keep unchanged",
  "出生日期（无身份证时填写）": "Date of Birth (if no ID number)",
  "性别（无身份证时填写）": "Gender (if no ID number)",
  "男": "Male",
  "女": "Female",
  "民族": "Ethnicity",
  "婚姻状况": "Marital Status",
  "未婚": "Single",
  "已婚": "Married",
  "离异": "Divorced",
  "丧偶": "Widowed",
  "学历": "Education",
  "毕业院校": "School",
  "专业": "Major",
  "新手机号码": "New Mobile Number",
  "籍贯": "Hometown",
  "户籍地址": "Registered Address",
  "常住地址": "Current Address",
  "紧急联系人姓名": "Emergency Contact",
  "紧急联系人关系": "Relationship",
  "紧急联系人新手机": "New Emergency Contact Phone",
  "备注（内部选填）": "Notes (Internal, Optional)",
  "新银行帐号": "New Bank Account",
  "工资卡开户行全称": "Payroll Bank Branch",
  "新社保号（选填）": "New Social Security No. (Optional)",
  "社保首月日期（选填）": "First Social Security Month (Optional)",
  "请选择": "Select",
  "当前：{value}；留空则不修改": "Current: {value}; leave blank to keep unchanged.",
  "清除当前": "Clear Current Value",
  "材料记录": "Document Records",
  "维护材料名称、核对状态、说明和更新时间": "Maintain document names, review status, notes, and update dates.",
  "添加材料": "Add Document",
  "暂无材料记录，可点击“添加材料”补充": "No document records. Select “Add Document” to add one.",
  "材料名称": "Document Name",
  "字段来源": "Field Source",
  "已归档": "Archived",
  "待补充": "Missing",
  "更新日期": "Updated Date",
  "删除材料": "Delete Document",
  "核对说明": "Review Notes",
  "保存后将重新计算归档完整度和缺失字段": "Saving recalculates archive completeness and missing fields.",
  "取消": "Cancel",
  "保存中": "Saving",
  "新增并保存": "Add & Save",
  "保存修改": "Save Changes",
  "删除人员档案": "Delete Employee Archive",
  "确认删除 {name}（{number}）吗？人员信息、材料记录和胸牌配置会一并删除。": "Delete {name} ({number})? Employee data, document records, and badge configuration will all be removed.",
  "删除中": "Deleting",
  "司龄": "Company Tenure",
  "不足1个月": "Less than 1 month",
  "待入职": "Pending Hire",
  "{count}个月": "{count} months",
  "{count}年": "{count} years",
  "{years}年{months}个月": "{years} years {months} months",
  "出生月日": "Birthday",
  "生肖": "Zodiac",
  "年龄": "Age",
  "{age}岁": "Age {age}",
  // 员工入职归档：详情页、字段映射与胸牌子页面兜底
  "{name}默认头像": "{name} default avatar",
  "{name}胸牌模板": "{name} badge template",
  "{name}头像": "{name} avatar",
  "拉伸头像宽高": "Resize avatar",
  "头像图片": "Avatar Image",
  "胸牌头像": "Badge Avatar",
  "未上传": "Not Uploaded",
  "{name}头像预览": "{name} avatar preview",
  "首页": "Home",
  "删除人员": "Delete Employee",
  "编辑字段": "Edit Fields",
  "员工档案": "Employee Archive",
  "入职": "Hire Date",
  "结算": "Settlement",
  "已归档 {count}": "{count} Archived",
  "待复核 {count}": "{count} Pending Review",
  "待补 {count}": "{count} Missing",
  "材料": "Documents",
  "Excel 字段映射": "Excel Field Mapping",
  "{count} 列": "{count} Columns",
  "结算日期不归档；其余 30 个业务字段为必备，社保号与社保首月日期为选填；司龄及出生相关字段自动计算。": "Settlement date is excluded. The remaining 30 business fields are required; Social Security No. and first contribution month are optional. Company tenure and birth-related fields are calculated automatically.",
  "归档完成度": "Archive Completion",
  "无阻断": "No Blockers",
  "字段完整": "All Required Fields Complete",
  "预计 {date} 转正，距转正 {days} 天；已从 {reminderDate} 起进入提前一个月提醒期。": "Expected regularization on {date}, in {days} days. The one-month reminder period began on {reminderDate}.",
  "胸牌": "Employee Badge",
  "编辑胸牌": "Edit Badge",
  "胸牌定制": "Badge Customization",
  "关闭胸牌编辑": "Close Badge Editor",
  "重置当前模板坐标": "Reset Current Template Positions",
  "文本显示": "Visible Text",
  "控制当前模板导出的文字内容": "Choose which text appears in exports for this template.",
  "必填完成": "Required Fields Complete",
  "模板、定位、头像与员工信息": "Template, positioning, avatar, and employee information",
  "待补": "Missing",
  "无阻断项": "No Blocking Items",
  "需确认": "Needs Confirmation",
  "无提醒": "No Alerts",
  "从当前员工档案回填到模板。": "Populate the template from the current employee archive.",
  "证件号码": "ID Number",
  "出生日期": "Date of Birth",
  "性别": "Gender",
  "手机号码": "Mobile Number",
  "银行帐号": "Bank Account",
  "紧急联系人手机": "Emergency Contact Phone",
  "社保号": "Social Security No.",
  "社保首月日期": "First Social Security Month",
  "正式": "Official",
  "实习期": "Intern",
  "劳务": "Contractor",
  "位置待确认": "Position Pending",
  "位置已固定": "Position Confirmed",
  "拖动调整中": "Adjusting Position",
  "可打印": "Ready to Print",
  "待定位": "Position Pending",
  "导出中": "Exporting",
  "导出图片": "Export Image",
  "头像": "Avatar",
  "待确认": "Pending Confirmation",
  "缺失": "Missing",
  "工资卡信息缺失影响发薪": "Missing payroll bank information may delay salary payment.",
  "试用期转正提醒": "Regularization Reminder",
  "定位": "Positioning",
  "员工信息": "Employee Information",
  "保存胸牌配置": "Save Badge Configuration",
  "导出胸牌 PNG": "Export Badge PNG",
  "正在生成 PNG": "Generating PNG",
  "姓名和序号不能为空": "Name and roster number are required.",
  "{name} 已新增": "{name} was added.",
  "{name} 的人员信息已保存": "{name}'s employee information was saved.",
  "保存失败：{message}": "Save failed: {message}",
  "保存失败，请稍后重试": "Save failed. Try again later.",
  "人员档案已删除": "Employee archive deleted.",
  "删除失败：{message}": "Delete failed: {message}",
  "删除失败，请稍后重试": "Delete failed. Try again later.",
  "服务端保存失败，已暂存本机：{message}": "Server save failed; data was saved locally: {message}",
  "服务端保存失败，已暂存本机": "Server save failed; data was saved locally.",
  "已导入 {count} 名员工，按 {required} 个必备字段完成核对并保存到服务端": "Imported {count} employees, verified {required} required fields, and saved them to the server.",
  "已导入 {count} 名员工，按 {required} 个必备字段完成核对": "Imported {count} employees and verified {required} required fields.",
  "导入失败：{message}": "Import failed: {message}",
  "导入失败，请确认文件为 .xlsx 花名册": "Import failed. Confirm that the file is an .xlsx roster.",
  "当前筛选条件下暂无人员可导出": "No employees match the current filters for export.",
  "已导出 {count} 人的人员名单": "Exported an employee list with {count} records.",
  "导出失败，请重试": "Export failed. Try again.",
  "文本显示设置保存失败": "Failed to save text visibility settings.",
  "{name}模板位置已重置": "{name} template positions were reset.",
  "{name}模板位置已固定": "{name} template positions were confirmed.",
  "拖动姓名、头像、部门、职位、编号到设计稿标注位置": "Drag the name, avatar, department, position, and ID to their marked design positions.",
  "请选择图片文件": "Choose an image file.",
  "头像读取失败": "Failed to read the avatar image.",
  "头像已载入，调整完成后请保存到服务端": "Avatar loaded. Save it to the server after making adjustments.",
  "胸牌配置和头像已保存到服务端": "Badge configuration and avatar were saved to the server.",
  "胸牌保存失败：{message}": "Badge save failed: {message}",
  "胸牌保存失败，请稍后重试": "Badge save failed. Try again later.",
  "胸牌 PNG 已导出（{width} × {height}）": "Badge PNG exported ({width} × {height}).",
  "胸牌图片导出失败，请重试": "Badge image export failed. Try again.",
  "本地草稿更新失败": "Failed to update the local draft.",
  "头像草稿已移除": "Avatar draft removed.",
  // 个人工作台子任务树 + 留痕时间精确到秒（2026-07-31）。
  // 协同池与研发池共用 RDMyWorkspacePage 及全部留痕组件，英文界面同样会命中这批文案。
  "(无标题)": "(Untitled)",
  "（选填）": "(optional)",
  "处理中…": "Working…",
  "刚刚": "Just now",
  "{n} 秒前": "{n}s ago",
  "时间：{time}": "Time: {time}",
  "（{time}）": "({time})",
  // 子任务关系
  "子任务（{n}）": "Subtasks ({n})",
  "含 {n} 子任务": "{n} subtasks",
  "本任务含 {n} 个子任务": "This task has {n} subtasks",
  "本任务是以下任务的子任务": "This task is a subtask of",
  "属于：{title}": "Under: {title}",
  "平均进度 {p}%": "Avg progress {p}%",
  "由 {name} 于 {time} 并入": "Merged in by {name} at {time}",
  "当前": "Current",
  "{n} 个下级": "{n} descendants",
  "含 {n} 个下级": "{n} descendants",
  "合并关系": "Merge hierarchy",
  "合并层级": "Merge hierarchy",
  "全部任务": "All tasks",
  "当前任务": "Current task",
  "合并前": "Before merge",
  "记录到": "Post to",
  "共 {notes} 条，来自 {tasks} 个任务": "{notes} updates from {tasks} tasks",
  "任务并入后会永久保留原有上下级结构。点击任意节点可跳转到对应任务详情。":
    "Merged tasks permanently retain their original hierarchy. Select any node to open its task details.",
  "暂无合并关系": "No merge hierarchy",
  "并入已有任务后，层级关系会显示在这里。": "The hierarchy will appear here after a task is merged in.",
  "新建项会直接归属当前任务；若要保留已有的多级任务结构，请使用「并入已有任务」。":
    "A new item is added directly under this task. To preserve an existing multi-level structure, use Merge existing task.",
  "并入后任务本体及其全部下级层级永久保留，仅整棵任务树的归属发生变化，可随时取消。跨产品库时，整棵任务树会一并迁入当前产品库。":
    "The task and its complete descendant hierarchy are preserved; only the whole tree's parent changes, and it can be detached later. Across product libraries, the full tree moves together.",
  // 并入为子任务
  "并入其他任务成为子任务": "Make this a subtask of another task",
  "确认后立即生效，无需审核": "Takes effect immediately — no review needed",
  "立即生效，无需审核": "Takes effect immediately — no review needed",
  "请选择要并入的目标任务": "Select the task to merge into",
  "并入说明": "Note",
  "简述为何把这个任务并入目标任务，会记入操作留痕": "Briefly note why this task is being merged in — it is recorded in the audit trail",
  "确认并入": "Merge in",
  "并入失败，请重试": "Merge failed. Please try again.",
  "已并入目标任务，成为其子任务": "Merged in as a subtask of the target task",
  "本任务「{title}」及其全部下级将整体并入所选任务。原有层级、主责人、进度、进展留痕与附件均保持不变，之后可随时取消关系并整体提升回独立任务。":
    "\"{title}\" and all of its descendants will move under the selected task as one tree. The existing hierarchy, owners, progress, notes and attachments remain unchanged, and the whole tree can be detached later.",
  "候选中不含已完成、已归档或已处于其他任务下的任务；已有下级任务不会被拍平。":
    "Completed, archived, and already nested tasks are excluded. Existing descendants will not be flattened.",
  "本任务「{title}」将成为所选任务的子任务。任务本体完整保留：标题、主责人、进度、进度留痕与附件都不变，只是在任务树中的位置改变。之后可随时取消关系提升回独立任务。":
    "\"{title}\" will become a subtask of the selected task. The task itself is fully preserved — title, owner, progress, progress notes and attachments are unchanged; only its position in the task tree moves. You can detach it back into a standalone task at any time.",
  // 取消子任务关系
  "取消子任务关系": "Detach from parent",
  "确认取消关系": "Detach",
  "将把「{title}」提升为独立的顶层任务，与原父任务同级。":
    "\"{title}\" will be promoted to a standalone top-level task, alongside its former parent.",
  "任务本体不受影响：标题/主责/进度/留痕/附件全部保留":
    "The task itself is unaffected — title, owner, progress, notes and attachments are all kept",
  "提升后落在原父任务所在的子项目里": "It lands in the sub-project that holds the former parent",
  "已取消子任务关系，该任务已提升为独立任务": "Detached — the task is now a standalone task",
  "取消子任务关系失败，请重试": "Failed to detach from parent. Please try again.",
  "批量取消": "Batch detach",
  "批量取消子任务关系": "Batch detach subtasks",
  "取消全选": "Clear selection",
  "全选": "Select all",
  "已取消 {n} 个子任务关系": "Detached {n} subtasks",
  "批量取消失败，请重试": "Batch detach failed. Please try again.",
  "取消后，所选任务会连同其全部下级任务一起提升为独立任务，不会删除任何留痕或附件。":
    "The selected tasks and their complete descendant trees will become standalone tasks. No notes or attachments are deleted.",
  // 任务驾驶舱 KPI：「活跃」改为「总任务」（2026-07-31）
  // 同排的另外几个标签此前也没有兜底，英文下会中英混排，一并补上。
  // 「完成」全站 9 处均为状态/统计标签（无操作按钮），统一译作 Completed 无歧义。
  "完成率": "Completion rate",
  "进行中": "In progress",
  "完成": "Completed",
  "阻塞/待派": "Blocked / Unassigned",
  "风险": "Risks",
  "总任务": "Total tasks",
  "{n} 个任务": "{n} tasks",
  "全部注册在案的任务，含已完成与已归档": "Every task on record, including completed and archived",
  "已完成 ÷ 未归档任务数（{n}）；分母不含已归档，故与「总任务」不同源":
    "Completed ÷ non-archived tasks ({n}). The denominator excludes archived tasks, so it differs from \"Total tasks\".",
  // 操作留痕的字段/取值标签（RDAuditTimeline 的 FIELD_LABELS / VALUE_LABELS 都过 t()）
  "父任务": "Parent task",
  "子任务来源": "Subtask origin",
  "由已有任务并入": "Merged in from an existing task",
  "在父任务下直建": "Created under the parent task",
  // 个人工作台：任务树节点级立项
  "节点立项": "Kick off under task",
  "当前节点立项": "Kick off under current task",
  "在当前节点下发起立项": "Start a kickoff under this task",
  "任务树最多支持 5 层": "Task trees support up to 5 levels",
  "本次创建的任务将作为当前节点的直接子任务，并自动继承其产品与分类。":
    "Tasks created in this kickoff become direct children of the current task and inherit its product and category.",
  "按项目文件夹查看": "Browse by project folder",
  "查看全部任务": "View all tasks",
  "返回项目文件夹": "Back to project folders",
  "风险任务": "At-risk tasks",
  "该项目下没有匹配的任务": "No matching tasks in this project",
  "个项目": "projects",
  "项目文件夹": "Project folder",
  "已完成任务": "Completed tasks",
  "有未读进展": "Unread progress updates",
  "整体进度": "Overall progress",
  "我的项目": "My projects",
  "先进入项目文件夹，再查看和处理分任务": "Open a project folder to view and work on its tasks",
  "项目任务": "Project tasks",
  "没有匹配的项目文件夹": "No matching project folders",
  "收起子任务": "Collapse subtasks",
  "展开子任务": "Expand subtasks",
  "上级：{title}": "Parent: {title}",
  "项目": "Projects",
  "全部": "All",
  "我主责": "Owned by me",
  "评论": "Comments",
  "查看评论": "View comments",
  "查看评论，有 {n} 条未读": "View comments, {n} unread",
  "最新进展：": "Latest progress: ",
  "下一步：": "Next step: ",
  "更新进度": "Update progress",
  "移动到其它系统 / 子项": "Move to another system / sub-project",
  // 个人工作台类目表 + 主管类目汇总（2026-08-06）
  "类目": "Category",
  "成员": "Member",
  "研发任务驾驶舱": "R&D Task Cockpit",
  "项": "items",
  "未绑定账号": "Account Not Linked",
  "类目任务表": "Category task table",
  "类目任务": "Category tasks",
  "按类目表查看": "Browse by category table",
  "没有匹配的类目": "No matching categories",
  "我的任务": "My tasks",
  "我的类目": "My categories",
  "每个类目一张表，跨产品库汇总本人全部任务": "One table per category, combining all of my tasks across product libraries",
  "个类目": "categories",
  "可横向滚动的类目任务表": "Horizontally scrollable category task table",
  "状态 / 审批": "Status / Approval",
  "完成评分": "Completion Score",
  "最近进展": "Latest Update",
  "协作审批": "Collaboration Approval",
  "完成审批": "Completion Approval",
  "延期审批": "Due Date Approval",
  "放弃审批": "Abandonment Approval",
  "无待审": "No Pending Approval",
  "暂无进展": "No Updates",
  "该类目下没有匹配的任务": "No matching tasks in this category",
};
let dict: Record<string, string> = {};
let dictLoaded = false;
let dictVersion = 0;
/** 快照对象：语言或字典变化时替换引用，驱动 useSyncExternalStore 重渲染 */
let snapshot = { lang: currentLang, dictVersion };
const listeners = new Set<() => void>();

function syncDocumentLanguage() {
  if (typeof document !== "undefined") {
    document.documentElement.lang = currentLang === "en" ? "en" : "zh-CN";
  }
}

function emit() {
  syncDocumentLanguage();
  snapshot = { lang: currentLang, dictVersion };
  for (const fn of listeners) fn();
}

syncDocumentLanguage();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 当前语言（非响应式；组件内请用 useI18n 保证切换即重渲染） */
export function currentI18nLang(): I18nLang {
  return currentLang;
}

/** 日期/时间格式化用的 locale（toLocaleDateString 等传参）：随界面语言切换 */
export function i18nLocale(): string {
  return currentLang === "en" ? "en-US" : "zh-CN";
}

/**
 * 翻译函数。zhText 是中文原文（即字典 key），vars 做 {name} 模板插值。
 * 英文态查字典，缺 key（含字典未加载完）回退中文。
 */
export function t(zhText: string, vars?: Record<string, string | number>): string {
  const template = currentLang === "en" ? (dict[zhText] ?? BUILTIN_EN_FALLBACKS[zhText] ?? zhText) : zhText;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** 响应式入口：组件里 const { lang, t } = useI18n()；切换语言自动重渲染 */
export function useI18n() {
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  return { lang: snap.lang, t };
}

async function loadDict(lang: I18nLang): Promise<void> {
  if (lang !== "en" || dictLoaded) return;
  try {
    const res = await authFetch(`/api/i18n/dict/en`);
    if (res.ok) {
      dict = (await res.json()) as Record<string, string>;
      dictLoaded = true;
      // 字典异步就绪必须广播：localStorage 缓存 en 时首屏在字典到位前已渲染（回退中文），
      // 没有数据加载的静态组件（如侧边栏）不会自行重渲染，会永远停在中文
      dictVersion += 1;
      emit();
    }
  } catch {
    // 字典拉取失败 → 全量回退中文，不影响使用
  }
}

/**
 * 登录后初始化：拉用户语言偏好 + （英文时）字典。
 * 失败时静默保持 localStorage 缓存的语言，不阻塞应用启动。
 */
export async function initI18n(): Promise<void> {
  try {
    const res = await authFetch(`/api/i18n/preference`);
    if (res.ok) {
      const { lang } = (await res.json()) as { lang?: string };
      const next: I18nLang = lang === "en" ? "en" : "zh";
      await loadDict(next);
      if (next !== currentLang) {
        currentLang = next;
        try {
          localStorage.setItem(LANG_CACHE_KEY, next);
        } catch { /* ignore */ }
        emit();
      }
    }
  } catch {
    // 离线/未登录：保持缓存语言
  }
  // localStorage 缓存了 en 但服务端偏好读取失败的场景：字典仍需可用
  await loadDict(currentLang);
}

/** 切换语言：本地立即生效（乐观），偏好异步写服务端 */
export async function setI18nLang(lang: I18nLang): Promise<void> {
  if (lang === currentLang) return;
  await loadDict(lang); // 先备好字典再切，避免闪中文
  currentLang = lang;
  try {
    localStorage.setItem(LANG_CACHE_KEY, lang);
  } catch { /* ignore */ }
  emit();
  void authFetch(`/api/i18n/preference`, {
    method: "PUT",
    body: JSON.stringify({ lang }),
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
}

/** 供翻译管理页/AI 初翻脚本刷新本地字典缓存（保存字典后调用） */
export async function reloadI18nDict(): Promise<void> {
  dictLoaded = false;
  await loadDict("en"); // 成功路径内部已 emit
}
