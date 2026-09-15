import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const gestureSource = await readFile(new URL("../src/app/lib/taskImageGesture.ts", import.meta.url), "utf8");
const gestureJavaScript = ts.transpileModule(gestureSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "taskImageGesture.ts",
}).outputText;
const gestureModuleUrl = `data:text/javascript;base64,${Buffer.from(gestureJavaScript).toString("base64")}`;
const {
  TASK_IMAGE_DOUBLE_TAP_SCALE,
  TASK_IMAGE_MAX_SCALE,
  TASK_IMAGE_MIN_SCALE,
  TASK_IMAGE_ZOOM_STEP,
  clampTaskImageTransform,
  distanceBetweenPointers,
  midpointBetweenPointers,
  pinchTaskImageTransform,
  zoomTaskImageTransform,
} = await import(gestureModuleUrl);

const detailSource = await readFile(new URL("../src/app/RDTaskDetailPage.tsx", import.meta.url), "utf8");
const collabDetailSource = await readFile(new URL("../src/app/UsCollabTaskDetailPage.tsx", import.meta.url), "utf8");
const managementSource = await readFile(new URL("../src/app/RDTaskManagementPage.tsx", import.meta.url), "utf8");
const conversationSource = await readFile(new URL("../src/app/RDTaskConversation.tsx", import.meta.url), "utf8");
const progressEvidenceSource = await readFile(new URL("../src/app/RDProgressEvidence.tsx", import.meta.url), "utf8");
const auditTimelineSource = await readFile(new URL("../src/app/RDAuditTimeline.tsx", import.meta.url), "utf8");
const mobileCockpitSource = await readFile(new URL("../src/app/MobileRDCockpit.tsx", import.meta.url), "utf8");
const mobileRoutingSource = await readFile(new URL("../src/app/lib/mobileRouting.ts", import.meta.url), "utf8");
const mobileRoutingJavaScript = ts.transpileModule(mobileRoutingSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "mobileRouting.ts",
}).outputText;
const mobileRoutingModuleUrl = `data:text/javascript;base64,${Buffer.from(mobileRoutingJavaScript).toString("base64")}`;
const { isMobileViewport } = await import(mobileRoutingModuleUrl);

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

test("任务描述支持有权限人员就地编辑并复用任务信息更新链路", () => {
  assert.match(detailSource, /canManage && !task\.archived && !editingDescription/);
  assert.match(detailSource, /aria-label=\{t\("编辑任务描述"\)\}/);
  assert.match(detailSource, /value=\{descriptionDraft\}/);
  assert.match(detailSource, /await handleEditInfo\(task\.title, descriptionDraft\)/);
  assert.match(detailSource, /event\.key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/);
  assert.match(detailSource, /event\.key === "Escape"/);
  assert.match(detailSource, /setEditingDescription\(false\);[\s\S]*setDescriptionDraft\(""\);[\s\S]*void loadProgressGroup\(\)/);
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
  assert.match(detailSource, /const procurementReturnPath = researchWorkspace \? procurementWorkspaceReturnPath\(location\.state\) : null/);
  assert.match(detailSource, /const detailReturnPath = procurementReturnPath \?\? cockpitReturnPath/);
  assert.match(detailSource, /onClick=\{\(\) => navigate\(detailReturnPath\)\}/);
});

