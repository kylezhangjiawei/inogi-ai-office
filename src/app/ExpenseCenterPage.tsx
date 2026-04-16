import React, { useState } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  Receipt,
  TrendingDown,
  TrendingUp,
  Upload,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

type ExpenseCategory = "差旅" | "餐饮" | "办公用品" | "采购" | "招待";
type ExpenseStatus = "审批中" | "已报销" | "已驳回";

interface Invoice {
  id: string;
  code: string;
  amount: number;
  date: string;
  vendor: string;
  project: string;
  category: ExpenseCategory;
  warning?: string;
}

interface SubmissionRecord {
  id: string;
  date: string;
  amount: number;
  category: ExpenseCategory;
  status: ExpenseStatus;
}

const categoryColors: Record<ExpenseCategory, string> = {
  差旅: "#6366f1",
  餐饮: "#f59e0b",
  办公用品: "#10b981",
  采购: "#3b82f6",
  招待: "#ec4899",
};

const mockInvoices: Invoice[] = [
  { id: "INV-001", code: "044001900211", amount: 4820, date: "2026-04-10", vendor: "中国国际航空", project: "德国展会", category: "差旅" },
  { id: "INV-002", code: "044001900345", amount: 688, date: "2026-04-12", vendor: "汉庭酒店", project: "北京出差", category: "差旅", warning: "发票抬头与公司名称不符" },
  { id: "INV-003", code: "031002100456", amount: 1260, date: "2026-04-08", vendor: "苏宁采购", project: "样机配件", category: "采购" },
];

const mockHistory: SubmissionRecord[] = [
  { id: "EXP-501", date: "2026-04-10", amount: 4820, category: "差旅", status: "审批中" },
  { id: "EXP-497", date: "2026-04-05", amount: 688, category: "差旅", status: "已驳回" },
  { id: "EXP-488", date: "2026-03-28", amount: 860, category: "差旅", status: "已报销" },
  { id: "EXP-476", date: "2026-03-20", amount: 540, category: "办公用品", status: "已报销" },
];

const monthlyCategoryData = [
  { name: "差旅", value: 28400, fill: categoryColors["差旅"] },
  { name: "餐饮", value: 6200, fill: categoryColors["餐饮"] },
  { name: "办公用品", value: 3800, fill: categoryColors["办公用品"] },
  { name: "采购", value: 12600, fill: categoryColors["采购"] },
  { name: "招待", value: 4200, fill: categoryColors["招待"] },
];

const monthlyDeptData = [
  { dept: "研发部", amount: 18400 },
  { dept: "销售部", amount: 24600 },
  { dept: "质量部", amount: 8200 },
  { dept: "行政部", amount: 4000 },
];

const statusConfig: Record<ExpenseStatus, string> = {
  审批中: "bg-amber-50 text-amber-700",
  已报销: "bg-green-50 text-green-600",
  已驳回: "bg-red-50 text-red-600",
};

