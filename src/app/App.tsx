import React, { Suspense, useEffect, useState } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { materialTheme } from "../styles/materialTheme";
import { AuthProvider, useAuth } from "./auth";
import { hasPermission } from "./lib/permissions";
import { isMobileViewport } from "./lib/mobileRouting";
import { DEPT_KBS, routePermissionMap } from "./routesConfig";

// 首屏即需，保持同步加载：登录页、首页、桌面外壳、移动外壳。
import { LoginPage } from "./LoginPage";
import { Dashboard } from "./Dashboard";
import { Root } from "./Root";
import { MobileLayout } from "./MobileShell";
import { MobileRDCockpit } from "./MobileRDCockpit";

/**
 * 路由级懒加载工具：把命名导出的页面组件包成 React.lazy 的 default 形态。
 * 每个页面拆成独立 chunk 按需加载，首屏主包不再吞下全部页面（含 1 万行的研发驾驶舱等）。
 */
function lazyNamed<M extends Record<string, unknown>, K extends keyof M>(
  loader: () => Promise<M>,
  name: K,
) {
  return React.lazy(async () => {
    const mod = await loader();
    return { default: mod[name] as unknown as React.ComponentType<Record<string, unknown>> };
  });
}

const AfterSalesDetails = lazyNamed(() => import("./AfterSalesDetails"), "AfterSalesDetails");
const AfterSalesForm = lazyNamed(() => import("./AfterSalesForm"), "AfterSalesForm");
const AfterSalesList = lazyNamed(() => import("./AfterSalesList"), "AfterSalesList");
const AiModelManagementPage = lazyNamed(() => import("./AiModelManagementPage"), "AiModelManagementPage");
const AiUsageDashboardPage = lazyNamed(() => import("./AiUsageDashboardPage"), "AiUsageDashboardPage");
const ContentSlotsPage = lazyNamed(() => import("./ContentSlotsPage"), "ContentSlotsPage");
const ChatAnalyticsPage = lazyNamed(() => import("./ChatAnalyticsPage"), "ChatAnalyticsPage");
const MobileChatAnalyticsPage = lazyNamed(() => import("./MobileChatAnalyticsPage"), "MobileChatAnalyticsPage");
const I18nManagementPage = lazyNamed(() => import("./I18nManagementPage"), "I18nManagementPage");
const BOMArchive = lazyNamed(() => import("./BOMArchive"), "BOMArchive");
const BugLogPage = lazyNamed(() => import("./BugLogPage"), "BugLogPage");
const CustomsAI = lazyNamed(() => import("./CustomsAI"), "CustomsAI");
const CustomsDocs = lazyNamed(() => import("./CustomsDocs"), "CustomsDocs");
const DepartmentManagement = lazyNamed(() => import("./DepartmentManagement"), "DepartmentManagement");
const DesignChangesPage = lazyNamed(() => import("./DesignChangesPage"), "DesignChangesPage");
const DownloadTutorialPage = lazyNamed(() => import("./DownloadTutorialPage"), "DownloadTutorialPage");
const PlatformTutorialPage = lazyNamed(() => import("./DownloadTutorialPage"), "PlatformTutorialPage");
const ManualPage = lazyNamed(() => import("./ManualPage"), "ManualPage");
const ManualTopicPage = lazyNamed(() => import("./ManualPage"), "ManualTopicPage");
const EBPRPage = lazyNamed(() => import("./EBPRPage"), "EBPRPage");
const EmailAIPage = lazyNamed(() => import("./EmailAIPage"), "EmailAIPage");
const EmployeeArchivePage = lazyNamed(() => import("./EmployeeArchivePage"), "EmployeeArchivePage");
const ExpenseCenterPage = lazyNamed(() => import("./ExpenseCenterPage"), "ExpenseCenterPage");
const ExternalDocsPage = lazyNamed(() => import("./ExternalDocsPage"), "ExternalDocsPage");
const InspectionReleasePage = lazyNamed(() => import("./InspectionReleasePage"), "InspectionReleasePage");
const InquiryPage = lazyNamed(() => import("./InquiryPage"), "InquiryPage");
const MailboxManagementPage = lazyNamed(() => import("./MailboxManagementPage"), "MailboxManagementPage");
const MeetingMinutes = lazyNamed(() => import("./MeetingMinutes"), "MeetingMinutes");
const OcrConfigManagementPage = lazyNamed(() => import("./OcrConfigManagementPage"), "OcrConfigManagementPage");
const MessageCenterPage = lazyNamed(() => import("./MessageCenterPage"), "MessageCenterPage");
const OpsCenterPage = lazyNamed(() => import("./OpsCenterPage"), "OpsCenterPage");
const InventoryManagementPage = lazyNamed(() => import("./order-processing"), "InventoryManagementPage");
const OrderWorkbenchPage = lazyNamed(() => import("./order-processing"), "OrderWorkbenchPage");
const PurchaseOrderDetailPage = lazyNamed(() => import("./order-processing"), "PurchaseOrderDetailPage");
const PurchaseOrdersPage = lazyNamed(() => import("./order-processing"), "PurchaseOrdersPage");
// 采购管理（静态流程页面）
const ProcurementCockpitPage = lazyNamed(() => import("./procurement"), "ProcurementCockpitPage");
const ProcCategoryDetailPage = lazyNamed(() => import("./procurement"), "ProcCategoryDetailPage");
const MaterialWorkbenchPage = lazyNamed(() => import("./procurement"), "MaterialWorkbenchPage");
const PersonalCenterPage = lazyNamed(() => import("./PersonalCenterPage"), "PersonalCenterPage");
const ContractReviewPage = lazyNamed(() => import("./ContractReviewPage"), "ContractReviewPage");
const QualityDMSPage = lazyNamed(() => import("./QualityDMSPage"), "QualityDMSPage");
const QATraceability = lazyNamed(() => import("./QATraceability"), "QATraceability");
const AttendancePage = lazyNamed(() => import("./AttendancePage"), "AttendancePage");
const RAKnowledgePage = lazyNamed(() => import("./RAKnowledgePage"), "RAKnowledgePage");
const RDIssues = lazyNamed(() => import("./RDIssues"), "RDIssues");
const IssueAiModule = lazyNamed(() => import("./IssueAiModule"), "IssueAiModule");
const RegistrationProjects = lazyNamed(() => import("./RegistrationProjects"), "RegistrationProjects");
const ReportCompressionPage = lazyNamed(() => import("./ReportCompressionPage"), "ReportCompressionPage");
const ResumeScreeningPage = lazyNamed(() => import("./ResumeScreeningPage"), "ResumeScreeningPage");
const RoleManagement = lazyNamed(() => import("./RoleManagement"), "RoleManagement");
const RDTaskManagementPage = lazyNamed(() => import("./RDTaskManagementPage"), "RDTaskManagementPage");
const RDMyWorkspacePage = lazyNamed(() => import("./RDMyWorkspacePage"), "RDMyWorkspacePage");
const UsCollabTaskDetailPage = React.lazy(() => import("./UsCollabTaskDetailPage"));
const RDTaskDetailPage = React.lazy(() => import("./RDTaskDetailPage"));
const RDKnowledgeBasePage = lazyNamed(() => import("./RDKnowledgeBasePage"), "RDKnowledgeBasePage");
const RDPeopleManagementPage = lazyNamed(() => import("./RDPeopleManagementPage"), "RDPeopleManagementPage");
const RDDirectorDashboardPage = lazyNamed(() => import("./RDDirectorDashboardPage"), "RDDirectorDashboardPage");
const RDApprovalFlowPage = lazyNamed(() => import("./RDApprovalFlowPage"), "RDApprovalFlowPage");
const RDAuditLogPage = lazyNamed(() => import("./RDAuditLogPage"), "RDAuditLogPage");
const RDAiSettingsPage = lazyNamed(() => import("./RDAiSettingsPage"), "RDAiSettingsPage");
const RDSheetPage = lazyNamed(() => import("./RDSheetPage"), "RDSheetPage");
const RouteManagementPage = lazyNamed(() => import("./RouteManagementPage"), "RouteManagementPage");
const UIDesignPage = lazyNamed(() => import("./UIDesignPage"), "UIDesignPage");
const ImageLibraryPage = lazyNamed(() => import("./ImageLibraryPage"), "ImageLibraryPage");
const VideoLibraryPage = lazyNamed(() => import("./VideoLibraryPage"), "VideoLibraryPage");
const DictionaryList = lazyNamed(() => import("./DictionaryList"), "DictionaryList");
const UserManagement = lazyNamed(() => import("./UserManagement"), "UserManagement");