test("the all-tasks lane is labeled as admin view and keeps the unscoped detail rules", () => {
  assert.match(managementSource, /\{t\("管理员视角"\)\}/);
  // 成员页签改按身份主键索引后，activeMember 为空即「全部」视角，activityActor 仍为 undefined
  assert.match(managementSource, /const activeMember = useMemo\([\s\S]{0,180}activeTab === "all" \? undefined/);
  assert.match(managementSource, /const activityActor = useMemo\([\s\S]{0,180}activeMember \? \{ id: activeMember\.user_id, name: activeMember\.name \} : undefined/);
  assert.match(managementSource, /const scopeLabel = activeTab === "all"\s*\? t\("管理员视角"\)/);
});

test("task fullscreen stays active at the first row and explicit exit keeps auto-collapse available", () => {
  assert.match(managementSource, /if \(delta > 6 && top > 80 && !headerCollapsed\) \{\s*onHeaderCollapseChange\(true\)/);
  assert.doesNotMatch(managementSource, /delta < -6 && headerCollapsed/);
  assert.doesNotMatch(managementSource, /top <= 8\)[\s\S]{0,180}onHeaderCollapseChange\(false\)/);
  assert.match(managementSource, /onClick=\{\(\) => setHeaderCollapsed\(false\)\}/);
  assert.doesNotMatch(managementSource, /onClick=\{\(\) => \{ setHeaderPinned\(true\); setHeaderCollapsed\(false\); \}\}/);
  assert.match(managementSource, /createPortal\([\s\S]*document\.body/);
  assert.match(managementSource, /"horizon-portal fixed right-4 top-4 z-40 inline-flex min-h-11/);
  assert.doesNotMatch(managementSource, /t\("顶部概览已收起"\)/);
  assert.match(managementSource, /\{t\("退出大屏"\)\}/);
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

test("task image preview supports pinch zoom, panning and scale-aware gallery swipes", () => {
  assert.match(progressEvidenceSource, /import \{ isMobileViewport \} from "\.\/lib\/mobileRouting"/);
  assert.match(progressEvidenceSource, /const zoomEnabled = isMobileRoute\(\) \|\| isMobileViewport\(\)/);
  assert.match(mobileRoutingSource, /const effectiveWidth = Math\.min\(window\.innerWidth, window\.screen\?\.width \?\? Number\.POSITIVE_INFINITY\)/);
  assert.match(progressEvidenceSource, /activePointersRef = useRef\(new Map/);
  assert.match(progressEvidenceSource, /pinchTaskImageTransform/);
  assert.match(progressEvidenceSource, /zoomTaskImageTransform/);
  assert.match(progressEvidenceSource, /onDoubleClick=/);
  assert.match(progressEvidenceSource, /onLostPointerCapture=/);
  assert.match(progressEvidenceSource, /aria-label=\{zoomEnabled \? "图片手势区域，可双指缩放，放大后拖动" : undefined\}/);
  assert.match(progressEvidenceSource, /zoomEnabled \? "touch-none overflow-hidden" : "touch-pan-y"/);
  assert.match(progressEvidenceSource, /\{zoomEnabled && \(/);
  assert.match(progressEvidenceSource, /imageTransformRef\.current\.scale > TASK_IMAGE_MIN_SCALE/);
  assert.match(progressEvidenceSource, /\[currentImageId, flushScheduledImageTransform, resetImageTransform, setGalleryOffset\]/);
  assert.match(progressEvidenceSource, /new ResizeObserver\(updateLayout\)/);
  assert.match(progressEvidenceSource, /onLoad=\{\(\) => \{\s+resource\.onLoad\(\);\s+setLoadedUrl\(currentUrl\);\s+measureGestureLayout\(\);\s+applyImageTransform/);
  assert.match(progressEvidenceSource, /suppressBackdropClickRef\.current = draggedRef\.current \|\| wasMultitouch;\s+\n\s+if \(activePointersRef\.current\.size > 0\)/);
});

test("task image preview enables zoom on a real phone even when the desktop layout widens the viewport", () => {
  const hadWindow = Object.hasOwn(globalThis, "window");
  const previousWindow = globalThis.window;

  try {
    globalThis.window = { innerWidth: 1024, screen: { width: 430 } };
    assert.equal(isMobileViewport(), true);

    globalThis.window = { innerWidth: 1024, screen: { width: 1440 } };
    assert.equal(isMobileViewport(), false);
  } finally {
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
});

test("task image gesture math preserves the pinch focus and clamps zoom and panning", () => {
  assert.equal(TASK_IMAGE_MIN_SCALE, 1);
  assert.equal(TASK_IMAGE_MAX_SCALE, 4);
  assert.equal(TASK_IMAGE_DOUBLE_TAP_SCALE, 2);
  assert.equal(TASK_IMAGE_ZOOM_STEP, 0.5);
  assert.equal(distanceBetweenPointers({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.deepEqual(midpointBetweenPointers({ x: 10, y: 20 }, { x: 30, y: 50 }), { x: 20, y: 35 });

  const pinch = pinchTaskImageTransform({
    startTransform: { scale: 1, x: 0, y: 0 },
    startDistance: 100,
    currentDistance: 250,
    startMidpoint: { x: 250, y: 350 },
    currentMidpoint: { x: 270, y: 360 },
    viewportCenter: { x: 200, y: 300 },
  });
  assert.deepEqual(pinch, { scale: 2.5, x: -55, y: -65 });

  assert.deepEqual(
    clampTaskImageTransform({ scale: 10, x: 999, y: -999 }, {
      width: 400,
      height: 600,
      imageWidth: 300,
      imageHeight: 500,
    }),
    { scale: 4, x: 400, y: -700 },
  );
  assert.deepEqual(
    clampTaskImageTransform({ scale: 0.25, x: 100, y: -100 }, {
      width: 400,
      height: 600,
      imageWidth: 300,
      imageHeight: 500,
    }),
    { scale: 1, x: 0, y: 0 },
  );
});

test("task image button and double-tap zoom keep the selected point stationary", () => {
  const zoomed = zoomTaskImageTransform(
    { scale: 1, x: 0, y: 0 },
    TASK_IMAGE_DOUBLE_TAP_SCALE,
    { x: 250, y: 350 },
    { x: 200, y: 300 },
  );
  assert.deepEqual(zoomed, { scale: 2, x: -50, y: -50 });
  assert.deepEqual(
    zoomTaskImageTransform(zoomed, TASK_IMAGE_MIN_SCALE, { x: 250, y: 350 }, { x: 200, y: 300 }),
    { scale: 1, x: 0, y: 0 },
  );
});
