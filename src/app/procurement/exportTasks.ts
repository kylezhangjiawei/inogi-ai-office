// 采购任务驾驶舱「导出」：把当前视图（业务线/统计/人员/物料筛选后的列表）导出为 .xlsx。
// 纯前端生成，与研发驾驶舱 rdTaskExport 同模式（动态 import xlsx）。
import { PROC_STATUS_META } from "./components/common";
import { taskMainDate, taskRequester } from "./data";
import type { ProcurementTask } from "../lib/procurementApi";

const PRIORITY_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };
const PAYMENT_LABEL: Record<string, string> = { unpaid: "未付款", partial: "部分付款", paid: "已付款" };

/** 生成并下载 xlsx，返回导出的任务条数。 */
export async function exportProcTasksXlsx(tasks: ProcurementTask[]): Promise<number> {
  const rows = tasks.map((t) => ({
    单号: t.code,
    业务线: t.businessLine === "rd" ? "研发" : "生产",
    来源: t.source === "rd" ? "研发流转" : "采购自建",
    物料名称: t.materialName,
    规格: t.spec,
    数量: t.quantity,
    单位: t.unit,
    采购方式: t.method === "direct" ? "电商直购" : "询价采购",
    状态: PROC_STATUS_META[t.status]?.label ?? t.status,
    优先级: PRIORITY_LABEL[t.priority] ?? t.priority,
    采购负责人: t.buyer,
    需求提出人: taskRequester(t).name,
    研发对接人: t.rdContact ?? "",
    需求日期: t.needDate ?? "",
    Deadline: t.deadline ?? "",
    预计到货: t.expectedArrivalDate ?? "",
    主日期口径: taskMainDate(t).label,
    已到数量: t.arrivedQty,
    付款状态: PAYMENT_LABEL[t.paymentStatus] ?? t.paymentStatus,
    // 免费样品来货没有 T+ 单号，导出空串会让整列看不出这行到底是漏登还是免费样品
    关联采购单: t.purchaseOrders
      .map((po) => (po.freeSample ? `免费样品${po.supplierName ? `·${po.supplierName}` : ""}` : po.tpOrderNo))
      .join("、"),
    创建时间: t.createdAt.slice(0, 10),
  }));

  const mod = await import("xlsx");
  const XLSX = ((mod as unknown as { default?: typeof import("xlsx") }).default ?? mod) as typeof import("xlsx");

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: "当前筛选条件下没有任务" }]);
  ws["!cols"] = [
    { wch: 16 }, { wch: 6 }, { wch: 8 }, { wch: 24 }, { wch: 18 }, { wch: 8 }, { wch: 6 },
    { wch: 8 }, { wch: 10 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 11 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "采购任务");
  XLSX.writeFile(wb, `采购任务_${new Date().toISOString().slice(0, 10)}.xlsx`);
  return rows.length;
}
