import { authFetch, readErrorMessage } from "./authSession";

const API_BASE = "/api/order-processing";
const TPLUS_VIEWS_BASE = "/api/procurement/tplus/views";

export type OrderSource = "wecom_mail" | "gmail" | "upload";
export type OrderStatusType = "warning" | "error" | "success";
export type ProductCheckStatus = "通过" | "价格差异" | "库存不足";
export type InventoryStatus = "正常" | "偏低" | "缺货";
export type PurchaseOrderStatus = "待确认" | "已下单" | "部分到货" | "已完成" | "异常";

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type OrderSummary = {
  id: string;
  customer: string;
  type: OrderStatusType;
  status: string;
  date: string;
  source: OrderSource;
  generated: boolean;
  invoiceExported: boolean;
  createdAt: string;
};

export type OrderProduct = {
  id: string;
  lineId?: string;
  name: string;
  category: string;
  spec: string;
  unit: string;
  orderQty: number;
  stockQty: number;
  orderPrice: string;
  sysPrice: string;
  subtotal: string;
  status: ProductCheckStatus;
  remark: string;
};

export type InvoiceLine = {
  id: string;
  lineId?: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
};

export type InvoiceInfo = {
  customer: string;
  orderId: string;
  date: string;
};

export type OrderDetail = {
  id: string;
  customer: string;
  orderId: string;
  date: string;
  amount: string;
  invoiceNo: string;
  invoiceTemplateId?: string;
  generatedAt?: string;
  mailContent?: {
    subject: string;
    sender: string;
    receivedAt: string;
    body: string;
  };
  invoiceInfo?: InvoiceInfo;
  invoiceLines?: InvoiceLine[];
  products: OrderProduct[];
};

export type InvoiceGenerateLine = {
  id: string;
  lineId?: string;
  name?: string;
  spec?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
};

export type InvoiceTemplate = {
  id: string;
  name: string;
  source: "builtin" | "ai";
  accentColor?: string;
  createdAt?: string;
  config?: Record<string, unknown>;
};

export type WorkbenchResponse = {
  stats: { pending: number; abnormal: number; generated: number; unexported: number };
  wecomMail: { connected: boolean; enabled: boolean; message: string; selectedMailboxId?: string };
  queue: PageResult<OrderSummary>;
  selectedOrder: OrderSummary | null;
  orderDetails: OrderDetail | null;
  productRows: PageResult<OrderProduct>;
  templates: InvoiceTemplate[];
  activeTemplateId: string;
  reminderRule: { enabled: boolean; daysBefore: number };
};

export type MailSyncResponse = {
  scannedCount: number;
  matchedCount: number;
  created: OrderSummary[];
  skipped: Array<{ subject: string; sender: string; reason: string }>;
  latestUid: number | null;
  filter: { subject: string; sender: string };
  message: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  spec: string;
  stock: number;
  safe: number;
  in: number;
  out: number;
  status: InventoryStatus;
  unit?: string;
  available?: number;
  warehouses?: Array<{ name: string; stock: number; available: number; inTransit: number }>;
  syncedAt?: string | null;
};

export type StockMovement = {
  id: string;
  itemId: string;
  itemName: string;
  type: "in" | "out" | "adjust";
  qty: number;
  time: string;
  operator: string;
  note: string;
  relatedOrderId?: string;
  documentNo?: string;
  warehouse?: string;
  supplier?: string;
  businessDate?: string;
};

export type InventoryResponse = {
  summary: { totalSku: number; normal: number; low: number; shortage: number };
  inventory: PageResult<InventoryItem>;
  categories: string[];
  statuses: InventoryStatus[];
  recentMovements: StockMovement[];
  source?: "tplus";
  readOnly?: boolean;
  syncedAt?: string | null;
};

export type InventoryDetailResponse = {
  item: InventoryItem;
  movements: StockMovement[];
  relatedOrders: Array<OrderProduct & { orderId: string; customer: string; date: string }>;
  relatedPurchaseOrders?: Array<{
    id: string;
    poNo: string;
    supplier: string;
    orderedQty: number;
    receivedQty: number;
    unitPrice: number;
    orderDate: string;
    etaDate: string;
    approvalStatus?: string | null;
    status: PurchaseOrderStatus;
    syncedAt?: string | null;
  }>;
  source?: "tplus";
  readOnly?: boolean;
};

export type StockInItem = { id: string; qty: number };

export type StockInRecognitionResponse = {
  files: Array<{ name: string; size: string }>;
  fields: string[];
  stockIn: {
    type: string;
    supplier: string;
    poNumber: string;
    handler: string;
    documentNo: string;
    warehouse: string;
    businessDate: string;
    remark: string;
    items: StockInItem[];
  };
  confidence: number;
  message: string;
};

export type PurchaseOrderLine = {
  sku: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  receivedQty: number;
  unitPrice: number;
};

export type PurchaseOrder = {
  id: string;
  poNo: string;
  supplier: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierEmail?: string;
  buyer: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  etaDate: string;
  itemCount: number;
  amount: number;
  currency: "CNY" | "USD";
  warehouse: string;
  owner: string;
  paymentTerm?: string;
  deliveryTerm?: string;
  invoiceType?: string;
  approvalStatus?: string;
  remark?: string;
  items?: PurchaseOrderLine[];
  sourceFile?: string;
  syncedAt?: string | null;
  taskLinks?: Array<{
    id: string;
    code: string;
    materialName: string;
    status: string;
    quantity: number;
    arrivedQty: number;
    buyer: string;
  }>;
};

export type PurchaseOrderStats = {
  total: number;
  open: number;
  inbound: number;
  abnormal: number;
  amount: number;
};

