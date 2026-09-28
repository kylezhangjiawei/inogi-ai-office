import { authFetch, readErrorMessage } from "./authSession";
import { listProcStockPlans } from "./procurementApi";
import { getProcurementOperations, type QualityAnalysis } from "./procurementOperationsApi";

export interface InventoryShipmentOverview {
  month: string;
  scope: "all" | "assigned";
  shipmentTargetQty: number | null;
  actualShippedQty: number | null;
}

export interface InventoryQualityReason {
  key: QualityAnalysis["category"];
  label: string;
  quantity: number;
}

export interface InventoryQualityOverview {
  mapped: boolean;
  reasons: InventoryQualityReason[];
}

const QUALITY_LABELS: Record<QualityAnalysis["category"], string> = {
  unknown: "待确认",
  process: "工艺问题",
  packaging: "包装问题",
  standard: "检验标准",
  revision: "版本不符",
  material: "来料问题",
  other: "其他",
};

export async function getInventoryShipmentOverview(month: string, signal?: AbortSignal): Promise<InventoryShipmentOverview> {
  const response = await authFetch(`/api/procurement/production-execution/overview?${new URLSearchParams({ month })}`, { signal });
  if (!response.ok) throw new Error(await readErrorMessage(response, "月度出货概览读取失败"));
  const payload = await response.json() as InventoryShipmentOverview;
  return {
    month: payload.month,
    scope: payload.scope,
    shipmentTargetQty: Number.isFinite(payload.shipmentTargetQty) ? payload.shipmentTargetQty : null,
    actualShippedQty: Number.isFinite(payload.actualShippedQty) ? payload.actualShippedQty : null,
  };
}

export async function getInventoryQualityOverview(
  month: string,
  productLine: string,
  signal?: AbortSignal,
): Promise<InventoryQualityOverview> {
  const plans = await listProcStockPlans(signal, { planType: "machine", month });
  const productIds = [...new Set(plans
    .filter((plan) => plan.productLine?.trim() === productLine.trim())
    .map((plan) => plan.productId?.trim())
    .filter((value): value is string => Boolean(value)))];
  if (productIds.length !== 1) return { mapped: false, reasons: [] };

  const data = await getProcurementOperations({ productId: productIds[0], month }, signal);
  const totals = new Map<QualityAnalysis["category"], number>();
  for (const record of data.qualityRecords) {
    if (record.source !== "procurement" || record.defectiveQty <= 0) continue;
    const category = record.analysis?.category ?? "unknown";
    totals.set(category, (totals.get(category) ?? 0) + record.defectiveQty);
  }
  const reasons = [...totals.entries()]
    .map(([key, quantity]) => ({ key, label: QUALITY_LABELS[key], quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.label.localeCompare(b.label, "zh-CN"));
  return { mapped: true, reasons };
}
