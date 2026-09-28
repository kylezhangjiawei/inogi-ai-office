import type { BuyerRosterMember, ImportSupplierQuoteItem, Material, ProcurementTask, ProcStatus, ProcWorkspaceArrivalDate, ProcWorkspaceArrivalDatesResponse, Quotation, QuoteBookRow } from "../../src/app/lib/procurementApi";
import type { DeliverySchedule } from "../../src/app/lib/purchaseDeliveryApi";

// All values are synthetic and are served only by the isolated preview server.
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const stamp = new Date().toISOString();
export const previewUser = {
  id: "preview-buyer-1", name: "陈知远 / Alexander Procurement Preview", englishName: "Alexander Preview",
  username: "ui-preview", email: "preview@example.invalid", roleId: "preview", roleName: "UI Preview",
  department: "供应链采购与国际供应商协作部", departmentCode: "preview", avatarUrl: null,
  permissions: ["*"],
};

const names = [previewUser.name, "Morgan Elizabeth International Sourcing", "周星澜", "周星澜", "许锦程（精密结构件与表面处理协调）", "Taylor LongNameSupplierQualification", "林予安", "黎沐川", "许见山", "季南舟", "祁云舒", "苏晚晴", "陆时鸣", "沈映秋", "程知行", "Inactive Preview Buyer"];
export const people: BuyerRosterMember[] = names.map((name, index) => ({
  id: `preview-buyer-${index + 1}`, name, department: index % 2 ? "International strategic sourcing and supplier development" : "供应链采购与国际供应商协作部",
  note: index % 3 ? "精密器件询价、跨区域供应商交付协调及新产品项目采购跟进" : "Precision components, quality qualification and international delivery coordination",
  managedByDepartment: index % 3 === 0, disabled: index === 15, canReceiveTasks: index !== 15,
}));

export const materials: Material[] = Array.from({ length: 63 }, (_, index) => ({
  id: `preview-material-${index + 1}`,
  name: index % 3 === 0 ? `超长名称验收 · ${index + 1}号耐高温防震精密定位连接器组件及配套安装固定座` : `Preview precision vibration-resistant actuator and mounting bracket assembly ${index + 1}`,
  spec: `REV-${index + 1} / 316L stainless steel · tolerance ±0.005 mm / 高温耐腐蚀表面处理`,
  unit: "件", category: index % 2 ? "电气系统 / 精密连接组件" : "机械系统 / 传动装配", productLine: index % 2 ? "Q5" : "Q7",
  erpCode: `PREVIEW-${String(index + 1).padStart(6, "0")}`, tpInventoryCode: `FAKE-${index + 1}`,
  isSpecial: index % 5 === 0, isConsumable: index % 7 === 0,
  safeStock: 1000, stockQty: index * 15, availableQty: index * 10 - 20, inTransitQty: index * 12,
  inventorySyncedAt: stamp, reviewStatus: "approved", latestPrice: index % 7 === 0 ? null : 1234.567 + index,
  latestSupplier: "虚构供应商 · Northstar Advanced Components International", latestQuoteDate: day(-2),
}));

export const quoteRows: QuoteBookRow[] = materials.map((material, index) => ({
  id: material.id, name: material.name, spec: material.spec, unit: material.unit, category: material.category,
  productLine: material.productLine, latestPrice: material.latestPrice,
  quotes: index % 7 === 0 ? [] : Array.from({ length: index < 3 ? 6 : 2 }, (_, supplierIndex) => ({
    id: `preview-quote-${index}-${supplierIndex}`, materialId: material.id,
    supplierId: `preview-supplier-${supplierIndex}`, supplierName: supplierIndex % 2 ? "虚构供应商 · 华辰精密制造与工业自动化系统（国际采购协作）有限公司" : `Northstar Advanced Components International Manufacturing Division ${supplierIndex + 1}`,
    supplierModel: `PREVIEW-ULTRALONGMODEL-${index}-${supplierIndex}-REVISION-2026-INDUSTRIAL`,
    currency: ["CNY", "USD", "EUR"][supplierIndex % 3], taxIncluded: supplierIndex % 2 === 0, leadTimeDays: 7 + supplierIndex * 21,
    tiers: Array.from({ length: supplierIndex === 0 ? 7 : 3 }, (_, tierIndex) => ({ minQty: [0, 100, 500, 2000, 10000, 100000, 1000000][tierIndex], unitPrice: (supplierIndex === 0 ? 1234567.8912 : 128.5687) / (tierIndex + 1) })),
    quoteDate: day(-30 - supplierIndex), validUntil: day(supplierIndex % 3 === 0 ? -7 : supplierIndex % 3 === 1 ? 5 : 90),
    note: "UI-only synthetic quote. Includes packaging, overseas freight clarification, and a very long technical acceptance note. 此内容仅用于布局验收。",
    updatedAt: stamp,
  })),
}));

