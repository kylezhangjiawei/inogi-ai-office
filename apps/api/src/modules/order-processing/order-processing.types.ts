export type OrderSource = 'wecom_mail' | 'gmail' | 'upload';
export type OrderStatusType = 'warning' | 'error' | 'success';
export type ProductCheckStatus = '通过' | '价格差异' | '库存不足';
export type InventoryStatus = '正常' | '偏低' | '缺货';
export type StockMovementType = 'in' | 'out' | 'adjust';
export type PurchaseOrderStatus = '待确认' | '已下单' | '部分到货' | '已完成' | '异常';

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

export type InvoiceTemplate = {
  id: string;
  name: string;
  source: 'builtin' | 'ai';
  accentColor?: string;
  createdAt?: string;
  config?: Record<string, unknown>;
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
};

export type StockMovement = {
  id: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
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

export type ReminderRule = {
  enabled: boolean;
  daysBefore: number;
};

export type OrderProcessingState = {
  orders: OrderSummary[];
  orderDetails: Record<string, OrderDetail>;
  inventory: InventoryItem[];
  movements: StockMovement[];
  templates: InvoiceTemplate[];
  activeTemplateId: string;
  reminderRule: ReminderRule;
  updatedAt: string;
};

export type PageResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  currency: 'CNY' | 'USD';
  warehouse: string;
  owner: string;
  paymentTerm?: string;
  deliveryTerm?: string;
  invoiceType?: string;
  approvalStatus?: string;
  remark?: string;
  items?: PurchaseOrderLine[];
  sourceFile?: string;
};

export type PurchaseOrderStats = {
  total: number;
  open: number;
  inbound: number;
  abnormal: number;
  amount: number;
};
