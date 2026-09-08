/** 页面仅提供对象引用，标题、权限和最新业务数据由服务端解析。 */
export type MateChatPageContext = {
  schemaVersion: 1;
  pageKey: 'rd_task_detail';
  scope: 'entity';
  refs: [{ entityType: 'rd_task'; entityId: string; workspace: 'rd' }];
  capturedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 未知版本、工作区或组合降级为普通聊天，不接收页面快照或展示字段。 */
export function normalizeMateChatPageContext(value: unknown): MateChatPageContext | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.pageKey !== 'rd_task_detail'
    || value.scope !== 'entity'
    || !Array.isArray(value.refs)
    || value.refs.length !== 1
    || typeof value.capturedAt !== 'string'
    || value.capturedAt.length > 40
    || !/^\d{4}-\d{2}-\d{2}T/.test(value.capturedAt)
    || !Number.isFinite(Date.parse(value.capturedAt))) {
    return null;
  }

  const ref = value.refs[0];
  if (!isRecord(ref)
    || ref.entityType !== 'rd_task'
    || ref.workspace !== 'rd'
    || typeof ref.entityId !== 'string') {
    return null;
  }
  const entityId = ref.entityId.trim();
  if (!entityId || entityId.length > 100 || /[\u0000-\u001f\u007f]/.test(entityId)) return null;

  return {
    schemaVersion: 1,
    pageKey: 'rd_task_detail',
    scope: 'entity',
    refs: [{ entityType: 'rd_task', entityId, workspace: 'rd' }],
    capturedAt: new Date(value.capturedAt).toISOString(),
  };
}

export function createRdTaskPageContext(taskId: string): MateChatPageContext {
  return {
    schemaVersion: 1,
    pageKey: 'rd_task_detail',
    scope: 'entity',
    refs: [{ entityType: 'rd_task', entityId: taskId, workspace: 'rd' }],
    capturedAt: new Date().toISOString(),
  };
}
