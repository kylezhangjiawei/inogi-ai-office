import React, { useEffect, useState } from "react";
import { CloudCog, Info, KeyRound, RefreshCw, Save, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Switch } from "./components/ui/switch";
import { cn } from "./components/ui/utils";
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
  const [fieldErrors, setFieldErrors] = useState<{ secretId?: string; secretKey?: string }>({});

  function applyConfig(item: OcrConfigItem) {
    setConfig(item);
    setEnabled(item.enabled);
    setFieldErrors({});
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
    const nextErrors: { secretId?: string; secretKey?: string } = {};
    if (enabled && !secretId.trim()) nextErrors.secretId = "启用腾讯 OCR 时必须填写 SecretId。";
    if (enabled && !secretKey.trim() && !config?.has_secret_key) nextErrors.secretKey = "首次启用时必须填写 SecretKey。";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      document.getElementById(nextErrors.secretId ? "ocr-secret-id" : "ocr-secret-key")?.focus();
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
  const sourceLabel = badge?.label ?? (loading ? "读取中" : "待确认");
  const updatedLabel = config?.updated_at ? formatDate(config.updated_at) : "—";

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={CloudCog}
          eyebrow="SYSTEM INTEGRATIONS · TENCENT OCR"
          title="腾讯 OCR 配置"
          description="统一维护发票与文字识别凭证；数据库配置采用加密存储，保存后可热更新，无需重启服务。"
          meta={(
            <>
              <span>研发与费用报销共用</span>
              <span>操作人：{config?.operator_name ?? "待读取"}</span>
            </>
          )}
          actions={(
            <Button type="button" variant="outline" onClick={() => void loadConfig()} disabled={loading || saving}>
              <RefreshCw className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              重新加载
            </Button>
          )}
        />

        <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
          <HorizonMetric Icon={ShieldCheck} label="服务状态" value={loading ? "读取中" : enabled ? "已启用" : "已停用"} note="保存后立即生效" tone={enabled ? "success" : "neutral"} />
          <HorizonMetric Icon={CloudCog} label="配置来源" value={config?.source === "database" ? "数据库" : config?.source === "env" ? "环境变量" : config?.source === "none" ? "未配置" : "—"} note={sourceLabel} tone={config?.source === "env" ? "warning" : config?.source === "database" ? "success" : "neutral"} />
          <HorizonMetric Icon={KeyRound} label="密钥状态" value={loading ? "读取中" : config?.has_secret_key ? "已设置" : "未设置"} note="SecretKey 不会明文回显" tone={loading ? "neutral" : config?.has_secret_key ? "success" : "warning"} />
          <HorizonMetric Icon={RefreshCw} label="最近更新" value={updatedLabel} note={config?.operator_name ? `由 ${config.operator_name} 更新` : "尚无更新记录"} tone="neutral" />
        </HorizonMetricGrid>

        {config?.source === "env" ? (
          <section className="hz-surface overflow-hidden" aria-label="凭证迁移提示">
            <div className="flex items-start gap-3 border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-900">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="text-pretty">当前凭证仍来自环境变量。保存一次即可迁移到数据库加密存储，并获得无需重启的热更新能力。</p>
            </div>
          </section>
        ) : null}

        <section className="hz-surface min-w-0 overflow-hidden">
          <HorizonSectionHeader
            Icon={ShieldCheck}
            title="凭证与识别参数"
            description="SecretKey 留空时保留已存密钥；首次启用必须完整填写 SecretId 与 SecretKey。"
            trailing={badge ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", badge.className)}>{badge.label}</span> : undefined}
          />

          <div className="space-y-5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">腾讯 OCR 服务</p>
                <p className="mt-1 text-pretty text-xs text-slate-500">停用后保留现有配置，但业务模块不会再发起识别请求。</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">{enabled ? "已启用" : "已停用"}</span>
                <Switch
                  aria-label="启用腾讯 OCR"
                  checked={enabled}
                  onCheckedChange={(checked) => {
                    setEnabled(checked);
                    if (!checked) setFieldErrors({});
                  }}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="ocr-secret-id" className="mb-1.5 block text-xs font-semibold text-slate-700">SecretId</label>
                <Input
                  id="ocr-secret-id"
                  value={secretId}
                  onChange={(event) => {
                    setSecretId(event.target.value);
                    if (fieldErrors.secretId) setFieldErrors((current) => ({ ...current, secretId: undefined }));
                  }}
                  placeholder="AKID..."
                  autoComplete="off"
                  aria-invalid={Boolean(fieldErrors.secretId)}
                  aria-describedby={fieldErrors.secretId ? "ocr-secret-id-error" : undefined}
                />
                {fieldErrors.secretId ? <p id="ocr-secret-id-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{fieldErrors.secretId}</p> : null}
              </div>
              <div>
                <label htmlFor="ocr-secret-key" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <KeyRound className="size-3.5" aria-hidden="true" />
                  SecretKey
                </label>
                <Input
                  id="ocr-secret-key"
                  type="password"
                  value={secretKey}
                  onChange={(event) => {
                    setSecretKey(event.target.value);
                    if (fieldErrors.secretKey) setFieldErrors((current) => ({ ...current, secretKey: undefined }));
                  }}
                  placeholder={config?.has_secret_key ? "已设置，留空则保留原密钥" : "输入 SecretKey"}
                  autoComplete="new-password"
                  aria-invalid={Boolean(fieldErrors.secretKey)}
                  aria-describedby={fieldErrors.secretKey ? "ocr-secret-key-error" : undefined}
                />
                {fieldErrors.secretKey ? <p id="ocr-secret-key-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{fieldErrors.secretKey}</p> : null}
              </div>
              <div>
                <label htmlFor="ocr-region" className="mb-1.5 block text-xs font-semibold text-slate-700">地域 Region</label>
                <Input id="ocr-region" value={region} onChange={(event) => setRegion(event.target.value)} placeholder="ap-guangzhou" />
              </div>
              <div>
                <label htmlFor="ocr-endpoint" className="mb-1.5 block text-xs font-semibold text-slate-700">接入地址 Endpoint</label>
                <Input id="ocr-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="ocr.tencentcloudapi.com" />
              </div>
            </div>

            <div>
              <label htmlFor="ocr-invoice-action" className="mb-1.5 block text-xs font-semibold text-slate-700">默认发票识别 Action</label>
              <Input id="ocr-invoice-action" value={invoiceAction} onChange={(event) => setInvoiceAction(event.target.value)} placeholder="RecognizeGeneralInvoice" />
              {config?.supported_actions?.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="支持的识别动作">
                  <span className="flex items-center gap-1 text-xs text-slate-500"><Info className="size-3.5" aria-hidden="true" />推荐：</span>
                  {config.supported_actions.map((action) => (
                    <Button variant="unstyled"
                      key={action.key}
                      type="button"
                      className="cursor-pointer rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-primary/25 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      onClick={() => setInvoiceAction(action.default_action)}
                      title={action.default_action}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50/60 px-4 py-3 sm:px-5">
            <Button type="button" className="hz-primary-action" onClick={() => void handleSave()} disabled={saving || loading}>
              <Save className="size-4" aria-hidden="true" />
              {saving ? "保存中…" : "保存配置"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
