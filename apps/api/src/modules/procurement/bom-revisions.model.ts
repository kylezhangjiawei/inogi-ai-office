import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export type BomLeaf = { nodeId: string; parentId: string | null; deviceId: string;
  materialId: string; code: string; name: string; unit: string; qtyPer: number };
export type BomSnapshot = { deviceId: string; productRootId: string;
  structure: { id: string; parentId: string | null; name: string }[];
  leaves: BomLeaf[];
  items: { id: string; code: string; name: string; unit: string; qtyPer: number }[];
  fingerprint: string };
export const bomHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function buildBomSnapshot(input: Omit<BomSnapshot, 'items' | 'fingerprint'>): BomSnapshot {
  if (!input.productRootId?.trim()) throw new BadRequestException('请先确认设备产品归属');
  const nodes = new Map(input.structure.map(row => [row.id, row]));
  if (!input.deviceId || nodes.size !== input.structure.length || !nodes.size || nodes.get(input.deviceId)?.parentId !== null)
    throw new BadRequestException('设备结构或节点身份无效');
  const parents = new Set<string>();
  for (const node of nodes.values()) {
    if (!node.id || !node.name.trim()) throw new BadRequestException('结构节点名称与身份不能为空');
    const visited = new Set<string>();
    let current: typeof node | undefined = node;
    while (current && current.id !== input.deviceId) {
      if (visited.has(current.id)) throw new BadRequestException('结构节点存在循环');
      visited.add(current.id);
      if (!current.parentId) throw new BadRequestException('结构节点不属于当前设备');
      current = nodes.get(current.parentId);
    }
    if (!current) throw new BadRequestException('结构存在孤儿节点');
    if (node.parentId) parents.add(node.parentId);
  }
  if (!input.leaves.length) throw new BadRequestException('至少需要一条有效物料');
  const seen = new Set<string>();
  const totals = new Map<string, { id: string; code: string; name: string; unit: string; quantity: Prisma.Decimal }>();
  const leaves = input.leaves.map(row => {
    const node = nodes.get(row.nodeId);
    if (!node || row.deviceId !== input.deviceId || node.parentId !== row.parentId || parents.has(row.nodeId) || seen.has(row.nodeId) || row.nodeId === input.deviceId)
      throw new BadRequestException('物料节点与设备结构不一致');
    seen.add(row.nodeId);
    if (!row.materialId?.trim() || !row.code?.trim() || !row.name?.trim() || !row.unit?.trim()) throw new BadRequestException('物料身份、编码、名称和单位必须完整');
    if (!Number.isFinite(row.qtyPer) || row.qtyPer <= 0 || row.qtyPer > 1000000000) throw new BadRequestException('物料用量须为有效正数且在允许范围内');
    const quantity = new Prisma.Decimal(row.qtyPer);
    if (quantity.decimalPlaces() > 3) throw new BadRequestException('生产执行用量精度最多三位小数，请核对单位与用量后发布');
    const prior = totals.get(row.code);
    if (prior && (prior.unit !== row.unit || prior.id !== row.materialId || prior.name !== row.name)) throw new BadRequestException('同编码物料的身份、名称或单位冲突');
    totals.set(row.code, { id: row.materialId, code: row.code, name: row.name, unit: row.unit, quantity: prior ? prior.quantity.plus(quantity) : quantity });
    return { nodeId: row.nodeId, parentId: row.parentId, deviceId: row.deviceId, materialId: row.materialId, code: row.code, name: row.name, unit: row.unit, qtyPer: quantity.toNumber() };
  }).sort((a, b) => compare(a.nodeId, b.nodeId));
  if ([...nodes.keys()].some(id => id !== input.deviceId && !parents.has(id) && !seen.has(id))) throw new BadRequestException('结构叶子缺少正式物料');
  const items = [...totals.values()].map(({ quantity, ...row }) => {
    if (quantity.greaterThan(1000000000)) throw new BadRequestException('汇总物料用量超出执行范围');
    return { ...row, qtyPer: quantity.toNumber() };
  }).sort((a, b) => compare(a.code, b.code));
  const snapshot = { deviceId: input.deviceId, productRootId: input.productRootId,
    structure: input.structure.map(({ id, parentId, name }) => ({ id, parentId, name })).sort((a, b) => compare(a.id, b.id)), leaves, items };
  return { ...snapshot, fingerprint: bomHash(snapshot) };
}

export function assertBomSelection(productRootId: string, deviceId: string,
  revision: { productRootId: string; deviceId: string; retiredAt: Date | null }) {
  if (revision.productRootId !== productRootId || revision.deviceId !== deviceId) throw new BadRequestException('发布版本不属于当前产品和设备');
  if (revision.retiredAt) throw new BadRequestException('版本已停用');
}
