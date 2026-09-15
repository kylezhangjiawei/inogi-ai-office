import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { OssService } from '../src/modules/oss/oss.service';
import { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';
import { currentRdWorkspace, runInRdWorkspace } from '../src/modules/research-development/rd-workspace.context';

function fixture() {
  const config: Record<string, string> = {
    OSS_REGION: 'oss-cn-beijing', OSS_BUCKET: 'example-private-bucket',
    OSS_ACCESS_KEY_ID: 'test-key', OSS_ACCESS_KEY_SECRET: 'test-secret',
    OSS_CDN_DOMAIN: 'https://cdn.example.com', OSS_CDN_AUTH_TYPE: 'A',
    OSS_CDN_AUTH_KEY: 'test-cdn-key', OSS_CDN_AUTH_TTL_SECONDS: '1800',
    OSS_CDN_URL_STABLE_SECONDS: '300',
  };
  const oss = new OssService({ get: (key: string) => config[key] } as never);
  oss.onModuleInit();
  const service = new ResearchDevelopmentService({} as never, {} as never, oss, {} as never, {} as never) as any;
  const children = [
    { task_id: 'visible-child', primary_owner_user_id: 'member', subtasks: [] },
    { task_id: 'private-child', primary_owner_user_id: 'other-user', subtasks: [] },
  ];
  const parent = { task_id: 'parent', primary_owner_user_id: 'member', subtasks: children };
  const notes = () => Object.fromEntries(children.map((task) => [task.task_id, [{
    id: `note-${task.task_id}`,
    // 历史字段不能把聚合后的附件归属改成父任务；以实际留痕所属任务为准。
    task_id: 'historical-wrong-task',
    actor: { id: task.primary_owner_user_id, name: task.primary_owner_user_id },
    created_at: '2026-09-10T00:00:00.000Z',
    attachments: [{
      id: `attachment-${task.task_id}`, name: `${task.task_id}.png`, mime: 'image/png', size: 12,
      object_key: `prod/rd/${currentRdWorkspace()}/${task.task_id}.png`,
    }],
  }]]));
  service.refreshProductionMirrorsIfNeeded = async () => undefined;
  service.getProgressNoteMap = async () => notes();
  service.readMergedTaskCategories = async () => [{ id: 'category', children: [{ id: 'project', tasks: [parent] }] }];
  service.findTaskAcrossStores = async (id: string) => [parent, ...children].find((task) => task.task_id === id);
  return { service, parent, children };
}

const admin = { userId: 'admin', hasFullAccess: true, canReadAll: true };
const member = { userId: 'member', hasFullAccess: false, canReadAll: false };

test('按任务稳定 ID 重新读取时，31 分钟后的预览、下载和缩略图都会重新签发', async (t) => {
  let now = 1_444_435_200_000;
  t.mock.method(Date, 'now', () => now);
  const { service } = fixture();
  const first = await service.getTaskAttachments('visible-child', member);
  const attachment = first.attachments[0];
  assert.ok(attachment);
  now += 31 * 60 * 1000;
  const renewed = (await service.getTaskAttachments('visible-child', member)).attachments[0];
  assert.equal(renewed.id, attachment.id);
  for (const field of ['preview_url', 'download_url', 'thumb_url']) {
    assert.ok(renewed[field], field);
    assert.notEqual(renewed[field], attachment[field], `${field} 不能返回24小时缓存中的过期签名`);
    const url = new URL(renewed[field]);
    const timestamp = Number(url.searchParams.get('auth_key')!.split('-')[0]);
    assert.ok(timestamp + 1800 > now / 1000, field);
  }
  assert.equal(new URL(renewed.thumb_url).searchParams.get('x-oss-process'), 'image/resize,m_lfit,w_320/format,webp/quality,q_72');
  assert.equal(new URL(renewed.preview_url).searchParams.get('response-content-disposition'), 'inline');
  assert.match(new URL(renewed.download_url).searchParams.get('response-content-disposition')!, /^attachment;/);
});

test('父任务聚合、卡片预览和进展留痕均返回附件实际来源 task_id', async () => {
  const { service } = fixture();
  const all = await service.getTaskAttachments('parent', admin);
  const previews = await service.getTaskAttachmentPreviews(['parent'], admin);
  const notes = await service.getTaskProgressNotes('visible-child', member);
  const group = await service.getTaskProgressNoteGroup('visible-child', admin);
  const noteMap = await service.listAllTaskProgressNotes(admin);
  for (const attachments of [all.attachments, previews.parent.attachments]) {
    assert.deepEqual(attachments.map((attachment: any) => attachment.task_id).sort(), ['private-child', 'visible-child']);
  }
  assert.equal(notes[0].attachments[0].task_id, 'visible-child');
  assert.equal(noteMap['private-child'][0].attachments[0].task_id, 'private-child');
  assert.ok(group.notes.length > 0);
  for (const note of group.notes) {
    assert.equal(note.attachments[0].task_id, note.source_task.task_id, '合并任务留痕保留附件所属任务');
  }
});

test('续签沿用子任务权限；父任务参与人、匿名账号不能读另一子任务的附件', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { service, children } = fixture();
  assert.equal((await service.getTaskAttachments('parent', admin)).attachments.length, 2);
  const own = await service.getTaskAttachments('parent', member);
  assert.deepEqual(own.attachments.map((attachment: any) => attachment.id), ['attachment-visible-child']);
  assert.equal((await service.getTaskAttachments('private-child', member)).attachments.length, 0);
  assert.equal((await service.getTaskAttachments('parent', {})).attachments.length, 0);
  children[0].primary_owner_user_id = 'other-user';
  now += 31 * 60 * 1000;
  assert.equal((await service.getTaskAttachments('visible-child', member)).attachments.length, 0, '失去访问资格后不能从旧缓存续签');
});

test('相同 task_id 在研发与协同工作区续签时保持各自资源和缓存范围', async () => {
  const { service } = fixture();
  const rd: { attachments: Record<string, string>[] } = await runInRdWorkspace('rd', () => service.getTaskAttachments('visible-child', member));
  const collab: { attachments: Record<string, string>[] } = await runInRdWorkspace('us-collab', () => service.getTaskAttachments('visible-child', member));
  assert.equal(rd.attachments[0].task_id, 'visible-child');
  assert.equal(collab.attachments[0].task_id, 'visible-child');
  assert.match(new URL(rd.attachments[0].preview_url).pathname, /\/rd\/rd\/visible-child\.png$/);
  assert.match(new URL(collab.attachments[0].preview_url).pathname, /\/rd\/us-collab\/visible-child\.png$/);
});
