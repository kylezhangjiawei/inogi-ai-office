export interface TransferDraftSnapshot {
  form: Record<string, string>;
  files: Array<{ key: string; name: string; source: 'task' | 'manual'; file?: File; size?: number; mimeType?: string }>;
}
export interface TransferDraft extends TransferDraftSnapshot { version: 1; scope: string; savedAt: string }
const database = 'inogi-procurement-transfer-drafts';
const storeName = 'drafts';
const queues = new Map<string, Promise<unknown>>();

function databaseHandle(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器不支持保存草稿，请勿直接刷新或离开。')); return; }
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
    request.onerror = () => reject(new Error('无法打开草稿存储，请检查浏览器存储空间或隐私设置。'));
    request.onblocked = () => reject(new Error('草稿存储被其他窗口占用，请关闭旧窗口后重试。'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function operation(scope: string, mode: 'get' | 'put' | 'delete', value?: TransferDraft): Promise<TransferDraft | null> {
  const db = await databaseHandle();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore(storeName);
    const request = mode === 'get' ? store.get(scope) : mode === 'put' ? store.put(value, scope) : store.delete(scope);
    let result: TransferDraft | null = null;
    request.onsuccess = () => { if (mode === 'get') result = request.result ?? null; };
    // Request success is not durability: resolve only after the transaction commits.
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('草稿保存失败，请检查存储空间后重试。')); };
  });
}
function enqueue<T>(scope: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(scope) ?? Promise.resolve()).catch(() => {}).then(action);
  queues.set(scope, next);
  void next.finally(() => { if (queues.get(scope) === next) queues.delete(scope); }).catch(() => {});
  return next;
}
export function validTransferDraft(value: unknown, scope: string): value is TransferDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as TransferDraft;
  return draft.version === 1 && draft.scope === scope && Number.isFinite(Date.parse(draft.savedAt))
    && Boolean(draft.form) && Object.values(draft.form).every(value => typeof value === 'string')
    && Array.isArray(draft.files) && draft.files.every(row => row && typeof row.key === 'string' && typeof row.name === 'string'
      && (row.source === 'task' || (row.source === 'manual' && typeof File !== 'undefined' && row.file instanceof File)));
}
export async function loadTransferDraft(scope: string) {
  const value = await enqueue(scope, () => operation(scope, 'get'));
  if (value === null) return null;
  if (!validTransferDraft(value, scope)) throw new Error('保存的草稿格式不兼容，请清除旧草稿后重新填写。');
  return value;
}
export async function saveTransferDraft(scope: string, snapshot: TransferDraftSnapshot) {
  if (snapshot.files.reduce((sum, row) => sum + (row.file?.size ?? 0), 0) > 50 * 1024 * 1024) throw new Error('新增附件总计超过 50 MB，无法保存本机草稿；可先减少附件或直接提交。');
  const value: TransferDraft = { version: 1, scope, savedAt: new Date().toISOString(), form: { ...snapshot.form }, files: snapshot.files.map(row => ({
    key: row.key, name: row.name, source: row.source, ...(row.source === 'manual' ? { file: row.file, size: row.size, mimeType: row.mimeType } : {}),
  })) };
  await enqueue(scope, () => operation(scope, 'put', value));
  return value;
}
export async function clearTransferDraft(scope: string) { await enqueue(scope, () => operation(scope, 'delete')); }
