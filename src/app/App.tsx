import React, { Suspense, useEffect, useState } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createBrowserRouter, matchPath, Navigate, RouterProvider, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { materialTheme } from "../styles/materialTheme";
import { AuthProvider, useAuth } from "./auth";
import { hasAnyPermission, hasPermission } from "./lib/permissions";
import { isMobileViewport } from "./lib/mobileRouting";
import { rdWorkspaceForPath } from "./lib/rdWorkspace";
import { procurementWorkspaceReturnPath } from "./lib/procurementWorkspaceNavigation";
import { DEPT_KBS, routePermissionMap } from "./routesConfig";
// 路径解析：页面挂载路径以「页面路由管理」的配置为准，目录不可用时回退内置默认值
import { asChildPath, routePath, subRoutePath } from "./lib/routePaths";

// 首屏即需，保持同步加载：登录页、桌面外壳、移动外壳。
import { LoginPage } from "./LoginPage";
import { Root } from "./Root";
import { MobileLayout } from "./MobileShell";

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
const Dashboard = lazyNamed(() => import("./Dashboard"), "Dashboard");
const AfterSalesForm = lazyNamed(() => import("./AfterSalesForm"), "AfterSalesForm");
const AfterSalesList = lazyNamed(() => import("./AfterSalesList"), "AfterSalesList");
const AiModelManagementPage = lazyNamed(() => import("./AiModelManagementPage"), "AiModelManagementPage");
const AiUsageDashboardPage = lazyNamed(() => import("./AiUsageDashboardPage"), "AiUsageDashboardPage");
const ContentSlotsPage = lazyNamed(() => import("./ContentSlotsPage"), "ContentSlotsPage");
const ElectronicGatePage = lazyNamed(() => import("./ElectronicGatePage"), "ElectronicGatePage");
const DeviceInspectionRecordsPage = lazyNamed(() => import("./DeviceInspectionRecordsPage"), "DeviceInspectionRecordsPage");
const ChatAnalyticsPage = lazyNamed(() => import("./ChatAnalyticsPage"), "ChatAnalyticsPage");
const MobileChatAnalyticsPage = lazyNamed(() => import("./MobileChatAnalyticsPage"), "MobileChatAnalyticsPage");
const MobileRDCockpit = lazyNamed(() => import("./MobileRDCockpit"), "MobileRDCockpit");
const MobileProcSampleTestPage = lazyNamed(() => import("./MobileProcSampleTestPage"), "MobileProcSampleTestPage");
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
const ApplicantFormsPage = lazyNamed(() => import("./ApplicantFormsPage"), "ApplicantFormsPage");
const PublicApplicantFormPage = lazyNamed(() => import("./applicant-forms/PublicApplicantFormPage"), "PublicApplicantFormPage");
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
// The unfinished warehouse workflow is available for frontend review only.
// It carries its own in-memory demonstration data and is excluded from production routes.
const ReceiptDispositionPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/ReceiptDispositionPreviewPage"), "ReceiptDispositionPreviewPage")
  : null;
const QualityExceptionsPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/quality/QualityExceptionsPreviewPage"), "QualityExceptionsPreviewPage")
  : null;
const WarehousePreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/warehouse/WarehousePreviewPage"), "WarehousePreviewPage")
  : null;
const ShipmentPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/shipments/ShipmentPreviewPage"), "ShipmentPreviewPage")
  : null;
const BatchArchivePreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/batch-archives/BatchArchivePreviewPage"), "BatchArchivePreviewPage")
  : null;
const EcnPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/ecn/EcnPreviewPage"), "EcnPreviewPage")
  : null;
const PlanningPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/planning/PlanningPreviewPage"), "PlanningPreviewPage")
  : null;
const DefectPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/defects/DefectPreviewPage"), "DefectPreviewPage")
  : null;
const ProductionRdPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/rd-collaboration/ProductionRdPreviewPage"), "ProductionRdPreviewPage")
  : null;
const TransferPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/transfer/TransferPreviewPage"), "TransferPreviewPage")
  : null;
const ProductionOverviewPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/overview/ProductionOverviewPreviewPage"), "ProductionOverviewPreviewPage")
  : null;
const ProductionTasksPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/overview/ProductionTasksPreviewPage"), "ProductionTasksPreviewPage")
  : null;
const InspectionPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/inspections/InspectionPreviewPage"), "InspectionPreviewPage")
  : null;
const FieldPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./production/field-tasks/FieldPreviewPage"), "FieldPreviewPage")
  : null;
const PreviewIndexPage = import.meta.env.DEV
  ? lazyNamed(() => import("./preview/PreviewIndexPage"), "PreviewIndexPage")
  : null;
const MonthlyReadinessPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/monthly-readiness/MonthlyReadinessPreviewPage"), "MonthlyReadinessPreviewPage")
  : null;
const KeyMaterialsPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./procurement/key-materials/KeyMaterialsPreviewPage"), "KeyMaterialsPreviewPage")
  : null;
const CompanyOverviewPreviewPage = import.meta.env.DEV
  ? lazyNamed(() => import("./company-overview/CompanyOverviewPreviewPage"), "CompanyOverviewPreviewPage")
  : null;
