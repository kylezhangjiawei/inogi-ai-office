import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const detailSource = await readFile(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
const collabDetailSource = await readFile(new URL("../src/app/UsCollabTaskDetailPage.tsx", import.meta.url), "utf8");
const managementSource = await readFile(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const conversationSource = await readFile(new URL("../src/app/RDTaskConversation.tsx", import.meta.url), "utf8");
const progressEvidenceSource = await readFile(new URL("../src/app/RDProgressEvidence.tsx", import.meta.url), "utf8");
const auditTimelineSource = await readFile(new URL("../src/app/RDAuditTimeline.tsx", import.meta.url), "utf8");
const mobileCockpitSource = await readFile(new URL("../src/app/MobileRDCockpit.tsx", import.meta.url), "utf8");

test("研发任务详情使用宽版总览，关键指标集中在右侧任务信息", () => {
  assert.match(detailSource, /max-w-\[1440px\]/);
  assert.match(detailSource, /lg:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(detailSource, /t\("主题归属"\)/);
  assert.doesNotMatch(detailSource, /aria-label=\{t\("任务关键指标"\)\}/);
  assert.match(detailSource, /xl:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  const taskInfoIndex = detailSource.indexOf('{t("任务信息")}');
  const relationIndex = detailSource.indexOf("{/* 阻塞提示节 */}");
  assert.ok(taskInfoIndex >= 0 && relationIndex > taskInfoIndex, "missing right-side task information section");
  const taskInfoSource = detailSource.slice(taskInfoIndex, relationIndex);
  for (const label of ["完成进度", "风险状态", "优先级", "任务状态", "截止日期"]) {
    assert.match(taskInfoSource, new RegExp(`t\\(\\"${label}\\"\\)`), `${label} should stay in the right-side task information`);
  }
  assert.match(detailSource, /const topicLabel = topicPathParts\.at\(-1\)/);
  assert.match(detailSource, /const componentLabel = topicPathParts\.length > 1/);
});

test("研发任务详情不会用固定视口高度裁掉留痕列表", () => {
  assert.match(detailSource, /style=\{viewportHeight \? \{ minHeight: viewportHeight \} : undefined\}/);
  assert.doesNotMatch(detailSource, /style=\{viewportHeight \? \{ height: viewportHeight \} : undefined\}/);
});

test("任务筛选和卡片内留言展开时仍保留记录可视高度", () => {
  assert.match(detailSource, /lg:min-h-\[440px\]/);
  assert.match(conversationSource, /"flex min-h-0 min-w-0 flex-1 flex-col"/);
});

test("研发任务详情以纵向时间线展示进展留痕并保留原卡片能力", () => {
  assert.match(detailSource, /progressPresentation="timeline"/);
  assert.match(conversationSource, /function ProgressTimeline\(/);
  assert.match(conversationSource, /aria-label=\{t\("进展留痕时间线"\)\}/);
  assert.match(conversationSource, /grid-cols-\[64px_22px_minmax\(0,1fr\)\]/);
  assert.match(conversationSource, /style=\{\{ contentVisibility: "auto", containIntrinsicSize: "180px" \}\}/);
  assert.match(conversationSource, /presentation="timeline"/);
  assert.match(conversationSource, /t\(timeline \? "进度更新" : "留痕"\)/);
  assert.match(conversationSource, /<ProgressAttachmentGrid[\s\S]*imageDisplay="clipped-cards"/);
  assert.match(conversationSource, /commentsOpen \? \([\s\S]*<InlineNoteComments/);
});

test("采购动态作为页签紧跟在合并关系之后", () => {
  const relationTab = detailSource.indexOf('{ key: "relations"');
  const procurementTab = detailSource.indexOf('{ key: "procurement"');
  const procurementContent = detailSource.indexOf('<TabsContent value="procurement"');
  assert.ok(relationTab >= 0, "missing relations tab");
  assert.ok(procurementTab > relationTab, "procurement tab must follow relations");
  assert.ok(procurementContent > procurementTab, "procurement activity must render inside its tab content");
  assert.equal(
    detailSource.slice(0, relationTab).includes("<ProcurementActivitySection task={procTask} />"),
    false,
    "procurement activity must not remain above the tab strip",
  );
});

test("任务详情合成的进展记录也遵循当前操作者可见范围", () => {
  assert.match(detailSource, /filterAuditLogsForViewer\(\[\.\.\.auditLogs, \.\.\.orphanLogs\], user\)/);
  assert.match(collabDetailSource, /filterAuditLogsForViewer\(\[\.\.\.auditLogs, \.\.\.orphanLogs\], user\)/);
});

test("从成员页签打开任务时，进展留痕和操作记录沿用该成员范围", () => {
  assert.match(managementSource, /onSelectTask\(task, activityActor\)/);
  assert.match(managementSource, /params\.set\("activity_user_id", activityActor\.id\)/);
  assert.match(managementSource, /params\.set\("activity_user_name", activityActor\.name\)/);
  assert.match(detailSource, /activityGroupNotes = useMemo/);
  assert.match(detailSource, /filterAuditLogsByActor\(taskLogs, visibleActivityActor\)/);
  assert.match(collabDetailSource, /activityNotes = useMemo/);
  assert.match(collabDetailSource, /filterAuditLogsByActor\(allAuditLogs, activityActor\)/);
});

test("returning from a member-scoped task restores the selected cockpit member", () => {
  assert.match(detailSource, /const cockpitReturnPath = `\$\{cockpitPath\}\$\{location\.search\}`/);
  assert.match(collabDetailSource, /const cockpitReturnPath = `\$\{routePath\("page:us-collab-cockpit", "\/us-collab-cockpit"\)\}\$\{location\.search\}`/);
  assert.match(managementSource, /resolveActivityPersonTab\(personLoads, initialActivityActor\)/);
  assert.match(managementSource, /activityRestorePendingRef\.current = false/);
  assert.match(managementSource, /setActiveTab\(restoredTab\)/);
  assert.match(managementSource, /initialActivityActor=\{initialActivityActor\}/);
  assert.match(detailSource, /onClick=\{\(\) => navigate\(cockpitReturnPath\)\}/);
});

test("the all-tasks lane is labeled as admin view and keeps the unscoped detail rules", () => {
  assert.match(managementSource, /\{t\("管理员视角"\)\}/);
  // 成员页签改按身份主键索引后，activeMember 为空即「全部」视角，activityActor 仍为 undefined
  assert.match(managementSource, /const activeMember = activeTab === "all"\s*\? undefined/);
  assert.match(managementSource, /const activityActor = activeMember\s*\?\s*\{ id: activeMember\.user_id, name: activeMember\.name \}\s*: undefined;/);
  assert.match(managementSource, /const scopeLabel = activeTab === "all"\s*\? t\("管理员视角"\)/);
});

test("merged child tasks are visible filters for progress notes and audit records", () => {
  assert.match(detailSource, /function ActivityTaskFilterBar\(/);
  assert.match(detailSource, /relatedTasks\.map\(\(item\) => \(/);
  assert.match(detailSource, /value=\{noteTaskFilter\}[\s\S]*onChange=\{changeNoteTaskFilter\}/);
  assert.match(detailSource, /value=\{auditTaskFilter\}[\s\S]*onChange=\{setAuditTaskFilter\}/);
  assert.match(detailSource, /progressGroupTaskIds\.has\(log\.resource\.id\)/);
  assert.match(detailSource, /logs=\{filteredTimelineLogs\}/);
  assert.match(detailSource, /log\.resource\.id === auditTaskFilter/);
});

test("admin task details toggle actor filtering from person names or avatars and keep the horizontal task scrollbar", () => {
  assert.match(detailSource, /canSelectActivityActor = !activityActor && canReadAllAuditLogs\(user\?\.permissions\)/);
  assert.match(detailSource, /const \[selectedActivityActor, setSelectedActivityActor\] = useState<AuditActorIdentity \| null>\(null\)/);
  assert.match(detailSource, /setSelectedActivityActor\(\(current\) => detailActivityActorMatches\(actor, current\) \? null : actor\)/);
  assert.match(detailSource, /if \(canSelectActivityActor\) toggleActivityActor\(actor\)/);
  assert.match(detailSource, /selectedActor=\{canSelectActivityActor \? selectedActivityActor : null\}/);
  assert.match(detailSource, /onActorClick=\{canSelectActivityActor \? toggleActivityActor : undefined\}/);
  assert.match(conversationSource, /onClick=\{\(\) => onActorClick\(\{ id: note\.actor\.id, name: note\.actor\.name \}\)\}/);
  assert.match(auditTimelineSource, /onClick=\{\(\) => onActorClick\(\{ id: log\.actor\.id, name: log\.actor\.name \}\)\}/);
  assert.doesNotMatch(detailSource, /t\("全部人员"\)/);
  assert.doesNotMatch(detailSource, /t\("只看我"\)/);
  assert.match(detailSource, /overflow-x-auto overscroll-x-contain/);
  assert.match(detailSource, /\[scrollbar-gutter:stable\]/);
  assert.match(detailSource, /\[&::-webkit-scrollbar\]:h-1\.5/);
});

test("progress cards provide lazy inline comments with recursive replies and a three-item collapse", () => {
  assert.match(conversationSource, /const INLINE_COMMENT_PREVIEW_COUNT = 3/);
  assert.match(conversationSource, /flattened\.push\(\.\.\.flattenInlineCommentNodes\(node\.children, depth \+ 1, visited\)\)/);
  assert.match(conversationSource, /message\.reply_to_id \? nodes\.get\(message\.reply_to_id\) : undefined/);
  assert.match(conversationSource, /commentsOpen \? \([\s\S]*<InlineNoteComments/);
  assert.match(conversationSource, /fetchRdTaskDiscussion\(taskId, \{ type: "progress_note", id: noteId \}, \{ limit: 200 \}\)/);
  assert.match(conversationSource, /expanded \? comments : comments\.slice\(0, INLINE_COMMENT_PREVIEW_COUNT\)/);
  assert.match(conversationSource, /t\("展开其余 \{n\} 条留言"/);
  assert.match(conversationSource, /presentation="inline"/);
  assert.match(conversationSource, /reply_to_id: replyTarget\?\.id/);
  assert.doesNotMatch(detailSource, /submitComposerNote/);
  assert.doesNotMatch(detailSource, /写一条进展…/);
  assert.doesNotMatch(conversationSource, /progressComposer/);
  assert.doesNotMatch(mobileCockpitSource, /记录新进展，@ 提及成员…/);
});

test("inline comment images use a three-thumbnail strip backed by the full navigable gallery", () => {
  assert.match(conversationSource, /imageDisplay="thumbnails"/);
  assert.match(conversationSource, /maxVisibleImages=\{3\}/);
  assert.match(progressEvidenceSource, /const visibleImages = images\.slice\(0, normalizedImageLimit\)/);
  assert.match(progressEvidenceSource, /hiddenImageCount: Math\.max\(0, images\.length - visibleImages\.length\)/);
  assert.match(progressEvidenceSource, /showsHiddenCount \? \(/);
  assert.match(progressEvidenceSource, /attachmentsToGalleryImages\(attachments\)/);
  assert.match(progressEvidenceSource, /event\.key === "ArrowLeft"/);
  assert.match(progressEvidenceSource, /event\.key === "ArrowRight"/);
});

test("task detail images use width-clipped cards while preview keeps the complete gallery", () => {
  assert.match(conversationSource, /imageDisplay="clipped-cards"/);
  assert.match(detailSource, /imageDisplay="clipped-cards"/);
  assert.match(collabDetailSource, /imageDisplay="clipped-cards"/);
  assert.match(progressEvidenceSource, /"cards" \| "thumbnails" \| "clipped-cards"/);
  assert.match(progressEvidenceSource, /new ResizeObserver\(updateVisibleCardCount\)/);
  assert.match(progressEvidenceSource, /const visibleImages = images\.slice\(0, visibleCardCount\)/);
  assert.match(progressEvidenceSource, /\.\.\.attachments\.filter\(\(attachment\) => !\(attachment\.mime \?\? ""\)\.startsWith\("image\/"\)\)/);
  assert.match(progressEvidenceSource, /attachmentsToGalleryImages\(attachments\)/);
  assert.match(progressEvidenceSource, /onIndexChange=\{\(next\) => setGalleryPreview/);
});
