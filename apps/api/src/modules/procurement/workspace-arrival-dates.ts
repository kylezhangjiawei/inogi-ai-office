import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { purchaseOrderAvailabilityView, type PurchaseOrderAvailabilityView } from './purchase-order-availability';

export interface WorkspaceArrivalDateLine {
  refId: string;
  kind: 'line';
  taskId: string;
  lineId: string;
  tpOrderId: string;
  orderNo: string;
  lineNo: string;
  inventoryCode: string;
  inventoryName: string;
  unit: string;
  supplierName: string;
  etaDate: string | null;
  syncedAt: string | null;
  orderStatus: string | null;
  approvalStatus: string | null;
  availability: PurchaseOrderAvailabilityView | null;
}

export interface WorkspaceArrivalDateUnresolved {
  refId: string;
  kind: 'unresolved';
  reason: string;
}

export type WorkspaceArrivalDateItem = WorkspaceArrivalDateLine | WorkspaceArrivalDateUnresolved;
export interface WorkspaceArrivalDatesView {
  readOnly: true;
  items: WorkspaceArrivalDateItem[];
}

const refSelect = Prisma.validator<Prisma.ProcPurchaseOrderRefSelect>()({
  id: true, taskId: true, tpOrderNo: true, tpOrderId: true, tpLineNo: true, metadata: true,
  task: { select: { unit: true, material: { select: { tpInventoryCode: true } } } },
});
const mirrorSelect = Prisma.validator<Prisma.ProcPurchaseOrderMirrorSelect>()({
  id: true, tpOrderNo: true, tpOrderId: true, tpLineNo: true,
  inventoryCode: true, inventoryName: true, spec: true, unit: true, supplierName: true,
  // Quantities are only used by the existing confirmation fingerprint, never returned.
  orderedQty: true, receivedQty: true, etaDate: true, syncedAt: true,
  status: true, approvalStatus: true, availability: true,
});
type Ref = Prisma.ProcPurchaseOrderRefGetPayload<{ select: typeof refSelect }>;
type Mirror = Prisma.ProcPurchaseOrderMirrorGetPayload<{ select: typeof mirrorSelect }>;
const nonblank = (value: string | null | undefined): value is string => typeof value === 'string' && Boolean(value.trim());
const identityKey = (value: { tpOrderNo: string; tpOrderId: string | null; tpLineNo: string | null }) =>
  JSON.stringify([value.tpOrderId, value.tpOrderNo, value.tpLineNo]);
const unavailableReason = '订单关联不存在或不在当前工作台范围内';

function requestedRefIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length < 1 || values.length > 50 || values.some((item) => typeof item !== 'string'
    || !item.trim() || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item))) {
    throw new BadRequestException('请提供 1 至 50 个有效的订单关联标识');
  }
  // Stable database and ERP identifiers are never trimmed, decoded, or normalized.
  return [...new Set(values as string[])];
}

function resolveRef(ref: Ref, mirrors: Map<string, Mirror>): WorkspaceArrivalDateItem {
  const unresolved = (reason: string): WorkspaceArrivalDateUnresolved => ({ refId: ref.id, kind: 'unresolved', reason });
  if ((ref.metadata as Prisma.JsonObject | null)?.freeSample === true) return unresolved('免费样品没有可核对的正式 ERP 订单行');
  if (!nonblank(ref.tpOrderNo) || !nonblank(ref.tpLineNo) || !nonblank(ref.tpOrderId)) {
    return unresolved('订单关联缺少完整 ERP 身份，请核对采购单号、行号及原订单身份');
  }
  const mirror = mirrors.get(identityKey(ref));
  if (!mirror) return unresolved('原 ERP 订单行尚未同步或已失效，请核对原关联');
  const code = ref.task.material?.tpInventoryCode?.trim();
  const unit = ref.task.unit.trim();
  if (code && code !== mirror.inventoryCode.trim()) return unresolved('关联订单行的物料编码与任务物料不一致，请核对原关联');
  if (unit && unit !== mirror.unit.trim()) return unresolved('关联订单行的计量单位与任务单位不一致，请核对原关联');
  return {
    refId: ref.id, kind: 'line', taskId: ref.taskId, lineId: mirror.id, tpOrderId: ref.tpOrderId,
    orderNo: mirror.tpOrderNo, lineNo: mirror.tpLineNo,
    inventoryCode: mirror.inventoryCode, inventoryName: mirror.inventoryName, unit: mirror.unit, supplierName: mirror.supplierName,
    etaDate: mirror.etaDate?.toISOString().slice(0, 10) ?? null, syncedAt: mirror.syncedAt?.toISOString() ?? null,
    orderStatus: mirror.status, approvalStatus: mirror.approvalStatus,
    availability: purchaseOrderAvailabilityView(mirror.availability, mirror),
  };
}

/** Only current buyer-owned task refs may resolve order dates; elevated roles do not broaden this workspace. */
export async function readWorkspaceArrivalDates(prisma: PrismaService, refId: unknown, actor: ProcActor): Promise<WorkspaceArrivalDatesView> {
  const permissions = actor?.permissions ?? [];
  if (!nonblank(actor?.id) || (!permissions.includes('*') && (!permissions.includes('page:proc-my-workspace')
    || !permissions.some((permission) => permission === 'page:purchase-orders' || permission === 'page:purchase-order-detail')))) {
    throw new ForbiddenException('需要当前采购工作台及采购订单查看权限');
  }
  const ids = requestedRefIds(refId);
  const owner: Prisma.ProcTaskWhereInput[] = [{ buyerUserId: actor.id }];
  const name = actor.name?.trim();
  if (name) {
    owner.push({ buyerUserId: null, buyer: name }, { buyerUserId: '', buyer: name });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const refs = await tx.procPurchaseOrderRef.findMany({
        where: { id: { in: ids }, task: { is: { status: { not: 'pending_rd_review' }, OR: owner } } },
        select: refSelect,
      });
      const identities = new Map<string, { tpOrderNo: string; tpLineNo: string; tpOrderId: string }>();
      for (const ref of refs) {
        if (nonblank(ref.tpOrderNo) && nonblank(ref.tpLineNo) && nonblank(ref.tpOrderId)
          && (ref.metadata as Prisma.JsonObject | null)?.freeSample !== true) {
          identities.set(identityKey(ref), { tpOrderNo: ref.tpOrderNo, tpLineNo: ref.tpLineNo, tpOrderId: ref.tpOrderId });
        }
      }
      const mirrors = identities.size ? await tx.procPurchaseOrderMirror.findMany({
        where: { OR: [...identities.values()] }, select: mirrorSelect,
      }) : [];
      const byIdentity = new Map(mirrors.map((mirror) => [identityKey(mirror), mirror]));
      const byRef = new Map(refs.map((ref) => [ref.id, ref]));
      return { readOnly: true as const, items: ids.map((id): WorkspaceArrivalDateItem => {
        const ref = byRef.get(id);
        return ref ? resolveRef(ref, byIdentity) : { refId: id, kind: 'unresolved', reason: unavailableReason };
      }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (cause) {
    // Also avoid development-mode exception details exposing IDs or task fields from a failed query.
    throw new ServiceUnavailableException('订单日期读取失败，请稍后重试', { cause });
  }
}