const statuses: ProcStatus[] = ["pending_rd_review", "pending_confirm", "pending_inquiry", "inquiring", "pending_sample", "testing", "priced", "pending_purchase", "in_transit", "partial_arrival", "completed", "cancelled"];

// Two existing buyer-owned tasks provide 16 distinct rows for arrival pagination.
// Formal order quantities match those tasks; free samples are separate associations.
function previewPurchaseOrders(taskIndex: number): ProcurementTask["purchaseOrders"] {
  if (taskIndex !== 8 && taskIndex !== 9) return [];
  return Array.from({ length: 8 }, (_, lineIndex) => {
    const freeSample = taskIndex === 8 && lineIndex >= 6;
    const key = `${taskIndex + 1}-${lineIndex + 1}`;
    return {
      id: `preview-arrival-ref-${key}`,
      tpOrderId: freeSample ? undefined : `preview-erp-order-${key}`,
      tpOrderNo: freeSample ? "" : `PREVIEW-PO-${key}-SYNTHETIC-ONLY`,
      tpLineNo: freeSample ? undefined : String(lineIndex + 1),
      supplierName: lineIndex % 2
        ? "虚构供应商 · 华辰精密制造与工业自动化系统（跨区域样品与批量交付验收）有限公司"
        : "Synthetic Supplier · Northstar Advanced Components International Manufacturing Division",
      orderedQty: freeSample ? 3 : taskIndex === 8 ? 2000 : 154320 + (lineIndex < 7 ? 1 : 0),
      receivedQty: taskIndex === 9 ? 1111 : 0,
      unitPrice: freeSample ? 0 : 128.5687,
      orderDate: day(-14),
      etaDate: lineIndex === 3 || lineIndex === 6 ? undefined : day(lineIndex - 2),
      status: "虚构待交付", approvalStatus: "虚构已审核", freeSample,
    };
  });
}

export const tasks: ProcurementTask[] = Array.from({ length: 48 }, (_, index) => {
  const material = materials[index];
  const person = index < 12 ? people[0] : people[index % people.length];
  return {
    id: `preview-task-${index + 1}`, code: `PREVIEW-CG-${String(index + 1).padStart(5, "0")}`,
    productId: "preview-Q5", materialId: material.id, materialName: material.name, spec: material.spec, unit: material.unit,
    quantity: index % 3 ? 12000 : 1234567, method: index % 4 === 0 ? "direct" : "inquiry",
    needDate: day(index % 2 ? 7 : -10), deadline: day(index % 3 ? 5 : -3), expectedArrivalDate: day(index % 5),
    paymentStatus: index % 2 ? "partial" : "unpaid", arrivedQty: index % 12 === 9 ? 8888 : 0,
    source: "rd", businessLine: index % 2 ? "production" : "rd", rdTaskTitle: "预览项目 · 复杂系统联调与供应链交付里程碑验证",
    buyer: index === 46 ? "" : person.name, buyerUserId: index === 46 ? undefined : person.id,
    requester: "UI Preview Requester", requesterDept: "Product Engineering and Validation", rdContact: "Preview Research Engineer",
    priority: index % 4 ? "medium" : "high", needSample: index % 2 === 0,
    attachments: 0, attachmentList: [], purchaseOrders: previewPurchaseOrders(index), criticalMaterials: [],
    businessDone: false, status: statuses[index % statuses.length],
    logs: [{ at: stamp, text: "虚构验收记录：等待技术参数复核与供应商交期确认。This is a synthetic UI fixture; no business task exists." }],
    createdAt: stamp, updatedAt: stamp,
  };
});