type RuntimeHealthResponse = {
  ok: boolean;
  service?: string;
  timestamp?: string;
  release?: string;
  git_sha?: string;
  started_at?: string;
};

const FRONTEND_RELEASE = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "dev";
const FRONTEND_GIT_SHA = (import.meta.env.VITE_GIT_SHA as string | undefined) ?? "unknown";
const RUNTIME_VERSION_NOTICE_KEY = "inogi-runtime-version-warning";
const NEW_VERSION_TOAST_ID = "inogi-new-version-available";
const RUNTIME_VERSION_POLL_MS = 60_000;

function RuntimeVersionGuard() {
  useEffect(() => {
    if (!import.meta.env.PROD || typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    async function checkRuntimeVersion() {
      try {
        const response = await fetch("/api/health", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as RuntimeHealthResponse;
        if (cancelled) {
          return;
        }

        const backendRelease = payload.release ?? "unknown";
        const backendGitSha = payload.git_sha ?? "unknown";
        const hasComparableVersion =
          backendGitSha !== "unknown" &&
          FRONTEND_GIT_SHA !== "unknown" &&
          backendRelease !== "unknown" &&
          FRONTEND_RELEASE !== "dev";

        if (!hasComparableVersion) {
          return;
        }

        const sameRelease = backendRelease === FRONTEND_RELEASE;
        const sameCommit = backendGitSha === FRONTEND_GIT_SHA;
        if (sameRelease && sameCommit) {
          // 已是最新：清掉残留的提示与去重标记。
          sessionStorage.removeItem(RUNTIME_VERSION_NOTICE_KEY);
          toast.dismiss(NEW_VERSION_TOAST_ID);
          return;
        }

        // 当前页面加载的前端版本与服务端已部署版本不一致 —— 原子部署下即「有新版本」。
        // 同一个目标版本只提示一次，避免轮询反复打扰。
        const noticeKey = `${backendRelease}:${backendGitSha}`;
        if (sessionStorage.getItem(RUNTIME_VERSION_NOTICE_KEY) === noticeKey) {
          return;
        }
        sessionStorage.setItem(RUNTIME_VERSION_NOTICE_KEY, noticeKey);

        toast.info("发现新版本，点击刷新即可升级到最新功能", {
          id: NEW_VERSION_TOAST_ID,
          duration: Infinity,
          action: {
            label: "刷新",
            onClick: () => window.location.reload(),
          },
        });
      } catch {
        // 版本探测失败不应影响应用本身。
      }
    }

    void checkRuntimeVersion();

    // 长时间开着的页面：定时轮询 + 切回标签页/窗口聚焦时再查，确保能及时发现新版本。
    const intervalId = window.setInterval(() => {
      void checkRuntimeVersion();
    }, RUNTIME_VERSION_POLL_MS);

    const handleForeground = () => {
      if (document.visibilityState === "visible") {
        void checkRuntimeVersion();
      }
    };
    document.addEventListener("visibilitychange", handleForeground);
    window.addEventListener("focus", handleForeground);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleForeground);
      window.removeEventListener("focus", handleForeground);
    };
  }, []);

  return null;
}

