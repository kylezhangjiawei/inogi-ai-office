import React, { useEffect } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { materialTheme } from "../styles/materialTheme";
import { AfterSalesDetails } from "./AfterSalesDetails";
import { AfterSalesForm } from "./AfterSalesForm";
import { AfterSalesList } from "./AfterSalesList";
import { AiModelManagementPage } from "./AiModelManagementPage";
import { AuthProvider, useAuth } from "./auth";
import { BOMArchive } from "./BOMArchive";
import { BugLogPage } from "./BugLogPage";
import { CustomsAI } from "./CustomsAI";
import { CustomsDocs } from "./CustomsDocs";
import { Dashboard } from "./Dashboard";
import { DepartmentManagement } from "./DepartmentManagement";
import { DesignChangesPage } from "./DesignChangesPage";
import { DownloadTutorialPage, PlatformTutorialPage } from "./DownloadTutorialPage";
import { EBPRPage } from "./EBPRPage";
import { EmailAIPage } from "./EmailAIPage";
import { EmployeeArchivePage } from "./EmployeeArchivePage";
import { ExpenseCenterPage } from "./ExpenseCenterPage";
import { ExternalDocsPage } from "./ExternalDocsPage";
import { InspectionReleasePage } from "./InspectionReleasePage";
import { InquiryPage } from "./InquiryPage";
import { LoginPage } from "./LoginPage";
import { MailboxManagementPage } from "./MailboxManagementPage";
import { MeetingMinutes } from "./MeetingMinutes";
import { MessageCenterPage } from "./MessageCenterPage";
import { OpsCenterPage } from "./OpsCenterPage";
import {
  InventoryPricingPage,
  OrderFulfillmentPage,
  OrderIntakePage,
  OrderReviewPage,
  ShipmentGenerationPage,
  ShippingAlertsPage,
  TemplateConfigurationPage,
} from "./OrderFulfillmentPage";
import { PersonalCenterPage } from "./PersonalCenterPage";
import { ContractReviewPage } from "./ContractReviewPage";
import { QualityDMSPage } from "./QualityDMSPage";
import { QATraceability } from "./QATraceability";
import { QuickCapturePage } from "./QuickCapturePage";
import { RAKnowledgePage } from "./RAKnowledgePage";
import { RDIssues } from "./RDIssues";
import { RegistrationProjects } from "./RegistrationProjects";
import { ReportCompressionPage } from "./ReportCompressionPage";
import { ResumeScreeningPage } from "./ResumeScreeningPage";
import { RoleManagement } from "./RoleManagement";
import { RDTaskManagementPage } from "./RDTaskManagementPage";
import { RDMyWorkspacePage } from "./RDMyWorkspacePage";
import { RDKnowledgeBasePage } from "./RDKnowledgeBasePage";
import { RDPeopleManagementPage } from "./RDPeopleManagementPage";
import { RDDirectorDashboardPage } from "./RDDirectorDashboardPage";
import { RDApprovalFlowPage } from "./RDApprovalFlowPage";
import { RDAuditLogPage } from "./RDAuditLogPage";
import { RDAiSettingsPage } from "./RDAiSettingsPage";
import { RouteManagementPage } from "./RouteManagementPage";
import { UIDesignPage } from "./UIDesignPage";
import { Root } from "./Root";
import { DictionaryList } from "./DictionaryList";
import { UserManagement } from "./UserManagement";
import { hasPermission } from "./lib/permissions";
import { routePermissionMap } from "./routesConfig";

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
          sessionStorage.removeItem(RUNTIME_VERSION_NOTICE_KEY);
          return;
        }

        const noticeKey = `${FRONTEND_RELEASE}:${FRONTEND_GIT_SHA}:${backendRelease}:${backendGitSha}`;
        if (sessionStorage.getItem(RUNTIME_VERSION_NOTICE_KEY) === noticeKey) {
          return;
        }

        sessionStorage.setItem(RUNTIME_VERSION_NOTICE_KEY, noticeKey);
        toast.error(
          `前后端版本不一致：前端 ${FRONTEND_RELEASE} (${FRONTEND_GIT_SHA.slice(0, 7)})，后端 ${backendRelease} (${backendGitSha.slice(0, 7)})。请确认 API 已部署到同一版本。`,
          { duration: 12000 },
        );
      } catch {
        // Ignore version probe failures; this check should never block the app.
      }
    }

    void checkRuntimeVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

