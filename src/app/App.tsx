import React, { useEffect } from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
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
import { DesignChangesPage } from "./DesignChangesPage";
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
import { Root } from "./Root";
import { DictionaryList } from "./DictionaryList";
import { UserManagement } from "./UserManagement";

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

const router = createBrowserRouter([
  { path: "/login", Component: LoginPage },
  {
    path: "/",
    Component: ProtectedLayout,
    children: [
      { index: true, Component: Dashboard },
      { path: "after-sales", Component: AfterSalesList },
      { path: "after-sales/new", Component: AfterSalesForm },
      { path: "after-sales/:id", Component: AfterSalesDetails },
      { path: "rd-triage", Component: RDIssues },
      { path: "registration-projects", Component: RegistrationProjects },
      { path: "bom-archive", Component: BOMArchive },
      { path: "design-changes", Component: DesignChangesPage },
      { path: "customs-ai", Component: CustomsAI },
      { path: "customs-docs", Component: CustomsDocs },
      { path: "external-docs", Component: ExternalDocsPage },
      { path: "ra-knowledge", Component: RAKnowledgePage },
      { path: "quality-dms", Component: QualityDMSPage },
      { path: "qa-traceability", Component: QATraceability },
      { path: "resume-screening", Component: ResumeScreeningPage },
      { path: "employee-archive", Component: EmployeeArchivePage },
      { path: "quick-capture", Component: QuickCapturePage },
      { path: "expense-center", Component: ExpenseCenterPage },
      { path: "ebpr", Component: EBPRPage },
      { path: "inspection-release", Component: InspectionReleasePage },
      { path: "bug-log", Component: BugLogPage },
      { path: "contract-review", Component: ContractReviewPage },
      { path: "mailbox-management", Component: MailboxManagementPage },
      { path: "ai-model-management", Component: AiModelManagementPage },
      { path: "inquiry", Component: InquiryPage },
      { path: "meeting", Component: MeetingMinutes },
      { path: "email-ai", Component: EmailAIPage },
      { path: "report-compression", Component: ReportCompressionPage },
      { path: "users", Component: UserManagement },
      { path: "roles", Component: RoleManagement },
      { path: "settings", Component: DictionaryList },
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
