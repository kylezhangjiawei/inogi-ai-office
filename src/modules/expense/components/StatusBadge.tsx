import { Badge } from "../../../app/components/ui/badge";
import { cn } from "../../../app/components/ui/utils";
import type { InvoiceStatus, MatchStatus, ReimbursementStatus } from "../types";

const statusClassName: Record<string, string> = {
  待识别: "border-slate-200 bg-slate-50 text-slate-600",
  已识别: "border-blue-100 bg-blue-50 text-blue-700",
  待确认: "border-amber-100 bg-amber-50 text-amber-700",
  已关联: "border-blue-100 bg-blue-50 text-blue-700",
  异常: "border-red-100 bg-red-50 text-red-700",
  已报销: "border-emerald-100 bg-emerald-50 text-emerald-700",
  待关联: "border-amber-100 bg-amber-50 text-amber-700",
  关联失败: "border-red-100 bg-red-50 text-red-700",
  草稿: "border-slate-200 bg-slate-50 text-slate-600",
  未提交: "border-slate-200 bg-slate-50 text-slate-600",
  审批中: "border-blue-100 bg-blue-50 text-blue-700",
  已同步: "border-blue-100 bg-blue-50 text-blue-700",
  已回调: "border-emerald-100 bg-emerald-50 text-emerald-700",
  同步失败: "border-red-100 bg-red-50 text-red-700",
  已通过: "border-emerald-100 bg-emerald-50 text-emerald-700",
  已驳回: "border-red-100 bg-red-50 text-red-700",
  已付款: "border-emerald-100 bg-emerald-50 text-emerald-700",
};

export function StatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus | MatchStatus | ReimbursementStatus | string;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(statusClassName[status] ?? "border-slate-200 bg-slate-50 text-slate-600", className)}>
      {status}
    </Badge>
  );
}