const arrivalDateFixtures = new Map<string, ProcWorkspaceArrivalDate>(tasks.flatMap((task) => task.purchaseOrders.map((order, index) => {
  const item: ProcWorkspaceArrivalDate = order.freeSample
    ? { refId: order.id, kind: "unresolved", reason: "免费样品没有可核对的正式 ERP 订单行" }
    : {
      refId: order.id, kind: "line", taskId: task.id, lineId: `preview-erp-line-${order.id}`,
      tpOrderId: order.tpOrderId!, orderNo: order.tpOrderNo, lineNo: order.tpLineNo!,
      inventoryCode: materials.find((material) => material.id === task.materialId)?.tpInventoryCode || "PREVIEW-UNKNOWN",
      inventoryName: task.materialName, unit: task.unit, supplierName: order.supplierName,
      etaDate: index === 2 ? day(9) : order.etaDate || null,
      syncedAt: stamp, orderStatus: order.status || null, approvalStatus: order.approvalStatus || null,
      availability: index % 4 === 0 ? null : {
        availableDate: index % 4 === 3 ? null : day(index + 4),
        note: "虚构日期确认，仅用于 UI 布局验收。\nSynthetic confirmation: inspect wrapping, disclosure, and source-change states. No real order or inventory is affected.",
        confirmedByName: "虚构验收人员 · Preview Quality Inspector",
        confirmedAt: stamp, version: index + 1, needsReconfirmation: index % 4 === 2,
      },
    };
  return [order.id, item] as const;
})));

export const history: Quotation[] = Array.from({ length: 27 }, (_, index) => ({
  id: `preview-history-${index + 1}`, materialId: materials[1].id, materialName: materials[1].name,
  supplierName: quoteRows[1].quotes[index % quoteRows[1].quotes.length].supplierName,
  unitPrice: index % 3 === 0 ? 1234567.8912 - index * 234.567 : 1567.899 - index * 13.12,
  currency: ["CNY", "USD", "EUR"][index % 3], leadTimeDays: 14 + index, minOrderQty: 100,
  quoteDate: day(-90 + index * 3), channel: "quote-book", isSelected: index === 24,
}));

export const importItems: ImportSupplierQuoteItem[] = Array.from({ length: 43 }, (_, index) => ({
  materialName: materials[index].name, spec: materials[index].spec, unit: "件", category: materials[index].category,
  supplierName: quoteRows[1].quotes[index % quoteRows[1].quotes.length].supplierName,
  supplierModel: `PREVIEW-LONG-SUPPLIER-MODEL-${index + 1}-2026-Q5-REVISION-777777777777777777`,
  currency: ["CNY", "USD", "EUR"][index % 3], taxIncluded: index % 2 === 0,
  leadTimeDays: 21 + index, tiers: quoteRows[1].quotes[0].tiers,
  quoteDate: day(-2), validUntil: day(30),
  note: "仅用于验收导入核对表的多行备注与长文本布局，不代表任何真实采购信息。Synthetic preview with multiple lead time and packaging conditions.",
  historyPrices: [{ unitPrice: 1234567.8912, minQty: 100, label: "历史第一轮核价" }, { unitPrice: 1134567.8912, minQty: 1000, label: "Supplier second negotiation round" }],
}));

