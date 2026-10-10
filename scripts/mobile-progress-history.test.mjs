import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const mobileSource = readFileSync(
  new URL("../src/app/MobileRDCockpit.tsx", import.meta.url),
  "utf8",
);
const mobileAst = ts.createSourceFile("MobileRDCockpit.tsx", mobileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function sourceNode(predicate) {
  const found = [];
  const visit = (node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); };
  visit(mobileAst);
  assert.equal(found.length, 1, "expected one matching source node");
  return found[0];
}

function evaluate(node, scope) {
  const javascript = ts.transpileModule(`return (${node.getText(mobileAst)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), javascript)(...Object.values(scope));
}

test("mobile task details show progress from the full merged-task group", () => {
  assert.match(mobileSource, /fetchRdTaskProgressNoteGroup/);
  assert.match(mobileSource, /const \[groupNotes, setGroupNotes\] = useState<RdTaskProgressNote\[\]>\(\[\]\)/);
  assert.match(
    mobileSource,
    /const data = await fetchRdTaskProgressNoteGroup\(task\.task_id, controller\.signal\)[\s\S]*?setGroupNotes\(data\.notes\)/,
  );
  assert.match(
    mobileSource,
    /setNotes\(data\.notes\.filter\(\(note\) => \(note\.source_task\?\.task_id \?\? note\.task_id\) === task\.task_id\)\)/,
  );

  const taskDiscussion = mobileSource.indexOf('detailTab === "conversation"');
  const progressHistory = mobileSource.indexOf('detailTab === "progress"');
  assert.ok(taskDiscussion >= 0 && progressHistory > taskDiscussion);
  assert.match(mobileSource.slice(taskDiscussion, progressHistory), /notes=\{notes\}/);
  assert.match(mobileSource.slice(progressHistory), /notes=\{groupNotes\}/);
});

test("mobile task detail exposes desktop task facts from shared API data", () => {
  for (const label of [
    "任务概览",
    "进度留痕",
    "任务讨论",
    "附件库",
    "操作记录",
    "任务编号",
    "开始日期",
    "截止日期",
    "完整分类",
    "任务成员",
    "工作项",
    "合并关系",
  ]) {
    assert.ok(mobileSource.includes(label), `missing mobile detail field: ${label}`);
  }
  assert.match(mobileSource, /setGroupTasks\(data\.tasks\)/);
  assert.match(mobileSource, /groupNotes\.flatMap\(\(note\) => note\.attachments/);
  assert.match(mobileSource, /useAuditLogs\(\{ resourceType: "task" \}\)/);
  assert.match(mobileSource, /useProcurementTaskLink\(task\.task_id\)/);
});
test("mobile attachment tab distinguishes loading failures from an empty library", () => {
  const attachmentsTab = mobileSource.slice(mobileSource.indexOf('detailTab === "attachments"'));
  const errorState = attachmentsTab.indexOf(") : loadError ? (");
  const emptyState = attachmentsTab.indexOf('t("暂无附件")');
  assert.ok(errorState >= 0 && emptyState > errorState);
  assert.match(attachmentsTab.slice(errorState, emptyState), /onClick=\{\(\) => void loadNotes\(\)\}/);
});

// Detail facts are asserted before the standalone attachment-state test.

test("mobile task detail opens progress first and places overview second", () => {
  const initialState = sourceNode((node) => ts.isVariableDeclaration(node)
    && ts.isArrayBindingPattern(node.name) && node.name.elements[0]?.getText(mobileAst) === "detailTab").initializer;
  const workspaceFlag = sourceNode((node) => ts.isVariableDeclaration(node)
    && node.name.getText(mobileAst) === "technicalDocumentsEnabled").initializer;
  for (const workspace of [null, "us-collab", "production"]) {
    const technicalDocumentsEnabled = evaluate(workspaceFlag, { currentRdWorkspace: () => workspace });
    for (const search of ["", "?tab=progress", "?tab=conversation", "?tab=attachments", "?tab=CONVERSATION"]) {
      const [active] = evaluate(initialState, {
        technicalDocumentsEnabled, location: { search },
        useState: (initial) => [typeof initial === "function" ? initial() : initial],
      });
      assert.equal(active, workspace === null && search === "?tab=conversation" ? "conversation" : "progress", `${workspace}:${search}`);
    }
  }
  assert.match(mobileSource, /\{ key: "progress", label: t\("进度留痕"\), icon: History \},\s*\{ key: "overview", label: t\("任务概览"\), icon: Info \}/);
});

test("mobile discussion deep links follow query and task changes without resetting collaboration tabs", () => {
  const effect = sourceNode((node) => ts.isCallExpression(node) && node.expression.getText(mobileAst) === "useEffect"
    && node.arguments[0]?.getText(mobileAst).includes("setDetailTab(")
    && node.arguments[0]?.getText(mobileAst).includes('get("tab")'));
  const dependencies = effect.arguments[1].elements.map((node) => node.getText(mobileAst));
  for (const dependency of ["location.search", "task.task_id", "technicalDocumentsEnabled"]) assert.ok(dependencies.includes(dependency), dependency);
  for (const technicalDocumentsEnabled of [true, false]) {
    let active = "attachments";
    for (const [search, expected] of [["?tab=conversation", "conversation"], ["?tab=unknown", "progress"], ["", "progress"]]) {
      evaluate(effect.arguments[0], {
        technicalDocumentsEnabled, location: { search }, setDetailTab: (value) => { active = value; },
      })();
      assert.equal(active, technicalDocumentsEnabled ? expected : "attachments");
    }
  }
});

test("mobile task cards place the image between progress summary and progress bar", () => {
  const cardStart = mobileSource.indexOf("function MobileFeedCard");
  const cardEnd = mobileSource.indexOf("// ─── 主页面", cardStart);
  const cardSource = mobileSource.slice(cardStart, cardEnd);
  const title = cardSource.indexOf("{/* 标题 */}");
  const summary = cardSource.indexOf("{/* 最新进展");
  const cover = cardSource.indexOf("{/* 封面：");
  const progress = cardSource.indexOf("{/* 进度 */}");

  assert.ok(title >= 0, "missing mobile task title section");
  assert.ok(summary > title, "progress summary should follow the task title");
  assert.ok(cover > summary, "task image should follow the progress summary");
  assert.ok(progress > cover, "progress bar should follow the task image");
  assert.match(cardSource.slice(cover, progress), /onPreview\(cover, coverThumbnails, 0\)/);
});

test("mobile task detail aborts stale progress requests before task state can mix", () => {
  assert.match(mobileSource, /const noteRequestRef = useRef<AbortController \| null>\(null\)/);
  assert.match(mobileSource, /noteRequestRef\.current\?\.abort\(\)/);
  assert.match(
    mobileSource,
    /fetchRdTaskProgressNoteGroup\(task\.task_id, controller\.signal\)/,
  );
  assert.match(mobileSource, /if \(controller\.signal\.aborted\) return/);
});