// 采购管理（静态流程页面）
const ProcurementCockpitPage = lazyNamed(() => import("./procurement"), "ProcurementCockpitPage");
const ProcMyWorkspacePage = lazyNamed(() => import("./procurement"), "ProcMyWorkspacePage");
const MaterialWorkbenchPage = lazyNamed(() => import("./procurement"), "MaterialWorkbenchPage");
const KeyMaterialsPage = lazyNamed(() => import("./procurement/key-materials/KeyMaterialsPage"), "KeyMaterialsPage");
const ProductionDashboardPage = lazyNamed(() => import("./production/execution/ProductionDashboardPage"), "ProductionDashboardPage");
function ProductionDashboardRoute() { const location = useLocation(); return new URLSearchParams(location.search).get("view") === "legacy" ? <RDTaskManagementPage key="ws-production" /> : <ProductionDashboardPage />; }
const ProductionExecutionPage = lazyNamed(() => import("./production/execution/ProductionExecutionPage"), "ProductionExecutionPage");
const WarehouseFlowPage = lazyNamed(() => import("./procurement/WarehouseFlowPage"), "WarehouseFlowPage");
const InventoryReadinessPage = lazyNamed(() => import("./procurement"), "InventoryReadinessPage");
const QuoteBookPage = lazyNamed(() => import("./procurement"), "QuoteBookPage");
const ProcPeopleManagementPage = lazyNamed(() => import("./procurement"), "ProcPeopleManagementPage");
const OperationalTasksPage = lazyNamed(() => import("./procurement/people/OperationalTasksPage"), "OperationalTasksPage");
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
const RDDiscussionInvitePage = React.lazy(() => import("./RDDiscussionInvitePage"));
const RDKnowledgeBasePage = lazyNamed(() => import("./RDKnowledgeBasePage"), "RDKnowledgeBasePage");
const KnowledgeBaseEntryPage = lazyNamed(() => import("./KnowledgeBaseEntryPage"), "KnowledgeBaseEntryPage");
/** 有任意一个知识库页面码就能进统一入口，页面内部再按权限决定能切哪些库。 */
const KB_PAGE_PERMISSIONS = [
  ...DEPT_KBS.map((item) => `page:dept-kb-${item.id}`),
  "page:rd-knowledge-base",
];
const RDPeopleManagementPage = lazyNamed(() => import("./RDPeopleManagementPage"), "RDPeopleManagementPage");
const RDApprovalFlowPage = lazyNamed(() => import("./RDApprovalFlowPage"), "RDApprovalFlowPage");
const AuditLogPage = lazyNamed(() => import("./AuditLogPage"), "AuditLogPage");
const RDAiSettingsPage = lazyNamed(() => import("./RDAiSettingsPage"), "RDAiSettingsPage");
const RDSheetPage = lazyNamed(() => import("./RDSheetPage"), "RDSheetPage");
const RouteManagementPage = lazyNamed(() => import("./RouteManagementPage"), "RouteManagementPage");
const UIDesignPage = lazyNamed(() => import("./UIDesignPage"), "UIDesignPage");
const ImageLibraryPage = lazyNamed(() => import("./ImageLibraryPage"), "ImageLibraryPage");
const VideoLibraryPage = lazyNamed(() => import("./VideoLibraryPage"), "VideoLibraryPage");
const DictionaryList = lazyNamed(() => import("./DictionaryList"), "DictionaryList");
const UserManagement = lazyNamed(() => import("./UserManagement"), "UserManagement");

