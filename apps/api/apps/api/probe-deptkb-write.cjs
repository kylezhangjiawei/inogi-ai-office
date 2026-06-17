const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const SECRET = 'change-me-jwt-secret-32chars-minimum';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function sign(payload) {
  const now = Math.floor(Date.now() / 1000);
  const p1 = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p2 = b64url(JSON.stringify({ ...payload, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', SECRET).update(p1 + '.' + p2).digest();
  return `${p1}.${p2}.${b64url(sig)}`;
}
(async () => {
  const users = await prisma.user.findMany({ include: { role: true } });
  const admin = users.find((u) => Array.isArray(u.role && u.role.permissions) && u.role.permissions.includes('*')) || users[0];
  const token = sign({ sub: admin.id, permissions: ['*'], email: admin.email, name: admin.name });
  const base = 'http://localhost:3000/api/research-development';
  const call = async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    return { status: r.status, body };
  };
  const labelOf = (cats) => (Array.isArray(cats) ? cats.map((c) => c.label).join(',') : JSON.stringify(cats));

  // 1) 在 finance 建一个分类
  const created = await call('/dept-knowledge/finance/categories', { method: 'POST', body: JSON.stringify({ label: '探测_报销制度' }) });
  console.log('create finance cat:', created.status, created.body && created.body.category && created.body.category.id);
  const newId = created.body && created.body.category && created.body.category.id;

  // 2) finance 现在应有 2 个分类；sales 仍 1 个；研发库不受影响
  console.log('finance cats:', labelOf((await call('/dept-knowledge/finance/categories')).body));
  console.log('sales   cats:', labelOf((await call('/dept-knowledge/sales/categories')).body));
  const rd = await call('/knowledge/categories');
  console.log('rd top-level cats count:', Array.isArray(rd.body) ? rd.body.length : rd.body);

  // 3) 清理：删除刚建的分类，finance 复原为仅「其他」
  if (newId) {
    const del = await call('/dept-knowledge/finance/categories/' + encodeURIComponent(newId), { method: 'DELETE' });
    console.log('delete finance cat:', del.status);
  }
  console.log('finance cats after cleanup:', labelOf((await call('/dept-knowledge/finance/categories')).body));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
