import React, { useState } from "react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const initialSettings = [
  { title: "通知中心", desc: "逾期提醒、资料更新、审批事件统一配置", enabled: true, owner: "平台运营", snapshot: "消息模板 V2.1" },
  { title: "流程参数", desc: "SLA 时限、审批节点与默认责任人", enabled: true, owner: "流程管理员", snapshot: "SLA 模板 2026-Q2" },
  { title: "数据字典", desc: "型号、市场、文档类别与角色枚举维护", enabled: false, owner: "主数据组", snapshot: "字典包 18 项" },
  { title: "外部集成", desc: "邮件、企业微信、模板导出连接", enabled: true, owner: "IT 支撑", snapshot: "连接健康 4/4" },
];

type DialogMode = "item" | "all" | null;

export function SystemSettings() {
  const [settings, setSettings] = useState(initialSettings);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedTitle, setSelectedTitle] = useState(initialSettings[0].title);

  const selected = settings.find((item) => item.title === selectedTitle) ?? settings[0];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <span className="material-chip bg-blue-50 text-blue-700">Settings</span>
        <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">系统设置</h2>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">把原来的单纯开关升级成带详情预览、单项确认和全局快照保存的设置工作台。</p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {settings.map((item) => (
            <div key={item.title} className="material-card-flat p-5">
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="text-left" onClick={() => setSelectedTitle(item.title)}>
                  <div className="text-lg font-semibold text-slate-900">{item.title}</div>
                </button>
                <button
                  className={cn("rounded-full px-3 py-1 text-xs font-semibold", item.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600")}
                  onClick={() =>
                    setSettings((prev) =>
                      prev.map((setting) => (setting.title === item.title ? { ...setting, enabled: !setting.enabled } : setting)),
                    )
                  }
                >
                  {item.enabled ? "已开启" : "已关闭"}
                </button>
              </div>
              <div className="mt-2 text-sm leading-7 text-slate-500">{item.desc}</div>
              <div className="mt-4 text-xs uppercase tracking-[0.14em] text-slate-400">{item.snapshot}</div>
              <button
                className="mt-4 material-button-secondary"
                onClick={() => {
                  setSelectedTitle(item.title);
                  setDialogMode("item");
                }}
              >
                保存本项
              </button>
            </div>
          ))}
        </div>

        <aside className="material-card p-6">
          <h3 className="text-slate-900">当前聚焦配置</h3>
          <div className="mt-4 rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
            <div className="text-lg font-semibold text-slate-900">{selected.title}</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <div>责任人：{selected.owner}</div>
              <div>当前快照：{selected.snapshot}</div>
              <div>状态：{selected.enabled ? "启用中" : "已关闭"}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["变更影响", "会影响工作流、消息提醒和首页提示"],
              ["建议窗口", "建议在业务低峰期保存并推送"],
              ["回滚方式", "可回退到上一份系统快照"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-2 text-sm text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="material-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-slate-900">全局保存</h3>
            <p className="mt-1 text-sm text-slate-500">把当前所有配置项一次性保存为新的系统设置快照，并生成变更记录。</p>
          </div>
          <button className="material-button-primary" onClick={() => setDialogMode("all")}>
            保存全部设置
          </button>
        </div>
      </section>

      <Dialog open={dialogMode === "item"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>保存本项设置</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>配置项：{selected.title}</div>
            <div>责任人：{selected.owner}</div>
            <div>当前状态：{selected.enabled ? "启用中" : "已关闭"}</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            取消
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success(`${selected.title} 设置已保存`); }}>
            确认保存
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "all"} onClose={() => setDialogMode(null)} fullWidth maxWidth="sm">
        <DialogTitle>保存系统快照</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">会生成一份新的系统快照并同步通知给平台管理员，便于回溯配置变更。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={() => setDialogMode(null)}>
            关闭
          </button>
          <button type="button" className="material-button-primary" onClick={() => { setDialogMode(null); toast.success("系统设置已全部保存"); }}>
            保存快照
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