export function ExpenseCenterPage() {
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice>(mockInvoices[0]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [formData, setFormData] = useState({
    dept: "研发部",
    category: mockInvoices[0].category,
    amount: String(mockInvoices[0].amount),
    date: mockInvoices[0].date,
    note: mockInvoices[0].project,
  });
  const [month, setMonth] = useState("2026-04");
  const totalAmount = monthlyCategoryData.reduce((s, d) => s + d.value, 0);

  const handleUpload = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      toast.success("发票识别完成");
    }, 1200);
  };

  const handleSelectInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setFormData({
      dept: "研发部",
      category: inv.category,
      amount: String(inv.amount),
      date: inv.date,
      note: inv.project,
    });
  };

  return (
    <div className="flex h-full gap-4 p-4 bg-gray-50 min-h-0">
      {/* Left: Invoice Upload + OCR */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Receipt className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-gray-800 text-sm">发票上传 + OCR 识别</h3>
          </div>
          <div
            onClick={handleUpload}
            className="h-24 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:border-orange-300 hover:bg-orange-50 transition-colors cursor-pointer"
          >
            {isProcessing ? (
              <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Upload className="w-6 h-6 opacity-40" />
                <p className="text-xs">点击上传发票（JPG/PNG/PDF）</p>
              </>
            )}
          </div>

          {/* Invoice list */}
          <div className="mt-3 space-y-2">
            {mockInvoices.map((inv) => (
              <button
                key={inv.id}
                onClick={() => handleSelectInvoice(inv)}
                className={cn(
                  "w-full text-left p-3 rounded-lg border text-xs transition-colors",
                  selectedInvoice.id === inv.id
                    ? "border-orange-200 bg-orange-50"
                    : "border-gray-100 hover:bg-gray-50"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-800">{inv.vendor}</span>
                  <span className="font-semibold text-gray-900">¥{inv.amount.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span style={{ backgroundColor: categoryColors[inv.category] + "20", color: categoryColors[inv.category] }}
                    className="px-1.5 py-0.5 rounded-full text-xs font-medium">
                    {inv.category}
                  </span>
                  <span className="text-gray-400">{inv.date}</span>
                </div>
                {inv.warning && (
                  <div className="flex items-center gap-1 mt-1.5 text-red-500">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{inv.warning}</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Extracted fields */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">OCR 提取字段</div>
          <div className="space-y-2.5">
            {[
              { label: "发票代码", value: selectedInvoice.code },
              { label: "金额", value: `¥${selectedInvoice.amount.toLocaleString()}` },
              { label: "开票日期", value: selectedInvoice.date },
              { label: "销售方", value: selectedInvoice.vendor },
              { label: "项目名称", value: selectedInvoice.project },
            ].map((f) => (
              <div key={f.label} className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{f.label}</span>
                <span className="text-xs font-medium text-gray-700">{f.value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between pt-1 border-t border-gray-50">
              <span className="text-xs text-gray-400">费用科目</span>
              <span style={{ backgroundColor: categoryColors[selectedInvoice.category] + "20", color: categoryColors[selectedInvoice.category] }}
                className="text-xs px-2 py-0.5 rounded-full font-medium">
                {selectedInvoice.category}
              </span>
            </div>
          </div>
          {selectedInvoice.warning && (
            <div className="mt-3 flex items-start gap-2 p-2.5 bg-red-50 rounded-lg border border-red-100">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-600">{selectedInvoice.warning}</p>
            </div>
          )}
        </div>
      </div>

      {/* Center: Expense Form + History */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-orange-500" />
            <h3 className="font-semibold text-gray-800 text-sm">报销申请</h3>
          </div>
          {[
            { label: "部门", key: "dept" },
            { label: "费用科目", key: "category" },
            { label: "金额（元）", key: "amount" },
            { label: "发票日期", key: "date" },
          ].map((f) => (
            <div key={f.key}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <input
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
                value={(formData as Record<string, string>)[f.key]}
                onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-400 block mb-1">事由说明</label>
            <textarea
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 h-16 resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
              value={formData.note}
              onChange={(e) => setFormData((prev) => ({ ...prev, note: e.target.value }))}
            />
          </div>
          <button
            onClick={() => toast.success("报销单已提交，等待审批")}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            提交报销
          </button>
        </div>

        {/* Submission History */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex-1">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">提交记录</div>
          <div className="space-y-2">
            {mockHistory.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                <div>
                  <div className="font-medium text-gray-700">{r.id}</div>
                  <div className="text-gray-400">{r.date} · {r.category}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-800">¥{r.amount.toLocaleString()}</div>
                  <span className={cn("px-1.5 py-0.5 rounded-full text-xs font-medium", statusConfig[r.status])}>{r.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Monthly Statistics */}
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <h3 className="font-semibold text-gray-800 text-sm">月度费用统计</h3>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <button
                onClick={() => toast.success("Excel 明细已导出")}
                className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 transition-colors"
              >
                <Download className="w-3 h-3" /> 导出 Excel
              </button>
            </div>
          </div>

          {/* KPI */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: "本月总报销", value: `¥${(totalAmount / 10000).toFixed(1)}万`, sub: "较上月 +12%", up: true },
              { label: "差旅费占比", value: "52%", sub: "差旅为主要费用", up: null },
              { label: "已报销笔数", value: "18 笔", sub: "人均 1.5 笔", up: null },
            ].map((k) => (
              <div key={k.label} className="bg-orange-50 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-1">{k.label}</div>
                <div className="text-xl font-bold text-gray-800">{k.value}</div>
                <div className={cn("text-xs flex items-center gap-1 mt-1", k.up === true ? "text-orange-600" : "text-gray-400")}>
                  {k.up === true && <TrendingUp className="w-3 h-3" />}
                  {k.sub}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Donut chart */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">按费用科目</div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={monthlyCategoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {monthlyCategoryData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`¥${v.toLocaleString()}`, ""]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {monthlyCategoryData.map((d) => (
                  <div key={d.name} className="flex items-center gap-1 text-xs text-gray-500">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    {d.name}
                  </div>
                ))}
              </div>
            </div>

            {/* Bar chart */}
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-2">按部门</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyDeptData} layout="vertical" margin={{ left: 20, right: 10 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="dept" tick={{ fontSize: 11 }} width={40} />
                  <Tooltip formatter={(v: number) => [`¥${v.toLocaleString()}`, "报销金额"]} />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                    {monthlyDeptData.map((_, i) => (
                      <Cell key={i} fill={["#f97316", "#fb923c", "#fdba74", "#fed7aa"][i % 4]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* AI Summary */}
          <div className="mt-4 p-3 bg-orange-50 rounded-xl border border-orange-100 text-sm text-gray-700">
            本月总报销 <strong>¥{(totalAmount / 10000).toFixed(1)} 万元</strong>，差旅费占比 <strong>52%</strong>，较上月增长 <strong>12%</strong>；销售部为最高费用部门，建议关注招待费合理性。
          </div>
        </div>
      </div>
    </div>
  );
}
