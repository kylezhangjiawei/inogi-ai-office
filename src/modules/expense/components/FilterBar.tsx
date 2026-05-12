import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Slider } from "../../../app/components/ui/slider";
import type { ExpenseCategory, InvoiceFilters, InvoiceStatus } from "../types";

const statusOptions: Array<"全部" | InvoiceStatus> = ["全部", "待识别", "已识别", "待确认", "已关联", "异常", "已报销"];
const categoryOptions: Array<"全部" | ExpenseCategory> = ["全部", "差旅", "餐饮", "采购", "办公", "其他"];

export function FilterBar({
  filters,
  advanced,
  onFiltersChange,
  onReset,
  onToggleAdvanced,
}: {
  filters: InvoiceFilters;
  advanced: boolean;
  onFiltersChange: (next: InvoiceFilters) => void;
  onReset: () => void;
  onToggleAdvanced: () => void;
}) {
  return (
    <div className="material-panel space-y-3 p-4">
      <div className="grid grid-cols-[150px_150px_150px_minmax(0,1fr)_auto_auto] items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">时间范围</span>
          <Select
            value={filters.quickRange}
            onValueChange={(value) => onFiltersChange({ ...filters, quickRange: value as InvoiceFilters["quickRange"] })}
          >
            <SelectTrigger className="material-input h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["本周", "本月", "上月", "本季度", "自定义"].map((item) => (
                <SelectItem key={item} value={item}>{item}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">状态</span>
          <Select
            value={filters.status}
            onValueChange={(value) => onFiltersChange({ ...filters, status: value as "全部" | InvoiceStatus })}
          >
            <SelectTrigger className="material-input h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">类别</span>
          <Select
            value={filters.category}
            onValueChange={(value) => onFiltersChange({ ...filters, category: value as "全部" | ExpenseCategory })}
          >
            <SelectTrigger className="material-input h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">关键字</span>
          <Input
            value={filters.keyword}
            onChange={(event) => onFiltersChange({ ...filters, keyword: event.target.value })}
            placeholder="发票号 / 销售方 / 项目"
            className="h-9"
          />
        </label>
        <Button type="button" variant="outline" onClick={onReset}>重置</Button>
        <Button type="button" variant="outline" onClick={onToggleAdvanced}>{advanced ? "收起" : "高级筛选"}</Button>
      </div>
      {advanced ? (
        <div className="grid grid-cols-[150px_150px_minmax(0,1fr)] items-end gap-3 border-t border-slate-200 pt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">金额下限</span>
            <Input value={filters.amountMin} onChange={(event) => onFiltersChange({ ...filters, amountMin: event.target.value })} className="h-9" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">金额上限</span>
            <Input value={filters.amountMax} onChange={(event) => onFiltersChange({ ...filters, amountMax: event.target.value })} className="h-9" />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-slate-500">只看 AI 置信度低于 {Math.round(filters.maxConfidence * 100)}%</span>
            <Slider
              value={[filters.maxConfidence]}
              min={0.5}
              max={1}
              step={0.01}
              onValueChange={(value) => onFiltersChange({ ...filters, maxConfidence: value[0] ?? 1 })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
