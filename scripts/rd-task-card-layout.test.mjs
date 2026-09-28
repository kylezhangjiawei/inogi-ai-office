import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/rd/PersonTaskCockpit.tsx', import.meta.url), 'utf8');
const card = source.slice(source.indexOf('const renderTaskCard = ('), source.indexOf('// ── Gallery Lightbox'));

test('研发首页卡片先显示任务和真实状态，再显示类别；协同和生产维持旧分支', () => {
  assert.match(source, /const researchCards = !spaciousCards && !isProductionWorkspace\(\);/);
  assert.match(card, /const researchCard = researchCards && task\.source_workspace !== "us-collab" && !productionMirror;/);
  const heading = card.indexOf('<AutoTranslatedText text={visibleTaskTitle} />');
  const status = card.indexOf('STATUS_CONFIG[task.status]');
  const taxonomy = card.indexOf('hierarchySegments.map');
  assert.ok(heading > 0 && status > heading && taxonomy > status);
  assert.match(card, /!researchCard && \(\s*<h3/);
  assert.ok(card.indexOf('task.latest_progress_summary.actor_name') < heading, '真实更新人位于任务之前');
});

test('主责人与更新人分开显示，期限使用真实完整日期，无版本猜测或逐卡资料请求', () => {
  const facts = card.match(/<dl[\s\S]*?<\/dl>/)?.[0];
  assert.ok(facts);
  assert.match(facts, /displayPersonName\(task\.primary_owner\)/);
  assert.doesNotMatch(facts, /OwnerAvatar/, '负责人文字保留，但不重复头像');
  assert.match(facts, /task\.due_date \|\| t\("未设置"\)/);
  assert.doesNotMatch(facts, /latest_progress_summary|\.slice\(5\)/);
  assert.match(card, /userId=\{task\.latest_progress_summary\.actor_user_id\}/);
  assert.match(card, /暂无进展记录/);
  assert.match(card, /dateTime=\{task\.latest_progress_summary\.created_at\}/);
  assert.doesNotMatch(card, /fetchRdTechnicalDocuments|useProcurementTaskLink|当前版本|V1\.0/);
});

test('研发卡片收纳附件动作且保留查看、转派、同步、删除及键盘边界', () => {
  assert.match(card, /!researchCard && taskAttachmentCount > 0 && \(/);
  assert.match(card, /researchCard && taskAttachmentCount > 0 && \(\s*<DropdownMenuItem[\s\S]*?openCompleteAttachmentCollection\(task, taskAttachmentCount\)/);
  assert.match(card, /onClick=\{\(\) => onSelectTask\(task, activityActor\)\}/);
  assert.match(card, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(card, /onToggleProductionSync\(task\)/);
  assert.match(card, /onReassignTask\(task\)/);
  assert.match(card, /onDeleteTask\(task\)/);
  assert.match(card, /<TaskAttachmentStrip/);
  assert.match(card, /noteReceipts\[task\.task_id\]/);
});