export type PurchaseOrdersResponse = {
  orders: PageResult<PurchaseOrder>;
  suppliers: string[];
  stats: PurchaseOrderStats;
  source?: "tplus";
  readOnly?: boolean;
  syncedAt?: string | null;
};

export type DownloadPayload = {
  fileName: string;
  mimeType: string;
  content: string;
  encoding?: "text" | "base64";
  message?: string;
};

async function requestJson<T>(path: string, init: RequestInit = {}, fallback = "请求失败"): Promise<T> {
  const response = await authFetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, fallback));
  return response.json() as Promise<T>;
}

async function requestTplusView<T>(path: string, init: RequestInit = {}, fallback = "畅捷通数据请求失败"): Promise<T> {
  const response = await authFetch(`${TPLUS_VIEWS_BASE}${path}`, init);
  if (!response.ok) throw new Error(await readErrorMessage(response, fallback));
  return response.json() as Promise<T>;
}

function buildQuery(params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });
  const text = qs.toString();
  return text ? `?${text}` : "";
}

function decodeBase64(content: string) {
  const binary = window.atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function downloadFile(payload: DownloadPayload) {
  const body = payload.encoding === "base64" ? decodeBase64(payload.content) : payload.content;
  const blob = new Blob([body], { type: payload.mimeType || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const orderProcessingApi = {
  getWorkbench(params: {
    q?: string;
    source?: OrderSource;
    mailboxId?: string;
    orderId?: string;
    orderPage?: number;
    orderPageSize?: number;
    productPage?: number;
    productPageSize?: number;
  }) {
    return requestJson<WorkbenchResponse>(`/workbench${buildQuery(params)}`);
  },

  uploadOrders(files: File[] = []) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (files.length === 0) form.append("fileName", "manual-order.pdf");
    return requestJson<{ created: OrderSummary[]; message: string }>("/orders/upload", { method: "POST", body: form });
  },

  syncWecomMailOrders(payload: { mailboxId?: string; sinceHours?: number; limit?: number; ignoreLastUid?: boolean }) {
    return requestJson<MailSyncResponse>("/orders/sync-mail", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  generateInvoice(orderId: string, payload?: { templateId?: string; info?: InvoiceInfo; lines?: InvoiceGenerateLine[] }) {
    return requestJson<{ order: OrderSummary; orderDetails: OrderDetail; message: string }>(
      `/orders/${encodeURIComponent(orderId)}/generate-invoice`,
      { method: "POST", body: payload ? JSON.stringify(payload) : undefined },
    );
  },

  async exportInvoice(orderId: string) {
    const payload = await requestJson<DownloadPayload>(`/orders/${encodeURIComponent(orderId)}/export-invoice`, { method: "POST" });
    downloadFile(payload);
    return payload;
  },

  saveActiveTemplate(templateId: string) {
    return requestJson<{ templates: InvoiceTemplate[]; activeTemplateId: string }>("/templates/active", {
      method: "POST",
      body: JSON.stringify({ templateId }),
    });
  },

  saveTemplate(payload: { id?: string; name: string; config?: Record<string, unknown> }) {
    return requestJson<{ template: InvoiceTemplate; templates: InvoiceTemplate[]; activeTemplateId: string; message: string }>("/templates", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  generateAiTemplate(files: File[] = []) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return requestJson<{ template: InvoiceTemplate; templates: InvoiceTemplate[]; activeTemplateId: string; message: string }>(
      "/templates/ai-generate",
      { method: "POST", body: form },
    );
  },

  saveReminderRule(payload: { enabled: boolean; daysBefore: number }) {
    return requestJson<{ reminderRule: { enabled: boolean; daysBefore: number }; message: string }>("/reminder-rule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getInventory(params: { q?: string; category?: string; status?: string; timeFilter?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    return requestTplusView<InventoryResponse>(`/inventory${buildQuery(params)}`);
  },

  getInventoryDetail(itemId: string) {
    return requestTplusView<InventoryDetailResponse>(`/inventory/${encodeURIComponent(itemId)}`);
  },

  recognizeStockIn(files: File[] = []) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return requestJson<StockInRecognitionResponse>("/inventory/ai-recognize", { method: "POST", body: form });
  },

  createStockIn(payload: {
    type: string;
    supplier?: string;
    poNumber?: string;
    handler?: string;
    documentNo?: string;
    businessDate?: string;
    warehouse?: string;
    remark?: string;
    items: StockInItem[];
  }) {
    return requestJson<{ message: string; summary: InventoryResponse["summary"]; inventory: InventoryItem[] }>("/inventory/stock-in", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async exportInventory(params: { q?: string; category?: string; status?: string; timeFilter?: string; startDate?: string; endDate?: string }) {
    const payload = await requestTplusView<DownloadPayload>(`/inventory/export${buildQuery(params)}`, { method: "POST" });
    downloadFile(payload);
    return payload;
  },

  getPurchaseOrders(params: {
    q?: string;
    status?: string;
    supplier?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }) {
    return requestTplusView<PurchaseOrdersResponse>(`/purchase-orders${buildQuery(params)}`);
  },

  getPurchaseOrder(id: string) {
    return requestTplusView<{ order: PurchaseOrder }>(`/purchase-orders/${encodeURIComponent(id)}`);
  },

  importPurchaseOrders(files: File[] = []) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return requestJson<{ created: PurchaseOrder[]; message: string }>("/purchase-orders/import", { method: "POST", body: form });
  },

  createStockOut(itemId: string, payload: { qty: number; operator?: string; note?: string }) {
    return requestJson<InventoryDetailResponse>(`/inventory/${encodeURIComponent(itemId)}/stock-out`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  adjustInventory(itemId: string, payload: { stock: number; operator?: string; note?: string }) {
    return requestJson<InventoryDetailResponse>(`/inventory/${encodeURIComponent(itemId)}/adjust`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
};