type RuntimeFrontendVersion = {
  release?: string;
  git_sha?: string;
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
        const response = await fetch("/version.json", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as RuntimeFrontendVersion;
        if (cancelled) {
          return;
        }

        const deployedFrontendRelease = payload.release ?? "unknown";
        const deployedFrontendGitSha = payload.git_sha ?? "unknown";
        const hasComparableVersion =
          deployedFrontendGitSha !== "unknown" &&
          FRONTEND_GIT_SHA !== "unknown" &&
          deployedFrontendRelease !== "unknown" &&
          FRONTEND_RELEASE !== "dev";

        if (!hasComparableVersion) {
          return;
        }

        const sameRelease = deployedFrontendRelease === FRONTEND_RELEASE;
        const sameCommit = deployedFrontendGitSha === FRONTEND_GIT_SHA;
        if (sameRelease && sameCommit) {
          // 已是最新：清掉残留的提示与去重标记。
          sessionStorage.removeItem(RUNTIME_VERSION_NOTICE_KEY);
          toast.dismiss(NEW_VERSION_TOAST_ID);
          return;
        }

        // 当前页面加载的前端版本与服务端已部署版本不一致 —— 原子部署下即「有新版本」。
        // 同一个目标版本只提示一次，避免轮询反复打扰。
        const noticeKey = `${deployedFrontendRelease}:${deployedFrontendGitSha}`;
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

const MOBILE_VIEWPORT_DEBOUNCE_MS = 250;

/**
 * 响应式跟踪是否移动视口：首屏同步判断，后续 resize 停止 250ms 后再更新。
 * 拖拽分屏或跨显示器时会产生密集的中间宽度，防抖可避免短暂越过 768px 就切换整套路由。
 */
function useIsMobileViewport() {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    let resizeTimer: number | undefined;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        setMobile(isMobileViewport());
      }, MOBILE_VIEWPORT_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return mobile;
}

function desktopTargetFromMobileLocation(
  pathname: string,
  search: string,
  hash: string,
) {
  const suffix = `${search}${hash}`;
  const taskMatch = pathname.match(/^\/(m|us-collab-m|production-m)\/task\/([^/]+)$/);
  const discussionMatch = pathname.match(/^\/(us-collab-m|m)\/discussion\/([^/]+)$/);

  if (taskMatch?.[1] === "us-collab-m") {
    return `/us-collab-task/${encodeURIComponent(taskMatch[2])}${suffix}`;
  }
  if (taskMatch?.[1] === "production-m") {
    return `/production-task/${encodeURIComponent(taskMatch[2])}${suffix}`;
  }
  if (taskMatch) {
    return `/rd-task/${encodeURIComponent(taskMatch[2])}${suffix}`;
  }

  if (discussionMatch?.[1] === "us-collab-m") {
    return `/us-collab-rd-discussion/${encodeURIComponent(discussionMatch[2])}${suffix}`;
  }
  if (discussionMatch) {
    return `/rd-discussion/${encodeURIComponent(discussionMatch[2])}${suffix}`;
  }
  if (pathname.startsWith(`/m${routePath("page:chat-analytics", "/chat-analytics")}`)) {
    return `${routePath("page:chat-analytics", "/chat-analytics")}${suffix}`;
  }
  if (pathname.startsWith("/us-collab-m")) {
    return `${routePath("page:us-collab-cockpit", "/us-collab-cockpit")}${suffix}`;
  }
  if (pathname.startsWith("/production-m")) {
    return `/production-dashboard${suffix}`;
  }
  return `${routePath("page:rd-task-management", "/rd-task-management")}${suffix}`;
}

/** 移动路由的宽屏守卫：恢复到桌面宽度后回到同工作区、同业务页面。 */
function ResponsiveMobileLayout() {
  const location = useLocation();
  const isMobile = useIsMobileViewport();

  if (!isMobile) {
    const desktopTarget = desktopTargetFromMobileLocation(
      location.pathname,
      location.search,
      location.hash,
    );
    return <Navigate to={desktopTarget} replace />;
  }

  return <MobileLayout />;
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

  // 行政登记页自身适配窄屏；不转到无关的研发移动驾驶舱。
  if (location.pathname === routePath("page:applicant-forms", "/applicant-forms")) return <Root />;

  // 采购工作台及关联页自身支持窄屏，保留工作上下文和原路由权限检查。
  if (location.pathname === routePath("page:proc-my-workspace", "/proc-my-workspace")
    || location.pathname === "/proc-operational-tasks"
    || location.pathname === routePath("page:proc-cockpit", "/proc-cockpit")
    || location.pathname === routePath("page:proc-inventory-readiness", "/proc-inventory-readiness")
    || location.pathname === routePath("page:proc-materials", "/proc-materials")
    || location.pathname === routePath("page:proc-key-materials", "/proc-key-materials")
    || location.pathname === routePath("page:production-execution", "/production-execution")
    || location.pathname === routePath("page:warehouse-flow", "/warehouse-flow")
    || matchPath({ path: routePath("page:purchase-orders", "/purchase-orders"), end: true }, location.pathname)
    || matchPath({ path: subRoutePath("page:purchase-orders", "/purchase-orders", ":id"), end: true }, location.pathname)
    || (/^\/rd-task\/[^/]+$/.test(location.pathname) && procurementWorkspaceReturnPath(location.state))) return <Root />;

  // 样品测试人可能只有研发工作台权限；手机深链在当前地址完成测试，不跳只读驾驶舱。
  const sampleTestId = new URLSearchParams(location.search).get("sampleTest")?.trim();
  if (isMobile && location.pathname === routePath("page:rd-my-workspace", "/rd-my-workspace") && sampleTestId) {
    return makeLazyProtected(<MobileProcSampleTestPage key={`${user.id}:${sampleTestId}`} taskId={sampleTestId} />, "page:rd-my-workspace");
  }

  // L2 自动跳：移动视口直接进入移动只读视图。
  // 已移除「切换到电脑版」偏好开关——领导用手机即看移动版；如需桌面版改用宽屏访问。
  // 工作区感知：按当前路由配置识别协同页面并跳协同移动端——否则协同用户
  // 会被甩到研发池的移动驾驶舱（数据完全对不上）。
  if (isMobile) {
    const taskMatch = location.pathname.match(/^\/(rd-task|us-collab-task|production-task)\/([^/]+)$/);
    const discussionMatch = location.pathname.match(/^\/(us-collab-)?rd-discussion\/([^/]+)$/);
    const suffix = `${location.search}${location.hash}`;
    const taskMobileBase = taskMatch?.[1] === "us-collab-task"
      ? "/us-collab-m"
      : taskMatch?.[1] === "production-task"
        ? "/production-m"
        : "/m";
    const workspace = rdWorkspaceForPath(location.pathname);
    const workspaceMobileBase = workspace === "us-collab"
      ? "/us-collab-m"
      : workspace === "production" || location.pathname === "/rd-director-dashboard"
        ? "/production-m"
        : "/m";
    const target = taskMatch
      ? `${taskMobileBase}/task/${encodeURIComponent(taskMatch[2])}${suffix}`
      : discussionMatch
        ? `${discussionMatch[1] ? "/us-collab-m" : "/m"}/discussion/${encodeURIComponent(discussionMatch[2])}${suffix}`
        : location.pathname === routePath("page:chat-analytics", "/chat-analytics")
          ? `/m${routePath("page:chat-analytics", "/chat-analytics")}${suffix}`
          : `${workspaceMobileBase}${suffix}`;
    return <Navigate to={target} replace />;
  }

  return <Root />;
}

/** Guards a route by permission. Redirects to "/" when access is denied.
 *  permission 传数组表示「任一即可」——部门知识库合成单入口后，十几个 page:dept-kb-* 里
 *  有任意一个就该放行，具体能看哪个库由页面内部按权限筛选。 */
function PermissionRoute({
  permission,
  children,
}: {
  permission: string | string[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const allowed = Array.isArray(permission)
    ? hasAnyPermission(permissions, permission)
    : hasPermission(permissions, permission);
  if (user && !allowed) {
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

function makeProtected(component: React.ReactNode, permission: string | string[]) {
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
function makeLazyProtected(component: React.ReactNode, permission: string | string[]) {
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
  { path: "/apply/:slug", element: lazyWrap(<PublicApplicantFormPage />) },
  ...(PreviewIndexPage ? [{ path: "/__preview", element: lazyWrap(<PreviewIndexPage />) }] : []),
  ...(MonthlyReadinessPreviewPage ? [{ path: "/__preview/monthly-readiness", element: lazyWrap(<MonthlyReadinessPreviewPage />) }] : []),
  ...(KeyMaterialsPreviewPage ? [{ path: "/__preview/key-materials", element: lazyWrap(<KeyMaterialsPreviewPage />) }] : []),
  ...(CompanyOverviewPreviewPage ? [{ path: "/__preview/company-overview", element: lazyWrap(<CompanyOverviewPreviewPage />) }] : []),
  ...(ReceiptDispositionPreviewPage ? [{ path: "/__preview/receipt-disposition", element: lazyWrap(<ReceiptDispositionPreviewPage />) }] : []),
  ...(QualityExceptionsPreviewPage ? [{ path: "/__preview/quality-exceptions", element: lazyWrap(<QualityExceptionsPreviewPage />) }] : []),
  ...(WarehousePreviewPage ? [{ path: "/__preview/warehouse", element: lazyWrap(<WarehousePreviewPage />) }] : []),
  ...(ShipmentPreviewPage ? [{ path: "/__preview/shipments", element: lazyWrap(<ShipmentPreviewPage />) }] : []),
  ...(BatchArchivePreviewPage ? [{ path: "/__preview/batch-archives", element: lazyWrap(<BatchArchivePreviewPage />) }] : []),
  ...(EcnPreviewPage ? [{ path: "/__preview/ecn", element: lazyWrap(<EcnPreviewPage />) }] : []),
  ...(PlanningPreviewPage ? [{ path: "/__preview/production-planning", element: lazyWrap(<PlanningPreviewPage />) }] : []),
  ...(DefectPreviewPage ? [{ path: "/__preview/production-defects", element: lazyWrap(<DefectPreviewPage />) }] : []),
  ...(ProductionRdPreviewPage ? [{ path: "/__preview/production-rd", element: lazyWrap(<ProductionRdPreviewPage />) }] : []),
  ...(TransferPreviewPage ? [{ path: "/__preview/production-transfer", element: lazyWrap(<TransferPreviewPage />) }] : []),
  ...(ProductionOverviewPreviewPage ? [{ path: "/__preview/production-overview", element: lazyWrap(<ProductionOverviewPreviewPage />) }] : []),
  ...(ProductionTasksPreviewPage ? [{ path: "/__preview/production-tasks", element: lazyWrap(<ProductionTasksPreviewPage />) }] : []),
  ...(InspectionPreviewPage ? [{ path: "/__preview/production-inspections", element: lazyWrap(<InspectionPreviewPage />) }] : []),
  ...(FieldPreviewPage ? [{ path: "/__preview/field-tasks", element: lazyWrap(<FieldPreviewPage />) }] : []),
  {
    path: "/",
    Component: ProtectedLayout,
    children: [
      { index: true, element: makeLazyProtected(<Dashboard />, routePermissionMap["/"] ?? "page:dashboard") },
      { path: "profile", element: lazyWrap(<PersonalCenterPage />) },
      { path: "message-center", element: lazyWrap(<MessageCenterPage />) },
      { path: asChildPath(routePath("page:after-sales", "/after-sales")), element: makeLazyProtected(<AfterSalesList />, "page:after-sales") },
      { path: asChildPath(subRoutePath("page:after-sales", "/after-sales", "new")), element: makeLazyProtected(<AfterSalesForm />, "page:after-sales") },
      { path: asChildPath(subRoutePath("page:after-sales", "/after-sales", ":id")), element: makeLazyProtected(<AfterSalesDetails />, "page:after-sales") },
      // ⚠️ 跨工作区共用组件的路由必须带 key：React 对同类型组件在路由切换时会复用实例
      // （不重挂载、不重跑 effect），协同页的任务/人员 state 会原样留在研发页上——数据串池。
      // key 强制两个工作区各自独立实例，切换即重挂载重拉数据。
      { path: asChildPath(routePath("page:rd-task-management", "/rd-task-management")), element: makeLazyProtected(<RDTaskManagementPage key="ws-rd" />, "page:rd-task-management") },
      { path: asChildPath(routePath("page:issue-ai", "/issue-ai")), element: makeLazyProtected(<IssueAiModule />, "page:issue-ai") },
      // 由动作码 rd-people:manage 守卫（目录中为 action 类型、无 routePath），故路径保持硬编码
      { path: "rd-people-management", element: makeLazyProtected(<RDPeopleManagementPage key="ws-rd" visualVariant="rd-horizon" onBack={() => window.history.back()} />, "rd-people:manage") },
      { path: asChildPath(routePath("page:rd-my-workspace", "/rd-my-workspace")), element: makeLazyProtected(<RDMyWorkspacePage key="ws-rd" />, "page:rd-my-workspace") },
      { path: "rd-discussion/:taskId", element: lazyWrap(<RDDiscussionInvitePage />) },
      { path: asChildPath(routePath("page:rd-sheet", "/rd-sheet")), element: makeLazyProtected(<RDSheetPage />, "page:rd-sheet") },
      // 研发知识库：页面与部门库共用统一入口（顶部下拉可互切），底层仍是 /knowledge/* + rd-kb:* 那一套
      { path: asChildPath(routePath("page:rd-knowledge-base", "/rd-knowledge-base")), element: makeLazyProtected(<KnowledgeBaseEntryPage scope="rd" />, "page:rd-knowledge-base") },
      // 部门知识库：各部门库合成一个入口，库在页内切换（存储与权限仍按库隔离）。
      // /dept-kb/:id 保留为深链与刷新用的稳定地址，顶部面包屑也按它解析部门名。
      { path: "dept-kb", element: makeLazyProtected(<KnowledgeBaseEntryPage />, KB_PAGE_PERMISSIONS) },
      { path: "dept-kb/:id", element: makeLazyProtected(<KnowledgeBaseEntryPage />, KB_PAGE_PERMISSIONS) },
      // 中美协同：复用研发驾驶舱（隐藏子系统全景）/ 个人工作台 / 知识库（独立 us-collab 库），独立权限码
      { path: asChildPath(routePath("page:us-collab-cockpit", "/us-collab-cockpit")), element: makeLazyProtected(<RDTaskManagementPage key="ws-us" hideSystemPanorama />, "page:us-collab-cockpit") },
      { path: asChildPath(routePath("page:us-collab-workspace", "/us-collab-workspace")), element: makeLazyProtected(<RDMyWorkspacePage key="ws-us" />, "page:us-collab-workspace") },
      { path: "us-collab-rd-discussion/:taskId", element: lazyWrap(<RDDiscussionInvitePage />) },
      // 协同人员管理：动作码守卫；固定辅助路由由 rdWorkspace 显式归属协同池。
      { path: "us-collab-people-management", element: makeLazyProtected(<RDPeopleManagementPage key="ws-us" visualVariant="rd-horizon" onBack={() => window.history.back()} />, "rd-people:manage") },
      { path: "production-people-management", element: makeLazyProtected(<RDPeopleManagementPage key="ws-production" visualVariant="rd-horizon" onBack={() => window.history.back()} />, "rd-people:manage") },
      // 协同任务全屏详情（双栏）：页面内部按协同页面码任一做门禁，不进侧边栏
      { path: "us-collab-task/:taskId", element: lazyWrap(<UsCollabTaskDetailPage />) },
      // 研发任务全屏详情（双栏，协同同款范式的独立复刻）：路径无 /us-collab 前缀 → rdApi 落研发池；页面内部按研发驾驶舱页面码门禁
      { path: "rd-task/:taskId", element: lazyWrap(<RDTaskDetailPage />) },
      { path: "production-task/:taskId", element: makeLazyProtected(<RDTaskDetailPage key="ws-production-detail" />, "page:rd-director-dashboard") },
      { path: "us-collab-kb", element: makeLazyProtected(<RDKnowledgeBasePage key="kb-us-collab" kbScope={{ kbId: "us-collab", label: "协同" }} visualVariant="rd-horizon" />, "page:dept-kb-us-collab") },
      // 协同审批流 / 留痕 / AI 策略复用研发页面；rdWorkspace 按当前页面路径配置给请求带
      // ?workspace=us-collab，后端把 rd.* 存储键改写成 rdws.us-collab.*。
      // key="ws-us" 强制与研发路由分离组件实例，避免两池间切换时残留上一池的状态。
      { path: asChildPath(routePath("page:us-collab-approval-flow", "/us-collab-approval-flow")), element: makeLazyProtected(<RDApprovalFlowPage key="ws-us" />, "page:us-collab-approval-flow") },
      { path: "us-collab-audit-log", element: <Navigate to="/audit-log?module=us-collab" replace /> },
      { path: asChildPath(routePath("page:us-collab-ai-settings", "/us-collab-ai-settings")), element: makeLazyProtected(<RDAiSettingsPage key="ws-us" />, "page:us-collab-ai-settings") },
      // 生产驾驶舱与研发任务驾驶舱共用页面实现，但使用独立工作区数据；旧主管驾驶舱链接继续跳转兼容。
      { path: "production-dashboard", element: makeLazyProtected(<ProductionDashboardRoute />, "page:rd-director-dashboard") },
      { path: "rd-director-dashboard", element: makeLazyProtected(<Navigate to="/production-dashboard" replace />, "page:rd-director-dashboard") },
      { path: asChildPath(routePath("page:rd-approval-flow", "/rd-approval-flow")), element: makeLazyProtected(<RDApprovalFlowPage />, "page:rd-approval-flow") },
      { path: "rd-audit-log", element: <Navigate to="/audit-log?module=rd" replace /> },
      // 全站统一操作留痕（研发 / 中美协同 / 采购三页合并），旧地址在上面重定向到这里并带上模块预选。
      { path: asChildPath(routePath("page:audit-log", "/audit-log")), element: makeLazyProtected(<AuditLogPage />, "page:audit-log") },
      { path: asChildPath(routePath("page:rd-ai-settings", "/rd-ai-settings")), element: makeLazyProtected(<RDAiSettingsPage />, "page:rd-ai-settings") },
      { path: asChildPath(routePath("page:rd-triage", "/rd-triage")), element: makeLazyProtected(<RDIssues />, "page:rd-triage") },
      { path: asChildPath(routePath("page:registration-projects", "/registration-projects")), element: makeLazyProtected(<RegistrationProjects />, "page:registration-projects") },
      { path: asChildPath(routePath("page:bom-archive", "/bom-archive")), element: makeLazyProtected(<BOMArchive />, "page:bom-archive") },
      { path: asChildPath(routePath("page:design-changes", "/design-changes")), element: makeLazyProtected(<DesignChangesPage />, "page:design-changes") },
      { path: asChildPath(routePath("page:customs-ai", "/customs-ai")), element: makeLazyProtected(<CustomsAI />, "page:customs-ai") },
      { path: asChildPath(routePath("page:customs-docs", "/customs-docs")), element: makeLazyProtected(<CustomsDocs />, "page:customs-docs") },
      { path: asChildPath(routePath("page:external-docs", "/external-docs")), element: makeLazyProtected(<ExternalDocsPage />, "page:external-docs") },
      { path: asChildPath(routePath("page:ra-knowledge", "/ra-knowledge")), element: makeLazyProtected(<RAKnowledgePage />, "page:ra-knowledge") },
      { path: asChildPath(routePath("page:quality-dms", "/quality-dms")), element: makeLazyProtected(<QualityDMSPage />, "page:quality-dms") },
      { path: asChildPath(routePath("page:qa-traceability", "/qa-traceability")), element: makeLazyProtected(<QATraceability />, "page:qa-traceability") },
      { path: asChildPath(routePath("page:order-workbench", "/order-workbench")), element: makeLazyProtected(<OrderWorkbenchPage />, "page:order-workbench") },
      { path: asChildPath(routePath("page:purchase-orders", "/purchase-orders")), element: makeLazyProtected(<PurchaseOrdersPage />, "page:purchase-orders") },
      // 详情页路径跟随**列表页**主路径（改 /purchase-orders 时详情一起移动），但门禁用自己的码。
      // 不能用自己的码做派生基准：该码在目录里的 routePath 是完整的 /purchase-orders/:id，
      // 拿它当基准会再拼一次后缀，得到 /purchase-orders/:id/:id。
      { path: asChildPath(subRoutePath("page:purchase-orders", "/purchase-orders", ":id")), element: makeLazyProtected(<PurchaseOrderDetailPage />, "page:purchase-order-detail") },
      { path: asChildPath(routePath("page:inventory-management", "/inventory-management")), element: makeLazyProtected(<InventoryManagementPage />, "page:inventory-management") },
      { path: asChildPath(routePath("page:proc-cockpit", "/proc-cockpit")), element: makeLazyProtected(<ProcurementCockpitPage />, "page:proc-cockpit") },
      // 采购分类详情二级页：注册路由与权限，但不进侧边栏菜单（routesConfig 未收录即不显示）
      { path: asChildPath(routePath("page:proc-my-workspace", "/proc-my-workspace")), element: makeLazyProtected(<ProcMyWorkspacePage />, "page:proc-my-workspace") },
      { path: asChildPath(routePath("page:proc-materials", "/proc-materials")), element: makeLazyProtected(<MaterialWorkbenchPage />, "page:proc-materials") },
      { path: asChildPath(routePath("page:proc-key-materials", "/proc-key-materials")), element: makeLazyProtected(<KeyMaterialsPage />, "page:proc-key-materials") },
      { path: asChildPath(routePath("page:production-execution", "/production-execution")), element: makeLazyProtected(<ProductionExecutionPage />, "page:production-execution") },
      { path: asChildPath(routePath("page:warehouse-flow", "/warehouse-flow")), element: makeLazyProtected(<WarehouseFlowPage />, ["page:warehouse-flow", "page:production-execution"]) },
      { path: asChildPath(routePath("page:proc-inventory-readiness", "/proc-inventory-readiness")), element: makeLazyProtected(<InventoryReadinessPage />, "page:proc-inventory-readiness") },
      { path: asChildPath(routePath("page:proc-quote-book", "/proc-quote-book")), element: makeLazyProtected(<QuoteBookPage />, "page:proc-quote-book") },
      { path: "proc-audit-log", element: <Navigate to="/audit-log?module=procurement" replace /> },
      // 采购人员管理独立页：从驾驶舱进入，不进侧边栏菜单（对齐研发 rd-people-management 模式）
      // 与采购驾驶舱**共用同一权限码**的兄弟页面：路径必须保持固定。
      // 若也用 routePath("page:proc-cockpit") 解析，两条路由会解析到同一路径，本页直接失联。
      // 一个权限码只能有一条「主路由」跟随目录配置。
      { path: "proc-people-management", element: makeLazyProtected(<ProcPeopleManagementPage />, "page:proc-cockpit") },
      { path: "proc-operational-tasks", element: makeLazyProtected(<OperationalTasksPage />, "page:purchase-order-detail") },
      { path: asChildPath(routePath("page:resume-screening", "/resume-screening")), element: makeLazyProtected(<ResumeScreeningPage />, "page:resume-screening") },
      { path: asChildPath(routePath("page:employee-archive", "/employee-archive")), element: makeLazyProtected(<EmployeeArchivePage />, "page:employee-archive") },
      { path: asChildPath(routePath("page:applicant-forms", "/applicant-forms")), element: makeLazyProtected(<ApplicantFormsPage />, "page:applicant-forms") },
      { path: asChildPath(routePath("page:quick-capture", "/attendance")), element: makeLazyProtected(<AttendancePage />, "page:quick-capture") },
      // 旧链接重定向：路径固定（就是要兜住历史 URL），目标跟随考勤页的当前主路径。
      // 同样不能用 routePath 解析自身路径 —— 会与上面的主路由解析到同一路径而互相覆盖。
      { path: "quick-capture", element: makeLazyProtected(<Navigate to={routePath("page:quick-capture", "/attendance")} replace />, "page:quick-capture") },
      { path: asChildPath(routePath("page:expense-center", "/expense-center")), element: makeLazyProtected(<ExpenseCenterPage />, "page:expense-center") },
      { path: asChildPath(routePath("page:ebpr", "/ebpr")), element: makeLazyProtected(<EBPRPage />, "page:ebpr") },
      { path: asChildPath(routePath("page:inspection-release", "/inspection-release")), element: makeLazyProtected(<InspectionReleasePage />, "page:inspection-release") },
      { path: asChildPath(routePath("page:bug-log", "/bug-log")), element: makeLazyProtected(<BugLogPage />, "page:bug-log") },
      { path: asChildPath(routePath("page:contract-review", "/contract-review")), element: makeLazyProtected(<ContractReviewPage />, "page:contract-review") },
      { path: asChildPath(routePath("page:electronic-gate", "/electronic-gate")), element: makeLazyProtected(<ElectronicGatePage />, "page:electronic-gate") },
      { path: asChildPath(routePath("page:device-inspection-records", "/device-inspection-records")), element: makeLazyProtected(<DeviceInspectionRecordsPage />, "page:device-inspection-records") },
      { path: asChildPath(routePath("page:mailbox-management", "/mailbox-management")), element: makeLazyProtected(<MailboxManagementPage />, "page:mailbox-management") },
      { path: asChildPath(routePath("page:ai-model-management", "/ai-model-management")), element: makeLazyProtected(<AiModelManagementPage />, "page:ai-model-management") },
      { path: asChildPath(routePath("page:ai-usage-dashboard", "/ai-usage")), element: makeLazyProtected(<AiUsageDashboardPage />, "page:ai-usage-dashboard") },
      { path: asChildPath(routePath("page:content-slots", "/content-slots")), element: makeLazyProtected(<ContentSlotsPage />, "page:content-slots") },
      { path: asChildPath(routePath("page:chat-analytics", "/chat-analytics")), element: makeLazyProtected(<ChatAnalyticsPage />, "page:chat-analytics") },
      { path: asChildPath(routePath("i18n:manage", "/i18n-management")), element: makeLazyProtected(<I18nManagementPage />, "i18n:manage") },
      { path: "ocr-config-management", element: makeLazyProtected(<OcrConfigManagementPage />, "page:ocr-config-management") },
      { path: asChildPath(routePath("page:ops-center", "/ops-center")), element: makeLazyProtected(<OpsCenterPage section="overview" />, "page:ops-center") },
      { path: asChildPath(routePath("page:ops-api-errors", "/ops-center/api-errors")), element: makeLazyProtected(<OpsCenterPage section="api-errors" />, "page:ops-api-errors") },
      { path: asChildPath(routePath("page:ops-database", "/ops-center/database")), element: makeLazyProtected(<OpsCenterPage section="database" />, "page:ops-database") },
      { path: asChildPath(routePath("page:ops-services-tasks", "/ops-center/services-tasks")), element: makeLazyProtected(<OpsCenterPage section="services-tasks" />, "page:ops-services-tasks") },
      { path: asChildPath(routePath("page:ops-alerts-audit", "/ops-center/alerts-audit")), element: makeLazyProtected(<OpsCenterPage section="alerts-audit" />, "page:ops-alerts-audit") },
      { path: asChildPath(routePath("page:inquiry", "/inquiry")), element: makeLazyProtected(<InquiryPage />, "page:inquiry") },
      { path: asChildPath(routePath("page:meeting", "/meeting")), element: makeLazyProtected(<MeetingMinutes />, "page:meeting") },
      { path: asChildPath(routePath("page:email-ai", "/email-ai")), element: makeLazyProtected(<EmailAIPage />, "page:email-ai") },
      { path: asChildPath(routePath("page:report-compression", "/report-compression")), element: makeLazyProtected(<ReportCompressionPage />, "page:report-compression") },
      { path: asChildPath(routePath("page:downloads", "/downloads")), element: makeLazyProtected(<DownloadTutorialPage />, "page:downloads") },
      { path: asChildPath(subRoutePath("page:downloads", "/downloads", ":platformId")), element: makeLazyProtected(<PlatformTutorialPage />, "page:downloads") },
      // 操作手册：索引 + 分主题详情（同 downloads 的两级范式），详情页不进侧边栏
      { path: asChildPath(routePath("page:manual", "/manual")), element: makeLazyProtected(<ManualPage />, "page:manual") },
      { path: asChildPath(subRoutePath("page:manual", "/manual", ":topicId")), element: makeLazyProtected(<ManualTopicPage />, "page:manual") },
      { path: asChildPath(routePath("page:departments", "/departments")), element: makeLazyProtected(<DepartmentManagement />, "page:departments") },
      { path: asChildPath(routePath("page:users", "/users")), element: makeLazyProtected(<UserManagement />, "page:users") },
      { path: asChildPath(routePath("page:roles", "/roles")), element: makeLazyProtected(<RoleManagement />, "page:roles") },
      { path: asChildPath(routePath("page:route-management", "/route-management")), element: makeLazyProtected(<RouteManagementPage />, "page:route-management") },
      { path: asChildPath(routePath("page:settings", "/settings")), element: makeLazyProtected(<DictionaryList />, "page:settings") },
      { path: asChildPath(routePath("page:ui-design", "/ui-design")), element: makeLazyProtected(<UIDesignPage />, "page:ui-design") },
      { path: asChildPath(routePath("page:image-library", "/image-library")), element: makeLazyProtected(<ImageLibraryPage />, "page:image-library") },
      { path: asChildPath(routePath("page:video-library", "/video-library")), element: makeLazyProtected(<VideoLibraryPage />, "page:video-library") },
      { path: "*", Component: () => <Navigate to="/" replace /> },
    ],
  },
  {
    // 移动端独立路由树：自带鉴权外壳，不复用桌面 Root（其写死 min-w-1024 + 侧边栏）。
    // L1 直达：移动视口访问 /m 可直接进入；恢复宽屏后由外层守卫自动返回桌面驾驶舱。
    path: "/m",
    Component: ResponsiveMobileLayout,
    children: [
      { index: true, element: makeLazyProtected(<MobileRDCockpit />, ["page:rd-task-management", "page:rd-my-workspace"]) },
      { path: "task/:taskId", element: makeLazyProtected(<MobileRDCockpit />, ["page:rd-task-management", "page:rd-my-workspace"]) },
      { path: "discussion/:taskId", element: lazyWrap(<RDDiscussionInvitePage />) },
      { path: asChildPath(routePath("page:chat-analytics", "/chat-analytics")), element: makeLazyProtected(<MobileChatAnalyticsPage />, "page:chat-analytics") },
      { path: "*", element: <Navigate to="/m" replace /> },
    ],
  },
  {
    // 协同移动端：复用研发移动驾驶舱组件，固定路由由 rdWorkspace 显式归属协同池。
    path: "/us-collab-m",
    Component: ResponsiveMobileLayout,
    children: [
      { index: true, element: makeLazyProtected(<MobileRDCockpit />, "page:us-collab-cockpit") },
      { path: "task/:taskId", element: makeLazyProtected(<MobileRDCockpit />, "page:us-collab-cockpit") },
      { path: "discussion/:taskId", element: lazyWrap(<RDDiscussionInvitePage />) },
      { path: "*", element: <Navigate to="/us-collab-m" replace /> },
    ],
  },
  {
    // This fixed route is explicitly assigned to the production workspace in rdWorkspace.
    path: "/production-m",
    Component: ResponsiveMobileLayout,
    children: [
      { index: true, element: makeLazyProtected(<MobileRDCockpit />, "page:rd-director-dashboard") },
      { path: "task/:taskId", element: makeLazyProtected(<MobileRDCockpit />, "page:rd-director-dashboard") },
      { path: "*", element: <Navigate to="/production-m" replace /> },
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
            className="mt-2 rounded-lg bg-[#002fa7] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#00298f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002fa7]/30 focus-visible:ring-offset-2"
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
