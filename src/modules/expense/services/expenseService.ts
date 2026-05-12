import {
  dashboardData,
  expenseRules,
  invoiceRecords,
  reimbursements,
  voucherCandidates,
} from "../mocks/expenseMock";
import type {
  ExpenseDashboardData,
  ExpenseRule,
  InvoiceFilters,
  InvoiceRecord,
  ReimbursementRecord,
  VoucherCandidate,
} from "../types";

const waitForMock = <T,>(value: T) =>
  new Promise<T>((resolve) => {
    window.setTimeout(() => resolve(value), 120);
  });

export const expenseService = {
  listInvoices(filters?: Partial<InvoiceFilters>) {
    const keyword = filters?.keyword?.trim().toLowerCase() ?? "";
    const maxConfidence = filters?.maxConfidence ?? 1;

    const result = invoiceRecords.filter((invoice) => {
      const matchesKeyword =
        keyword.length === 0 ||
        [invoice.invoiceNo, invoice.vendor, invoice.project, invoice.uploader]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const matchesStatus = !filters?.status || filters.status === "全部" || invoice.status === filters.status;
      const matchesCategory = !filters?.category || filters.category === "全部" || invoice.category === filters.category;
      const matchesConfidence = invoice.categoryConfidence <= maxConfidence;
      const min = Number(filters?.amountMin || 0);
      const max = Number(filters?.amountMax || Number.POSITIVE_INFINITY);
      const matchesAmount = invoice.amount >= min && invoice.amount <= max;

      return matchesKeyword && matchesStatus && matchesCategory && matchesConfidence && matchesAmount;
    });

    return waitForMock(result);
  },

  getDashboard(): Promise<ExpenseDashboardData> {
    return waitForMock(dashboardData);
  },

  listVoucherCandidates(invoiceId: string): Promise<VoucherCandidate[]> {
    const invoice = invoiceRecords.find((item) => item.id === invoiceId);
    if (!invoice) {
      return waitForMock(voucherCandidates);
    }

    return waitForMock(
      voucherCandidates.map((candidate, index) => ({
        ...candidate,
        amount: index === 0 ? invoice.amount : candidate.amount,
        project: index === 0 ? invoice.project : candidate.project,
      })),
    );
  },

  listReimbursements(): Promise<ReimbursementRecord[]> {
    return waitForMock(reimbursements);
  },

  listRules(): Promise<ExpenseRule[]> {
    return waitForMock(expenseRules);
  },
};