/**
 * 响应式跟踪是否移动视口：监听 resize，使「桌面浏览器缩放 / 设备模拟器切换 / 横竖屏旋转」
 * 也能即时触发 L2 跳转。纯同步判断只在首屏算一次，切换尺寸不刷新就不会跳，故这里用状态化。
 */
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    const onResize = () => setMobile(isMobileViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

function ProtectedLayout() {
  const { user, hydrated } = useAuth();
  const location = useLocation();
  const isMobile = useIsMobileViewport();

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        正在恢复登录状态...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  // L2 自动跳：移动视口直接进入移动只读视图。
  // 已移除「切换到电脑版」偏好开关——领导用手机即看移动版；如需桌面版改用宽屏访问。
  // 工作区感知：协同路由（/us-collab-*）跳协同移动端，其余跳研发移动端——否则协同用户
  // 会被甩到研发池的移动驾驶舱（数据完全对不上）。
  if (isMobile) {
    const target = location.pathname === "/chat-analytics"
      ? "/m/chat-analytics"
      : location.pathname.startsWith("/us-collab") ? "/us-collab-m" : "/m";
    return <Navigate to={target} replace />;
  }

  return <Root />;
}

/** Guards a route by permission. Redirects to "/" when access is denied. */
function PermissionRoute({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  if (user && !hasPermission(user.permissions, permission)) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
        <div className="text-4xl">🔒</div>
        <p className="text-base font-medium">您没有访问此页面的权限</p>
        <p className="text-sm text-slate-400">如需开通，请联系系统管理员</p>
      </div>
    );
  }
  return <>{children}</>;
}

