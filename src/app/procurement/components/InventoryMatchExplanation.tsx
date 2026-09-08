import { useI18n } from "../../lib/i18n";
import type { InventoryMatchDiagnostic } from "../../lib/procurementApi";

export function getInventoryDiagnosticCopy(diagnostic?: InventoryMatchDiagnostic) {
  switch (diagnostic?.reason) {
    case "material_missing":
      return {
        label: "物料档案待匹配",
        description: "物料库未找到此编码的物料档案，量产仓也没有对应库存记录。",
        nextStep: "请核对 BOM 物料编码，并检查 T+ 物料档案同步。",
      };
    case "no_inventory_records":
      return {
        label: "尚无库存记录",
        description: "物料档案已找到，系统尚未取得该编码的任何仓库库存记录。",
        nextStep: "请检查 T+ 库存同步及仓库记录；当前不能据此确认实际库存为 0。",
      };
    case "other_warehouses_only":
      return {
        label: "仅其他仓有记录",
        description: "仅在以下仓库找到该编码的库存记录：{warehouses}。量产仓暂无对应记录。",
        nextStep: "齐套仅核算量产仓。请核对仓库归属及量产仓库存同步，其他仓的数量不计入当前齐套结果。",
      };
    default:
      return {
        label: "量产仓记录待匹配",
        description: "未找到该编码在量产仓的库存记录，暂不能确认具体原因。",
        nextStep: "请核对物料档案、库存同步及仓库归属；这不代表物料库没有该物料，也不能据此认定库存为 0。",
      };
  }
}

export function InventoryMatchExplanation({ diagnostic, compact = false }: {
  diagnostic?: InventoryMatchDiagnostic;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const copy = getInventoryDiagnosticCopy(diagnostic);
  return <div className={compact ? "mt-1.5 max-w-md whitespace-normal break-words text-[11px] leading-5 text-amber-800" : "space-y-1 whitespace-normal break-words text-xs leading-5 text-amber-800"}>
    <p>{t(copy.description, { warehouses: diagnostic?.otherWarehouses.join("、") || t("其他仓库（名称待核对）") })}</p>
    {!compact && <p>{t(copy.nextStep)}</p>}
  </div>;
}
