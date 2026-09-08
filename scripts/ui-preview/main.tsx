import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router";
import { Toaster } from "sonner";
import { TooltipProvider } from "../../src/app/components/ui/tooltip";
import { QuoteBookPage } from "../../src/app/procurement/QuoteBookPage";
import { ProcPeopleManagementPage } from "../../src/app/procurement/ProcPeopleManagementPage";
import { ProcMyWorkspacePage } from "../../src/app/procurement/ProcMyWorkspacePage";
import { PeopleManageDrawer } from "../../src/app/procurement/components/PeopleManageDrawer";
import { PriceHistoryModal } from "../../src/app/procurement/components/PriceHistoryModal";
import { QuoteImportPreview } from "../../src/app/procurement/components/QuoteImportModal";
import { BatchReassignModal, EditTaskModal, NewRequirementModal, ReplenishModal } from "../../src/app/procurement/components/modals";
import { setI18nLang, useI18n } from "../../src/app/lib/i18n";
import { importItems, materials, quoteRows, tasks } from "./fixtures";
import "../../src/styles/index.css";
import "../../src/app/procurement/horizon.css";
import "./preview.css";

const pages = [
  ["/proc-quote-book", "报价库", "Quote book"], ["/proc-people-management", "人员管理", "People"],
  ["/proc-my-workspace", "我的工作台", "My workspace"], ["/preview-dialogs", "抽屉与历史", "Drawers & history"],
  ["/preview-import", "导入核对表", "Import review"],
];

function DialogPreviews() {
  const { lang } = useI18n();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [businessDialog, setBusinessDialog] = useState<"replenish" | "reassign" | "new" | "edit" | null>(null);
  return <section className="ui-preview-panel"><h2>{lang === "zh" ? "共用弹窗 · 非空数据验收" : "Shared dialogs with synthetic content"}</h2>
    <p>{lang === "zh" ? "16 位虚构成员、重名人员、停用账号与 27 条多币种历史报价。" : "16 fictional people, duplicate names, a disabled account, and 27 multi-currency quotes."}</p>
    <div className="ui-preview-actions"><button onClick={() => setPeopleOpen(true)}>{lang === "zh" ? "打开成员管理抽屉" : "Open people drawer"}</button><button onClick={() => setHistoryOpen(true)}>{lang === "zh" ? "打开历史价格" : "Open price history"}</button></div>
    <div className="ui-preview-actions" style={{ marginTop: 12 }}>
      <button onClick={() => setBusinessDialog("replenish")}>{lang === "zh" ? "补货建议（3 条）" : "Replenishment (3 rows)"}</button>
      <button onClick={() => setBusinessDialog("reassign")}>{lang === "zh" ? "批量转派（多批筛选）" : "Batch reassignment"}</button>
      <button onClick={() => setBusinessDialog("new")}>{lang === "zh" ? "新建需求表单" : "New requirement form"}</button>
      <button onClick={() => setBusinessDialog("edit")}>{lang === "zh" ? "编辑任务表单" : "Edit task form"}</button>
    </div>
    {peopleOpen && <PeopleManageDrawer onClose={() => setPeopleOpen(false)} />}
    <PriceHistoryModal materialName={materials[1].name} open={historyOpen} onClose={() => setHistoryOpen(false)} />
    {businessDialog === "replenish" && <ReplenishModal onClose={() => setBusinessDialog(null)} />}
    {businessDialog === "reassign" && <BatchReassignModal tasks={tasks} onClose={() => setBusinessDialog(null)} />}
    {businessDialog === "new" && <NewRequirementModal onClose={() => setBusinessDialog(null)} />}
    {businessDialog === "edit" && <EditTaskModal task={tasks[8]} onClose={() => setBusinessDialog(null)} />}
  </section>;
}

function ImportPreview() {
  const { lang } = useI18n();
  return <section className="ui-preview-panel proc-horizon"><h2>{lang === "zh" ? "导入核对表 · 43 条虚构报价" : "Import review · 43 synthetic quotes"}</h2>
    <p>{lang === "zh" ? "这是生产弹窗复用的展示组件。仅检查搜索、翻页、阶梯价格和长文本；没有导入操作。" : "Uses the production review component. Search, paginate and inspect long content; no import action is provided."}</p>
    <QuoteImportPreview items={importItems} existingRows={quoteRows} />
  </section>;
}

function PreviewApp() {
  const { lang } = useI18n();
  const location = useLocation();
  const current = pages.find(([url]) => url === location.pathname);
  return <div className="horizon-theme ui-preview-frame">
    <header className="ui-preview-banner"><strong>{lang === "zh" ? "独立 UI 验收沙箱 · 全部为虚构数据 · 禁止业务写入" : "Isolated UI preview · Synthetic data · Business writes disabled"}</strong>
      <div className="ui-preview-language"><button aria-pressed={lang === "zh"} onClick={() => void setI18nLang("zh")}>中文</button><button aria-pressed={lang === "en"} onClick={() => void setI18nLang("en")}>English</button></div>
    </header>
    <nav className="ui-preview-nav" aria-label="Preview pages">{pages.map(([url, zh, en]) => <Link key={url} to={url} aria-current={url === location.pathname ? "page" : undefined}>{lang === "zh" ? zh : en}</Link>)}</nav>
    <main className="ui-preview-main"><h1 className="ui-preview-title">{current ? current[lang === "zh" ? 1 : 2] : "UI Preview"}</h1>
      <Routes>
        <Route path="/" element={<Navigate to="/proc-quote-book" replace />} />
        <Route path="/proc-quote-book" element={<QuoteBookPage />} />
        <Route path="/proc-people-management" element={<ProcPeopleManagementPage />} />
        <Route path="/proc-my-workspace" element={<ProcMyWorkspacePage />} />
        <Route path="/preview-dialogs" element={<DialogPreviews />} />
        <Route path="/preview-import" element={<ImportPreview />} />
        <Route path="*" element={<section className="ui-preview-panel"><p>{lang === "zh" ? "该页面未纳入本地验收沙箱，请使用上方页面入口。" : "This route is outside the preview. Use the navigation above."}</p></section>} />
      </Routes>
    </main><Toaster richColors />
  </div>;
}

createRoot(document.getElementById("root")!).render(<BrowserRouter><TooltipProvider><PreviewApp /></TooltipProvider></BrowserRouter>);