function makeProtected(component: React.ReactNode, permission: string) {
  return <PermissionRoute permission={permission}>{component}</PermissionRoute>;
}

/** Lightweight fallback while a lazy route chunk loads. */
function PageLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
      正在加载页面…
    </div>
  );
}

/** Like makeProtected, but wraps the (lazy) element in Suspense. */
function makeLazyProtected(component: React.ReactNode, permission: string) {
  return makeProtected(
    <Suspense fallback={<PageLoadingFallback />}>{component}</Suspense>,
    permission,
  );
}

/** 仅包 Suspense（无权限门）的懒加载包装：用于 profile / message-center 这类任意登录用户可访问的页面。 */
function lazyWrap(node: React.ReactNode) {
  return <Suspense fallback={<PageLoadingFallback />}>{node}</Suspense>;
}

const router = createBrowserRouter([
  { path: "/login", Component: LoginPage },
  {
    path: "/",
    Component: ProtectedLayout,
    children: [
      { index: true, element: makeProtected(<Dashboard />, routePermissionMap["/"] ?? "page:dashboard") },
      { path: "profile", element: lazyWrap(<PersonalCenterPage />) },
      { path: "message-center", element: lazyWrap(<MessageCenterPage />) },
      { path: "after-sales", element: makeLazyProtected(<AfterSalesList />, "page:after-sales") },
      { path: "after-sales/new", element: makeLazyProtected(<AfterSalesForm />, "page:after-sales") },
      { path: "after-sales/:id", element: makeLazyProtected(<AfterSalesDetails />, "page:after-sales") },
      // ⚠️ 跨工作区共用组件的路由必须带 key：React 对同类型组件在路由切换时会复用实例
      // （不重挂载、不重跑 effect），协同页的任务/人员 state 会原样留在研发页上——数据串池。
      // key 强制两个工作区各自独立实例，切换即重挂载重拉数据。
      { path: "rd-task-management", element: makeLazyProtected(<RDTaskManagementPage key="ws-rd" />, "page:rd-task-management") },
      { path: "issue-ai", element: makeLazyProtected(<IssueAiModule />, "page:issue-ai") },
      { path: "rd-people-management", element: makeLazyProtected(<RDPeopleManagementPage key="ws-rd" onBack={() => window.history.back()} />, "rd-people:manage") },
      { path: "rd-my-workspace", element: makeLazyProtected(<RDMyWorkspacePage key="ws-rd" />, "page:rd-my-workspace") },
      { path: "rd-sheet", element: makeLazyProtected(<RDSheetPage />, "page:rd-sheet") },
      { path: "rd-knowledge-base", element: makeLazyProtected(<RDKnowledgeBasePage key="kb-rd" />, "page:rd-knowledge-base") },
      // 部门知识库：8 个部门各一条路由，复用 RDKnowledgeBasePage（kbScope 切到部门库）
      ...DEPT_KBS.map((d) => ({
        path: `dept-kb/${d.id}`,
        element: makeLazyProtected(<RDKnowledgeBasePage key={`kb-${d.id}`} kbScope={{ kbId: d.id, label: d.label }} />, `page:dept-kb-${d.id}`),
      })),
      // 中美协同：复用研发驾驶舱（隐藏子系统全景）/ 个人工作台 / 知识库（独立 us-collab 库），独立权限码
      { path: "us-collab-cockpit", element: makeLazyProtected(<RDTaskManagementPage key="ws-us" hideSystemPanorama />, "page:us-collab-cockpit") },
      { path: "us-collab-workspace", element: makeLazyProtected(<RDMyWorkspacePage key="ws-us" />, "page:us-collab-workspace") },
      // 协同人员管理：路径保持 /us-collab 前缀，rdApi 据此路由到独立的协同人员池
      { path: "us-collab-people-management", element: makeLazyProtected(<RDPeopleManagementPage key="ws-us" onBack={() => window.history.back()} />, "rd-people:manage") },
      // 协同任务全屏详情（双栏）：页面内部按协同页面码任一做门禁，不进侧边栏
      { path: "us-collab-task/:taskId", element: lazyWrap(<UsCollabTaskDetailPage />) },
      // 研发任务全屏详情（双栏，协同同款范式的独立复刻）：路径无 /us-collab 前缀 → rdApi 落研发池；页面内部按研发驾驶舱页面码门禁
      { path: "rd-task/:taskId", element: lazyWrap(<RDTaskDetailPage />) },
      { path: "us-collab-kb", element: makeLazyProtected(<RDKnowledgeBasePage key="kb-us-collab" kbScope={{ kbId: "us-collab", label: "协同" }} />, "page:dept-kb-us-collab") },
      // 协同审批流 / 留痕 / AI 策略：与上面三行一样是研发页面的原样复用，隔离全靠 /us-collab 路径前缀
      // —— rdApi 据此给请求带 ?workspace=us-collab，后端把 rd.* 存储键改写成 rdws.us-collab.*。
      // key="ws-us" 强制与研发路由分离组件实例，避免两池间切换时残留上一池的状态。
      { path: "us-collab-approval-flow", element: makeLazyProtected(<RDApprovalFlowPage key="ws-us" />, "page:us-collab-approval-flow") },
      { path: "us-collab-audit-log", element: makeLazyProtected(<RDAuditLogPage key="ws-us" />, "page:us-collab-audit-log") },
      { path: "us-collab-ai-settings", element: makeLazyProtected(<RDAiSettingsPage key="ws-us" />, "page:us-collab-ai-settings") },
      // 研发主管驾驶舱 — 导航可见性由页面路由管理中的「导航」开关控制（默认隐藏）
      { path: "rd-director-dashboard", element: makeLazyProtected(<RDDirectorDashboardPage />, "page:rd-director-dashboard") },
      { path: "rd-approval-flow", element: makeLazyProtected(<RDApprovalFlowPage />, "page:rd-approval-flow") },
      { path: "rd-audit-log", element: makeLazyProtected(<RDAuditLogPage />, "page:rd-audit-log") },
      { path: "rd-ai-settings", element: makeLazyProtected(<RDAiSettingsPage />, "page:rd-ai-settings") },
      { path: "rd-triage", element: makeLazyProtected(<RDIssues />, "page:rd-triage") },
      { path: "registration-projects", element: makeLazyProtected(<RegistrationProjects />, "page:registration-projects") },
      { path: "bom-archive", element: makeLazyProtected(<BOMArchive />, "page:bom-archive") },
      { path: "design-changes", element: makeLazyProtected(<DesignChangesPage />, "page:design-changes") },
      { path: "customs-ai", element: makeLazyProtected(<CustomsAI />, "page:customs-ai") },
      { path: "customs-docs", element: makeLazyProtected(<CustomsDocs />, "page:customs-docs") },
      { path: "external-docs", element: makeLazyProtected(<ExternalDocsPage />, "page:external-docs") },
      { path: "ra-knowledge", element: makeLazyProtected(<RAKnowledgePage />, "page:ra-knowledge") },
      { path: "quality-dms", element: makeLazyProtected(<QualityDMSPage />, "page:quality-dms") },
      { path: "qa-traceability", element: makeLazyProtected(<QATraceability />, "page:qa-traceability") },
      { path: "order-workbench", element: makeLazyProtected(<OrderWorkbenchPage />, "page:order-workbench") },
      { path: "purchase-orders", element: makeLazyProtected(<PurchaseOrdersPage />, "page:purchase-orders") },
      { path: "purchase-orders/:id", element: makeLazyProtected(<PurchaseOrderDetailPage />, "page:purchase-order-detail") },
      { path: "inventory-management", element: makeLazyProtected(<InventoryManagementPage />, "page:inventory-management") },
      { path: "proc-cockpit", element: makeLazyProtected(<ProcurementCockpitPage />, "page:proc-cockpit") },
      // 采购分类详情二级页：注册路由与权限，但不进侧边栏菜单（routesConfig 未收录即不显示）
      { path: "proc-category", element: makeLazyProtected(<ProcCategoryDetailPage />, "page:proc-category") },
      { path: "proc-materials", element: makeLazyProtected(<MaterialWorkbenchPage />, "page:proc-materials") },
      { path: "resume-screening", element: makeLazyProtected(<ResumeScreeningPage />, "page:resume-screening") },
      { path: "employee-archive", element: makeLazyProtected(<EmployeeArchivePage />, "page:employee-archive") },
      { path: "attendance", element: makeLazyProtected(<AttendancePage />, "page:quick-capture") },
      { path: "quick-capture", element: makeLazyProtected(<Navigate to="/attendance" replace />, "page:quick-capture") },
      { path: "expense-center", element: makeLazyProtected(<ExpenseCenterPage />, "page:expense-center") },
      { path: "ebpr", element: makeLazyProtected(<EBPRPage />, "page:ebpr") },
      { path: "inspection-release", element: makeLazyProtected(<InspectionReleasePage />, "page:inspection-release") },
      { path: "bug-log", element: makeLazyProtected(<BugLogPage />, "page:bug-log") },
      { path: "contract-review", element: makeLazyProtected(<ContractReviewPage />, "page:contract-review") },
      { path: "mailbox-management", element: makeLazyProtected(<MailboxManagementPage />, "page:mailbox-management") },
      { path: "ai-model-management", element: makeLazyProtected(<AiModelManagementPage />, "page:ai-model-management") },
      { path: "ai-usage", element: makeLazyProtected(<AiUsageDashboardPage />, "page:ai-usage-dashboard") },
      { path: "content-slots", element: makeLazyProtected(<ContentSlotsPage />, "page:content-slots") },
      { path: "chat-analytics", element: makeLazyProtected(<ChatAnalyticsPage />, "page:chat-analytics") },
      { path: "i18n-management", element: makeLazyProtected(<I18nManagementPage />, "i18n:manage") },
      { path: "ocr-config-management", element: makeLazyProtected(<OcrConfigManagementPage />, "page:ocr-config-management") },
      { path: "ops-center", element: makeLazyProtected(<OpsCenterPage section="overview" />, "page:ops-center") },
      { path: "ops-center/api-errors", element: makeLazyProtected(<OpsCenterPage section="api-errors" />, "page:ops-api-errors") },
      { path: "ops-center/database", element: makeLazyProtected(<OpsCenterPage section="database" />, "page:ops-database") },
      { path: "ops-center/services-tasks", element: makeLazyProtected(<OpsCenterPage section="services-tasks" />, "page:ops-services-tasks") },
      { path: "ops-center/alerts-audit", element: makeLazyProtected(<OpsCenterPage section="alerts-audit" />, "page:ops-alerts-audit") },
      { path: "inquiry", element: makeLazyProtected(<InquiryPage />, "page:inquiry") },
      { path: "meeting", element: makeLazyProtected(<MeetingMinutes />, "page:meeting") },
      { path: "email-ai", element: makeLazyProtected(<EmailAIPage />, "page:email-ai") },
      { path: "report-compression", element: makeLazyProtected(<ReportCompressionPage />, "page:report-compression") },
      { path: "downloads", element: makeLazyProtected(<DownloadTutorialPage />, "page:downloads") },
      { path: "downloads/:platformId", element: makeLazyProtected(<PlatformTutorialPage />, "page:downloads") },
      // 操作手册：索引 + 分主题详情（同 downloads 的两级范式），详情页不进侧边栏
      { path: "manual", element: makeLazyProtected(<ManualPage />, "page:manual") },
      { path: "manual/:topicId", element: makeLazyProtected(<ManualTopicPage />, "page:manual") },
      { path: "departments", element: makeLazyProtected(<DepartmentManagement />, "page:departments") },
      { path: "users", element: makeLazyProtected(<UserManagement />, "page:users") },
      { path: "roles", element: makeLazyProtected(<RoleManagement />, "page:roles") },
      { path: "route-management", element: makeLazyProtected(<RouteManagementPage />, "page:route-management") },
      { path: "settings", element: makeLazyProtected(<DictionaryList />, "page:settings") },
      { path: "ui-design", element: makeLazyProtected(<UIDesignPage />, "page:ui-design") },
      { path: "image-library", element: makeLazyProtected(<ImageLibraryPage />, "page:image-library") },
      { path: "video-library", element: makeLazyProtected(<VideoLibraryPage />, "page:video-library") },
      { path: "*", Component: () => <Navigate to="/" replace /> },
    ],
  },
  {
    // 移动端独立路由树：自带鉴权外壳，不复用桌面 Root（其写死 min-w-1024 + 侧边栏）。
    // L1 直达：领导可直接访问 /m（书签 / 二维码 / IM 卡片）。
    path: "/m",
    Component: MobileLayout,
    children: [
      { index: true, element: <MobileRDCockpit /> },
      { path: "chat-analytics", element: makeLazyProtected(<MobileChatAnalyticsPage />, "page:chat-analytics") },
      { path: "*", element: <Navigate to="/m" replace /> },
    ],
  },
  {
    // 协同移动端：完整复用研发移动驾驶舱组件。路由必须以 /us-collab 开头——
    // rdApi 按该前缀自动给所有请求带 ?workspace=us-collab，数据即协同池，组件零改动。
    path: "/us-collab-m",
    Component: MobileLayout,
    children: [
      { index: true, element: <MobileRDCockpit /> },
      { path: "*", element: <Navigate to="/us-collab-m" replace /> },
    ],
  },
]);

/**
 * 应用级错误边界：捕获渲染期未处理异常，渲染可恢复的兜底页，避免整屏白屏且生产无诊断。
 * （React 错误边界必须是 class 组件。）
 */
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 先打印，杜绝静默白屏无线索；后续可在此接入错误上报（Sentry 等）。
    console.error("[AppErrorBoundary] 未捕获的渲染错误:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center text-slate-600">
          <div className="text-5xl">😵</div>
          <p className="text-lg font-medium text-slate-800">页面出错了</p>
          <p className="max-w-md text-sm text-slate-500">
            遇到了一个未预期的错误，刷新通常即可恢复。如反复出现请联系系统管理员。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 全局兜底：捕获 React 树之外的未处理错误与 Promise 拒绝，确保至少有诊断日志。 */
function GlobalErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      console.error("[window.onerror]", e.error ?? e.message);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      console.error("[unhandledrejection]", e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

export default function App() {
  return (
    <ThemeProvider theme={materialTheme}>
      <CssBaseline />
      <AppErrorBoundary>
        <AuthProvider>
          <GlobalErrorListener />
          <RuntimeVersionGuard />
          <RouterProvider router={router} />
        </AuthProvider>
      </AppErrorBoundary>
    </ThemeProvider>
  );
}