function ProtectedLayout() {
  const { user, hydrated } = useAuth();
  const location = useLocation();

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

const router = createBrowserRouter([
  { path: "/login", Component: LoginPage },
  {
    path: "/",
    Component: ProtectedLayout,
    children: [
      { index: true, element: makeProtected(<Dashboard />, routePermissionMap["/"] ?? "page:dashboard") },
      { path: "profile", element: <PersonalCenterPage /> },
      { path: "message-center", element: <MessageCenterPage /> },
      { path: "after-sales", element: makeProtected(<AfterSalesList />, "page:after-sales") },
      { path: "after-sales/new", element: makeProtected(<AfterSalesForm />, "page:after-sales") },
      { path: "after-sales/:id", element: makeProtected(<AfterSalesDetails />, "page:after-sales") },
      { path: "rd-task-management", element: makeProtected(<RDTaskManagementPage />, "page:rd-task-management") },
      { path: "rd-people-management", element: makeProtected(<RDPeopleManagementPage onBack={() => window.history.back()} />, "rd-people:manage") },
      { path: "rd-my-workspace", element: makeProtected(<RDMyWorkspacePage />, "page:rd-my-workspace") },
      { path: "rd-knowledge-base", element: makeProtected(<RDKnowledgeBasePage />, "page:rd-knowledge-base") },
      // 研发主管驾驶舱 — 导航可见性由页面路由管理中的「导航」开关控制（默认隐藏）
      { path: "rd-director-dashboard", element: makeProtected(<RDDirectorDashboardPage />, "page:rd-director-dashboard") },
      { path: "rd-approval-flow", element: makeProtected(<RDApprovalFlowPage />, "page:rd-approval-flow") },
      { path: "rd-audit-log", element: makeProtected(<RDAuditLogPage />, "page:rd-audit-log") },
      { path: "rd-ai-settings", element: makeProtected(<RDAiSettingsPage />, "page:rd-ai-settings") },
      { path: "rd-triage", element: makeProtected(<RDIssues />, "page:rd-triage") },
      { path: "registration-projects", element: makeProtected(<RegistrationProjects />, "page:registration-projects") },
      { path: "bom-archive", element: makeProtected(<BOMArchive />, "page:bom-archive") },
      { path: "design-changes", element: makeProtected(<DesignChangesPage />, "page:design-changes") },
      { path: "customs-ai", element: makeProtected(<CustomsAI />, "page:customs-ai") },
      { path: "customs-docs", element: makeProtected(<CustomsDocs />, "page:customs-docs") },
      { path: "external-docs", element: makeProtected(<ExternalDocsPage />, "page:external-docs") },
      { path: "ra-knowledge", element: makeProtected(<RAKnowledgePage />, "page:ra-knowledge") },
      { path: "quality-dms", element: makeProtected(<QualityDMSPage />, "page:quality-dms") },
      { path: "qa-traceability", element: makeProtected(<QATraceability />, "page:qa-traceability") },
      { path: "resume-screening", element: makeProtected(<ResumeScreeningPage />, "page:resume-screening") },
      { path: "employee-archive", element: makeProtected(<EmployeeArchivePage />, "page:employee-archive") },
      { path: "quick-capture", element: makeProtected(<QuickCapturePage />, "page:quick-capture") },
      { path: "expense-center", element: makeProtected(<ExpenseCenterPage />, "page:expense-center") },
      { path: "ebpr", element: makeProtected(<EBPRPage />, "page:ebpr") },
      { path: "inspection-release", element: makeProtected(<InspectionReleasePage />, "page:inspection-release") },
      { path: "bug-log", element: makeProtected(<BugLogPage />, "page:bug-log") },
      { path: "contract-review", element: makeProtected(<ContractReviewPage />, "page:contract-review") },
      { path: "mailbox-management", element: makeProtected(<MailboxManagementPage />, "page:mailbox-management") },
      { path: "ai-model-management", element: makeProtected(<AiModelManagementPage />, "page:ai-model-management") },
      { path: "ops-center", element: makeProtected(<OpsCenterPage section="overview" />, "page:ops-center") },
      { path: "ops-center/api-errors", element: makeProtected(<OpsCenterPage section="api-errors" />, "page:ops-api-errors") },
      { path: "ops-center/database", element: makeProtected(<OpsCenterPage section="database" />, "page:ops-database") },
      { path: "ops-center/services-tasks", element: makeProtected(<OpsCenterPage section="services-tasks" />, "page:ops-services-tasks") },
      { path: "ops-center/alerts-audit", element: makeProtected(<OpsCenterPage section="alerts-audit" />, "page:ops-alerts-audit") },
      { path: "inquiry", element: makeProtected(<InquiryPage />, "page:inquiry") },
      { path: "meeting", element: makeProtected(<MeetingMinutes />, "page:meeting") },
      { path: "email-ai", element: makeProtected(<EmailAIPage />, "page:email-ai") },
      { path: "report-compression", element: makeProtected(<ReportCompressionPage />, "page:report-compression") },
      { path: "order-fulfillment", element: makeProtected(<OrderFulfillmentPage />, "page:order-fulfillment") },
      { path: "order-fulfillment/intake", element: makeProtected(<OrderIntakePage />, "page:order-fulfillment-intake") },
      { path: "order-fulfillment/review", element: makeProtected(<OrderReviewPage />, "page:order-fulfillment-review") },
      { path: "order-fulfillment/shipments", element: makeProtected(<ShipmentGenerationPage />, "page:order-fulfillment-shipments") },
      { path: "order-fulfillment/inventory", element: makeProtected(<InventoryPricingPage />, "page:order-fulfillment-inventory") },
      { path: "order-fulfillment/templates", element: makeProtected(<TemplateConfigurationPage />, "page:order-fulfillment-templates") },
      { path: "order-fulfillment/alerts", element: makeProtected(<ShippingAlertsPage />, "page:order-fulfillment-alerts") },
      { path: "downloads", element: makeProtected(<DownloadTutorialPage />, "page:downloads") },
      { path: "downloads/:platformId", element: makeProtected(<PlatformTutorialPage />, "page:downloads") },
      { path: "departments", element: makeProtected(<DepartmentManagement />, "page:departments") },
      { path: "users", element: makeProtected(<UserManagement />, "page:users") },
      { path: "roles", element: makeProtected(<RoleManagement />, "page:roles") },
      { path: "route-management", element: makeProtected(<RouteManagementPage />, "page:route-management") },
      { path: "settings", element: makeProtected(<DictionaryList />, "page:settings") },
      { path: "ui-design", element: makeProtected(<UIDesignPage />, "page:ui-design") },
      { path: "*", Component: () => <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider theme={materialTheme}>
      <CssBaseline />
      <AuthProvider>
        <RuntimeVersionGuard />
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}
