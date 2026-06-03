import React, { useEffect, useState } from "react";
import { Info, KeyRound, RefreshCw, Save, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "./components/ui/switch";
import { OcrConfigItem, integrationManagementApi } from "./lib/integrationManagementApi";

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

const SOURCE_BADGE: Record<OcrConfigItem["source"], { label: string; className: string }> = {
  database: { label: "已迁入数据库（加密存储）", className: "bg-emerald-50 text-emerald-700" },
  env: { label: "仍在使用环境变量", className: "bg-amber-50 text-amber-700" },
  none: { label: "尚未配置", className: "bg-slate-100 text-slate-600" },
};

export function OcrConfigManagementPage() {
  const [config, setConfig] = useState<OcrConfigItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [invoiceAction, setInvoiceAction] = useState("");

  function applyConfig(item: OcrConfigItem) {
    setConfig(item);
    setEnabled(item.enabled);
    setSecretId(item.secret_id);
    setSecretKey("");
    setRegion(item.region);
    setEndpoint(item.endpoint);
    setInvoiceAction(item.invoice_action);
  }

  async function loadConfig() {
    setLoading(true);
    try {
      const item = await integrationManagementApi.getOcrConfig();
      applyConfig(item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取腾讯 OCR 配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function handleSave() {
    if (enabled && !secretId.trim()) {
      toast.error("启用腾讯 OCR 时必须填写 SecretId");
      return;
    }
    if (enabled && !secretKey.trim() && !config?.has_secret_key) {
      toast.error("启用腾讯 OCR 时必须填写 SecretKey");
      return;
    }

    setSaving(true);
    try {
      const saved = await integrationManagementApi.saveOcrConfig({
        enabled,
        secret_id: secretId.trim(),
        secret_key: secretKey.trim() ? secretKey.trim() : undefined,
        region: region.trim(),
        endpoint: endpoint.trim(),
        invoice_action: invoiceAction.trim(),
      });
      applyConfig(saved);
      toast.success("腾讯 OCR 配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存腾讯 OCR 配置失败");
    } finally {
      setSaving(false);
    }
  }

  const badge = config ? SOURCE_BADGE[config.source] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">Tencent OCR</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">腾讯 OCR 配置</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">
              统一维护腾讯云 OCR（发票 / 文字识别）凭证。保存后将以加密形式写入数据库，研发模块与费用报销模块共用同一份配置，支持热更新无需重启。
            </p>
          </div>
          <button className="material-button-secondary w-fit" onClick={() => void loadConfig()} disabled={loading || saving}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新加载
          </button>
        </div>
      </section>

      {config?.source === "env" && (
        <section className="material-card flex items-start gap-3 border border-amber-200 bg-amber-50/60 p-5">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm leading-6 text-amber-800">
            当前凭证来自环境变量（明文存储、修改后需重启服务才能生效）。在此页保存一次即可迁移到数据库：改为加密存储，并支持热更新。
          </div>
        </section>
      )}

      <section className="material-card p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-900">凭证信息</h3>
            {badge && <span className={`material-chip ${badge.className}`}>{badge.label}</span>}
          </div>
          <div className="text-xs text-slate-400">
            操作人 {config?.operator_name ?? "-"} · 更新于 {formatDate(config?.updated_at)}
          </div>
        </div>

        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <span className="text-sm text-slate-700">{enabled ? "已启用腾讯 OCR" : "已停用腾讯 OCR"}</span>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">SecretId</label>
              <input
                className="material-input w-full"
                value={secretId}
                onChange={(event) => setSecretId(event.target.value)}
                placeholder="AKID..."
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                <KeyRound className="h-3.5 w-3.5" />
                SecretKey
              </label>
              <input
                className="material-input w-full"
                type="password"
                value={secretKey}
                onChange={(event) => setSecretKey(event.target.value)}
                placeholder={config?.has_secret_key ? "已设置，留空则保留原密钥" : "输入 SecretKey"}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">地域 Region</label>
              <input
                className="material-input w-full"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                placeholder="ap-guangzhou"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">接入地址 Endpoint</label>
              <input
                className="material-input w-full"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="ocr.tencentcloudapi.com"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">默认发票识别 Action</label>
            <input
              className="material-input w-full"
              value={invoiceAction}
              onChange={(event) => setInvoiceAction(event.target.value)}
              placeholder="RecognizeGeneralInvoice"
            />
            {config?.supported_actions?.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <Info className="h-3.5 w-3.5" />
                  可选：
                </span>
                {config.supported_actions.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    onClick={() => setInvoiceAction(action.default_action)}
                    title={action.default_action}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
          <button type="button" className="material-button-primary" onClick={() => void handleSave()} disabled={saving || loading}>
            <Save className="h-4 w-4" />
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </section>
    </div>
  );
}
