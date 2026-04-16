import { createBrowserRouter } from "react-router";
import { Root } from "./Root";
import { Dashboard } from "./Dashboard";
// 售后工单
import { AfterSalesForm } from "./AfterSalesForm";
import { AfterSalesDetails } from "./AfterSalesDetails";
import { AfterSalesList } from "./AfterSalesList";
// 信息流转
import { RDIssues } from "./RDIssues";
import { RegistrationProjects } from "./RegistrationProjects";
import { BOMArchive } from "./BOMArchive";
import { DesignChangesPage } from "./DesignChangesPage";
// 文件与知识
import { CustomsAI } from "./CustomsAI";
import { ExternalDocsPage } from "./ExternalDocsPage";
import { RAKnowledgePage } from "./RAKnowledgePage";
import { QualityDMSPage } from "./QualityDMSPage";
// 沟通协同
import { InquiryPage } from "./InquiryPage";
import { MeetingMinutes } from "./MeetingMinutes";
import { EmailAIPage } from "./EmailAIPage";
import { ReportCompressionPage } from "./ReportCompressionPage";
// 人事与行政
import { ResumeScreeningPage } from "./ResumeScreeningPage";
import { EmployeeArchivePage } from "./EmployeeArchivePage";
import { QuickCapturePage } from "./QuickCapturePage";
import { ExpenseCenterPage } from "./ExpenseCenterPage";
// 质量与生产
import { EBPRPage } from "./EBPRPage";
import { InspectionReleasePage } from "./InspectionReleasePage";
import { BugLogPage } from "./BugLogPage";
// 法务与系统
import { ContractReviewPage } from "./ContractReviewPage";
import { UserManagement } from "./UserManagement";
import { RoleManagement } from "./RoleManagement";
import { SystemSettings } from "./SystemSettings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Dashboard },
      // 售后工单
      { path: "after-sales", Component: AfterSalesList },
      { path: "after-sales/new", Component: AfterSalesForm },
      { path: "after-sales/:id", Component: AfterSalesDetails },
      // 信息流转
      { path: "rd-triage", Component: RDIssues },
      { path: "registration-projects", Component: RegistrationProjects },
      { path: "bom-archive", Component: BOMArchive },
      { path: "design-changes", Component: DesignChangesPage },
      // 文件与知识
      { path: "customs-ai", Component: CustomsAI },
      { path: "external-docs", Component: ExternalDocsPage },
      { path: "ra-knowledge", Component: RAKnowledgePage },
      { path: "quality-dms", Component: QualityDMSPage },
      // 沟通协同
      { path: "inquiry", Component: InquiryPage },
      { path: "meeting", Component: MeetingMinutes },
      { path: "email-ai", Component: EmailAIPage },
      { path: "report-compression", Component: ReportCompressionPage },
      // 人事与行政
      { path: "resume-screening", Component: ResumeScreeningPage },
      { path: "employee-archive", Component: EmployeeArchivePage },
      { path: "quick-capture", Component: QuickCapturePage },
      { path: "expense-center", Component: ExpenseCenterPage },
      // 质量与生产
      { path: "ebpr", Component: EBPRPage },
      { path: "inspection-release", Component: InspectionReleasePage },
      { path: "bug-log", Component: BugLogPage },
      // 法务与系统
      { path: "contract-review", Component: ContractReviewPage },
      { path: "users", Component: UserManagement },
      { path: "roles", Component: RoleManagement },
      { path: "settings", Component: SystemSettings },
      // 兜底
      { path: "*", Component: () => <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Coming Soon</div> },
    ],
  },
]);
