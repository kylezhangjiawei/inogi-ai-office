import React from "react";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { materialTheme } from "../styles/materialTheme";
import { AfterSalesDetails } from "./AfterSalesDetails";
import { AfterSalesForm } from "./AfterSalesForm";
import { AfterSalesList } from "./AfterSalesList";
import { AuthProvider, useAuth } from "./auth";
import { BOMArchive } from "./BOMArchive";
import { BugLogPage } from "./BugLogPage";
import { CustomsAI } from "./CustomsAI";
import { Dashboard } from "./Dashboard";
import { DesignChangesPage } from "./DesignChangesPage";
import { EBPRPage } from "./EBPRPage";
import { EmployeeArchivePage } from "./EmployeeArchivePage";
import { ExpenseCenterPage } from "./ExpenseCenterPage";
import { ExternalDocsPage } from "./ExternalDocsPage";
import { InspectionReleasePage } from "./InspectionReleasePage";
import { LoginPage } from "./LoginPage";
import { MeetingMinutes } from "./MeetingMinutes";
import { ContractReviewPage } from "./ContractReviewPage";
import { QualityDMSPage } from "./QualityDMSPage";
import { QuickCapturePage } from "./QuickCapturePage";
import { RAKnowledgePage } from "./RAKnowledgePage";
import { RDIssues } from "./RDIssues";
import { RegistrationProjects } from "./RegistrationProjects";
import { ResumeScreeningPage } from "./ResumeScreeningPage";
import { RoleManagement } from "./RoleManagement";
import { Root } from "./Root";
import { SystemSettings } from "./SystemSettings";
import { UserManagement } from "./UserManagement";

function ProtectedLayout() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
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
      { path: "external-docs", Component: ExternalDocsPage },
      { path: "ra-knowledge", Component: RAKnowledgePage },
      { path: "quality-dms", Component: QualityDMSPage },
      { path: "resume-screening", Component: ResumeScreeningPage },
      { path: "employee-archive", Component: EmployeeArchivePage },
      { path: "quick-capture", Component: QuickCapturePage },
      { path: "expense-center", Component: ExpenseCenterPage },
      { path: "ebpr", Component: EBPRPage },
      { path: "inspection-release", Component: InspectionReleasePage },
      { path: "bug-log", Component: BugLogPage },
      { path: "contract-review", Component: ContractReviewPage },
      { path: "meeting", Component: MeetingMinutes },
      { path: "users", Component: UserManagement },
      { path: "roles", Component: RoleManagement },
      { path: "settings", Component: SystemSettings },
      { path: "*", Component: () => <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <ThemeProvider theme={materialTheme}>
      <CssBaseline />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}
