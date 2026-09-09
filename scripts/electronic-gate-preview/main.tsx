import { createRoot } from "react-dom/client";
import { ChevronDown, ClipboardList, FileText, LayoutGrid, LockKeyhole, Settings, ShieldCheck, UserRound } from "lucide-react";
import { Toaster } from "sonner";
import { ElectronicGatePage } from "../../src/app/ElectronicGatePage";
import logo from "../../src/assets/logo.png";
import { previewApi } from "./preview-api";
import { previewFactoryQcApi } from "./factory-qc-preview-api";
import "../../src/styles/index.css";
import "./preview.css";

const sections = ["供应链管理", "研发任务管理", "中美协同"];

function PreviewApp() {
  const today = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date());
  return <div className="eg-preview-shell">
    <aside className="eg-preview-sidebar" aria-label="系统导航预览">
      <a className="eg-preview-brand" href="/" aria-label="INOGI AI 电子闸门预览">
        <img src={logo} alt="壹诺吉" />
        <span><strong>INOGI AI</strong><small>Office Console</small></span>
      </a>
      <div className="eg-preview-navigation">
        <span className="eg-preview-nav-label">总览</span>
        <div className="eg-preview-nav-item"><LayoutGrid size={17} /><span>系统首页</span></div>
        {sections.map(title => <div className="eg-preview-section" key={title}><span>{title}</span><ChevronDown size={14} /></div>)}
        <div className="eg-preview-system"><Settings size={18} /><span>系统管理</span><ChevronDown size={14} /></div>
        <div className="eg-preview-subnav">
          <div className="eg-preview-nav-item"><UserRound size={17} /><span>用户管理</span></div>
          <div className="eg-preview-nav-item"><ShieldCheck size={17} /><span>角色权限</span></div>
          <a className="eg-preview-nav-item eg-preview-nav-item--current" href="/" aria-current="page"><LockKeyhole size={17} /><span>电子闸门</span></a>
          <div className="eg-preview-nav-item"><ClipboardList size={17} /><span>操作留痕</span></div>
          <div className="eg-preview-nav-item"><FileText size={17} /><span>字典列表</span></div>
        </div>
      </div>
      <footer className="eg-preview-sidebar-footer"><strong>INOGI AI</strong><div><span>Office Console</span><span>v1.0.0</span></div></footer>
    </aside>
    <div className="eg-preview-workspace">
      <header className="eg-preview-topbar">
        <div className="eg-preview-page-title"><nav className="eg-preview-breadcrumbs" aria-label="当前位置"><span>首页</span><span aria-hidden="true">/</span><strong>电子闸门</strong></nav><h1>电子闸门</h1></div>
        <div className="eg-preview-header-meta"><span className="eg-preview-notice">交互预览 · 示例数据不用于产线</span><time>{today}</time><span className="eg-preview-user"><span className="eg-preview-avatar"><UserRound size={17} /></span>管理员</span></div>
      </header>
      <main className="eg-preview-main"><ElectronicGatePage api={previewApi} factoryApi={previewFactoryQcApi} /></main>
    </div>
    <Toaster richColors position="top-right" />
  </div>;
}

createRoot(document.getElementById("root")!).render(<PreviewApp />);
