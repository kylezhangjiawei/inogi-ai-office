import { AlertTriangle, CheckCircle2, CircleHelp } from "lucide-react";

import { Badge } from "../../../app/components/ui/badge";
import { cn } from "../../../app/components/ui/utils";

type ConfidenceTagProps = {
  value: number;
  className?: string;
};

export function ConfidenceTag({ value, className }: ConfidenceTagProps) {
  const percent = Math.round(value * 100);
  const level =
    value >= 0.9
      ? {
          icon: CheckCircle2,
          label: "高置信度",
          title: "AI 高置信度自动处理",
          className: "border-blue-100 bg-blue-50 text-blue-700",
        }
      : value >= 0.7
        ? {
            icon: AlertTriangle,
            label: "中置信度",
            title: "AI 中等置信度，建议检查",
            className: "border-amber-100 bg-amber-50 text-amber-700",
          }
        : {
            icon: CircleHelp,
            label: "低置信度",
            title: "需要人工确认",
            className: "border-red-100 bg-red-50 text-red-700",
          };
  const Icon = level.icon;

  return (
    <Badge variant="outline" title={level.title} className={cn("gap-1.5", level.className, className)}>
      <Icon className="h-3.5 w-3.5" />
      {percent}%
      <span className="sr-only">{level.label}</span>
    </Badge>
  );
}
