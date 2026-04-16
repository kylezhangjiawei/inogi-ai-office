import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileSearch, Scale, Send } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const contracts = [
  { id: "CTR-1024", name: "墨西哥代理合作协议", party: "MedNova MX", risk: "高", status: "待法务确认", clause: "知识产权归属偏向对方", owner: "林法务", region: "拉美" },
  { id: "CTR-1020", name: "印度采购框架协议", party: "Aster Care", risk: "中", status: "修订中", clause: "账期 90 天过长", owner: "陈法务", region: "APAC" },
  { id: "CTR-1015", name: "NDA 保密协议", party: "NorthPeak", risk: "低", status: "已通过", clause: "标准模板，仅补充项目范围", owner: "周法务", region: "EU" },
  { id: "CTR-1012", name: "巴西独家代理补充条款", party: "Nova Brasil", risk: "高", status: "待法务确认", clause: "排他期与最低采购额冲突", owner: "林法务", region: "拉美" },
  { id: "CTR-1008", name: "北美售后合作协议", party: "CareBridge", risk: "中", status: "修订中", clause: "赔偿责任条款需要收窄", owner: "陈法务", region: "NA" },
];

const riskTone: Record<string, string> = {
  高: "bg-rose-50 text-rose-700",
  中: "bg-amber-50 text-amber-700",
  低: "bg-emerald-50 text-emerald-700",
};

const pageSize = 3;
type DialogMode = "revise" | "submit" | "export" | "filter" | null;

export function ContractReviewPage() {
  const [riskFilter, setRiskFilter] = useState("全部");
  const [regionFilter, setRegionFilter] = useState("全部区域");
  const [selectedId, setSelectedId] = useState(contracts[0].id);
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);

  const filtered = useMemo(
    () => contracts.filter((item) => (riskFilter === "全部" || item.risk === riskFilter) && (regionFilter === "全部区域" || item.region === regionFilter)),
    [regionFilter, riskFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [riskFilter, regionFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedContracts = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (!filtered.some((item) => item.id === selectedId) && filtered[0]) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const closeDialog = () => setDialogMode(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Legal AI</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">合同审查</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">补上风险筛选、区域过滤、分页和法务动作弹窗，让合同页能完整演示“识别风险 - 修订建议 - 提交复核”的流程。</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          ["待审合同", "6", "其中 2 份 NDA"],
          ["高风险条款", "5", "需法务确认"],
          ["建议采纳", "11", "已生成修订版"],
        ].map(([label, value, helper]) => (
          <div key={label} className="material-card-flat p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-4xl font-bold tracking-tight text-slate-900">{value}</div>
            <div className="mt-2 text-sm text-slate-500">{helper}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="material-card p-6">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {["全部", "高", "中", "低"].map((item) => (
                <button key={item} type="button" onClick={() => setRiskFilter(item)} className={cn("rounded-full border px-4 py-2 text-sm font-semibold", riskFilter === item ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500")}>
                  {item === "全部" ? "全部风险" : `${item}风险`}
                </button>
              ))}
            </div>
            <button type="button" className="material-button-secondary" onClick={() => setDialogMode("filter")}>
              <AlertTriangle className="h-4 w-4" />
              区域筛选
            </button>
          </div>

          <div className="space-y-4">
            {pagedContracts.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={cn("w-full rounded-[24px] border p-5 text-left", selectedId === item.id ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-slate-50/60")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="mt-2 text-sm text-slate-500">
                      {item.id} · {item.party} · {item.owner}
                    </div>
                  </div>
                  <span className={cn("material-chip", riskTone[item.risk])}>{item.risk}风险</span>
                </div>
                <div className="mt-3 text-sm text-slate-600">{item.clause}</div>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              共 {filtered.length} 条，当前第 {page}/{totalPages} 页
            </div>
            <div className="flex gap-2">
              <button type="button" className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
                上一页
              </button>
              <button type="button" className="material-button-secondary !px-3 !py-2 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
                下一页
              </button>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="material-card p-6">
            <h3 className="text-slate-900">风险详情</h3>
            {selected ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-[24px] bg-[linear-gradient(135deg,#fff1f2_0%,#ffffff_58%,#fff7ed_100%)] p-5">
                  <div className="text-lg font-semibold text-slate-900">{selected.name}</div>
                  <div className="mt-3 text-sm leading-7 text-slate-600">{selected.clause}</div>
                </div>
                <div className="space-y-3">
                  {[
                    ["付款条件", "建议由 90 天改为 30/60 天分段账期"],
                    ["知识产权", "建议明确背景 IP 不转让，项目成果按附件边界归属"],
                    ["争议解决", "建议补充上海仲裁与英文版本解释优先级"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                      <div className="mt-2 text-sm text-slate-700">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <section className="material-card p-6">
            <div className="space-y-3">
              <button type="button" onClick={() => setDialogMode("revise")} className="material-button-primary w-full justify-center">
                <FileSearch className="h-4 w-4" />
                生成修订建议
              </button>
              <button type="button" onClick={() => setDialogMode("submit")} className="material-button-secondary w-full justify-center">
                <Send className="h-4 w-4" />
                提交复核
              </button>
              <button type="button" onClick={() => setDialogMode("export")} className="material-button-secondary w-full justify-center">
                <Scale className="h-4 w-4" />
                导出条款摘要
              </button>
            </div>
          </section>
        </aside>
      </section>

      <Dialog open={dialogMode === "filter"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>区域筛选</DialogTitle>
        <DialogContent dividers>
          <select className="material-input" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
            {["全部区域", "拉美", "APAC", "EU", "NA"].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setRegionFilter("全部区域")}>
            重置
          </button>
          <button type="button" className="material-button-primary" onClick={closeDialog}>
            完成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "revise"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>修订建议</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>合同：{selected?.name}</div>
            <div>建议优先处理条款：{selected?.clause}</div>
            <div>输出内容：红线修订版 + 商务沟通摘要</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("修订建议已生成"); }}>
            确认生成
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "submit"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>提交法务复核</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>将同步给：法务负责人 + 业务负责人</div>
            <div>预计 SLA：4 小时内完成初审</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("合同已提交法务复核"); }}>
            提交
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "export"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>导出条款摘要</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">将导出当前合同的关键风险条款、建议改写版本和业务提示，便于外部沟通。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { closeDialog(); toast.success("关键条款摘要已导出"); }}>
            导出
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