export function fixtureFor(pathname: string, search: URLSearchParams): unknown | undefined {
  if (pathname === '/api/procurement/bom') return { roots: [{ id: 'preview-device', parentId: null, name: '验收设备', productLine: 'PREVIEW-Q5', level: 0, sortOrder: 0, updatedAt: stamp, children: [{ id: 'preview-leaf', parentId: 'preview-device', name: '验收阀体', productLine: 'PREVIEW-Q5', code: 'PREVIEW-VALVE', qtyPer: 2, level: 1, sortOrder: 0, updatedAt: stamp, children: [], material: { id: 'preview-material', name: '验收阀体', unit: '件', spec: '合成测试规格' } }] }] };
  if (pathname === '/api/procurement/bom-devices/preview-device/revisions') return { deviceId: 'preview-device', productRootId: 'preview-root', draftFingerprint: 'd'.repeat(64), snapshotFingerprint: 'd'.repeat(64), issue: null, products: [{ id: 'preview-root', name: '验收产品' }], revisions: [{ id: 'preview-revision', version: 1, fingerprint: 'd'.repeat(64), publishedAt: stamp, publishedByName: '验收用户', retiredAt: null, reason: '仅用于验证界面，非真实业务数据', snapshot: { items: [{ id: 'preview-material', code: 'PREVIEW-VALVE', name: '验收阀体', qtyPer: 2, unit: '件' }] } }] };
  if (pathname === "/api/procurement/quote-book") return { rows: quoteRows };
  if (pathname === "/api/procurement/quote-book/suppliers") return { suppliers: quoteRows[1].quotes.map((quote) => ({ id: quote.supplierId, name: quote.supplierName, source: "preview" })) };
  if (pathname === "/api/procurement/materials") return { items: materials, total: materials.length, page: 1, pageSize: 10000 };
  if (pathname === "/api/procurement/materials/replenish/suggestions") return { rows: materials.slice(0, 3).map((material, index) => ({
    materialId: material.id, code: material.erpCode, name: material.name, spec: material.spec, unit: material.unit,
    stock: index * 10, safeStock: 1000, inTransit: 50, openTaskQty: 100, suggestQty: 850 - index * 10,
    packStep: 10, lastSupplier: material.latestSupplier, lastPrice: material.latestPrice,
  })) };
  if (pathname === "/api/procurement/tasks") return { items: tasks, total: tasks.length, page: 1, pageSize: 200 };
  if (pathname === "/api/procurement/workspace-arrival-dates") return {
    readOnly: true,
    // The production client repeats refId once per requested association, rather than CSV.
    items: [...new Set(search.getAll("refId"))].map((refId) => arrivalDateFixtures.get(refId)
      ?? { refId, kind: "unresolved", reason: "该关联不属于虚构预览数据" }),
  } satisfies ProcWorkspaceArrivalDatesResponse;
  if (pathname === "/api/procurement/stock-plans") return { items: [] };
  if (pathname === "/api/procurement/delivery/schedule") {
    const requestedMonth = search.get("month") || "";
    const requestedPageSize = Number(search.get("pageSize"));
    return {
      scope: "permission-visible-erp-mirror", source: "tplus", snapshot: "0".repeat(64),
      month: /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : day(0).slice(0, 7),
      syncedAt: stamp, oldestOrderDate: null,
      summary: { all: 0, inMonth: 0, undated: 0, outside: 0 }, days: [],
      rows: { items: [], page: 1, pageSize: Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0 ? requestedPageSize : 20, total: 0, totalPages: 1 },
    } satisfies DeliverySchedule;
  }
  if (/^\/api\/procurement\/tasks\/[^/]+$/.test(pathname)) return tasks.find((task) => pathname.endsWith(`/${task.id}`));
  if (pathname === "/api/procurement/quotations") return history.map((quote) => ({ ...quote, materialName: search.get("materialName") || quote.materialName, taskId: search.get("taskId") || undefined }));
  if (pathname.endsWith("/quote-book-options")) return { material: materials[0], options: [], suppliers: [], rows: [] };
  if (pathname === "/api/procurement/buyer-roster") return { members: people };
  if (pathname === "/api/procurement/buyers") return people.map((person) => ({ ...person, inRoster: true }));
  if (pathname === "/api/auth/avatars") return [];
  if (pathname === "/api/research-development/products") return [{ id: "preview-Q5", name: "Preview Q5", status: "active", createdAt: stamp, updatedAt: stamp }];
  if (pathname === "/api/i18n/dict/en") return {};
  if (pathname === "/api/i18n/preference") return { lang: "zh" };
  return undefined;
}
