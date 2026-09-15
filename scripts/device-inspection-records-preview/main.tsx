import { createRoot } from "react-dom/client";
import { Activity, Bell, Bot, ChevronDown, ClipboardList, Database, FileSearch, Globe, Languages, Mail, MonitorCog, Search, Settings, ShieldCheck, Users, UserRound } from "lucide-react";
import { Toaster } from "sonner";
import { DeviceInspectionRecordsPage } from "../../src/app/DeviceInspectionRecordsPage";
import { previewApi } from "./preview-api";
import logo from "../../src/assets/logo.png";
import "../../src/styles/index.css";
import "./preview.css";
const nav = [[ShieldCheck, "电子闸门"], [ClipboardList, "设备检测记录"], [Mail, "邮箱管理"], [Bot, "AI 模型管理"], [Activity, "AI 使用情况"], [Globe, "运营素材管理"], [Bot, "AI 使用与反馈"], [Languages, "翻译管理"], [FileSearch, "腾讯 OCR 配置"], [Users, "部门管理"], [Users, "用户管理"], [ShieldCheck, "操作留痕"], [MonitorCog, "页面路由管理"], [ClipboardList, "字典列表"]] as const;
function Preview() {
  return <div className="dir-preview-shell"><aside className="dir-preview-sidebar"><div className="dir-preview-brand"><img src={logo} alt="INOGI" /><span><strong>INOGI AI</strong><small>Office Console</small></span></div><div className="dir-preview-nav">{([[Activity, "运维总览"], [Settings, "接口与错误"], [Database, "数据库监控"], [Bot, "服务与任务"], [ShieldCheck, "告警与审计设置"]] as const).map(([Icon, label]) => <div className="dir-preview-nav-item" key={String(label)}><Icon size={18} /><span>{String(label)}</span></div>)}<div className="dir-preview-nav-title">系统管理<ChevronDown size={14} /></div>{nav.map(([Icon, label]) => <div key={label} className={`dir-preview-nav-item${label === "设备检测记录" ? " dir-preview-active" : ""}`}><Icon size={18} /><span>{label}</span></div>)}</div></aside><div className="dir-preview-workspace"><header className="dir-preview-header"><div><nav>首页 / 系统管理 / <strong>设备检测记录</strong></nav><h1>设备检测记录</h1></div><div className="dir-preview-meta"><span className="dir-preview-search"><Search size={16} />搜索页面</span><time>{new Date().toLocaleDateString("zh-CN")}　周四</time><Bell size={20} /><UserRound size={28} /><strong>超级管理员</strong><ChevronDown size={14} /></div></header><main><DeviceInspectionRecordsPage api={previewApi} demo /></main></div><Toaster richColors position="top-right" /></div>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Preview />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
