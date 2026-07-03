// 采购与研发协同 · 演示状态 store。
// 无 zustand：用模块单例 + useSyncExternalStore，跨 4 个页面路由共享同一份内存状态，
// 刷新即重置（模块重新加载），并提供手动「重置演示数据」。故事线相关 toast 在动作内触发。
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  buildContracts,
  buildPriceHistory,
  buildRdTasks,
  buildRequirements,
  buildSuppliers,
  PURCHASER,
} from "./data/mockData";
import type { Contract, PriceHistoryRow, Quote, RdTask, Requirement, Supplier } from "./data/types";

export interface ProcState {
  requirements: Requirement[];
  contracts: Contract[];
  rdTasks: RdTask[];
  priceHistory: PriceHistoryRow[];
  suppliers: Supplier[];
  reviewMode: boolean;
}

function initialState(): ProcState {
  return {
    requirements: buildRequirements(),
    contracts: buildContracts(),
    rdTasks: buildRdTasks(),
    priceHistory: buildPriceHistory(),
    suppliers: buildSuppliers(),
    reviewMode: true,
  };
}

let state: ProcState = initialState();
const listeners = new Set<() => void>();
function set(next: ProcState) {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => state;

/** 订阅整份演示状态（immutable 替换，引用稳定，无 tearing）。 */
export function useProc(): ProcState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

let seq = 1000;
const uid = (p: string) => `${p}-${++seq}`;
const today = () => new Date().toISOString().slice(0, 10);

const MAIN_REQ_ID = "PR-001";
const MAIN_REQ_CODE = "PR-20260703-001";
const MAIN_CONTRACT_ID = "HT-2026-001";

function withLog(r: Requirement, text: string): Requirement {
  return { ...r, updatedAt: today(), logs: [...r.logs, { id: uid("log"), at: today(), text }] };
}
function updateReq(reqId: string, fn: (r: Requirement) => Requirement) {
  set({ ...state, requirements: state.requirements.map((r) => (r.id === reqId ? fn(r) : r)) });
}
function updateContract(cid: string, fn: (c: Contract) => Contract) {
  set({ ...state, contracts: state.contracts.map((c) => (c.id === cid ? fn(c) : c)) });
}
/** 往关联研发任务的时间线追加一条「采购动态」回传条目。 */
function pushRdProc(reqId: string, text: string) {
  const req = state.requirements.find((r) => r.id === reqId);
  const taskId = req?.relatedRdTaskId;
  if (!taskId) return;
  set({
    ...state,
    rdTasks: state.rdTasks.map((t) =>
      t.id === taskId
        ? { ...t, timeline: [...t.timeline, { id: uid("tl"), at: today(), text: `采购动态：${text}`, kind: "proc" }] }
        : t,
    ),
  });
}

export interface RequirementPrefill {
  materialName: string;
  spec: string;
  quantity: number;
  expectedDate: string;
  rdContact: string;
  useDesc: string;
}

export const procActions = {
  reset() {
    set(initialState());
    toast.success("演示数据已重置");
  },
  setReviewMode(on: boolean) {
    set({ ...state, reviewMode: on });
  },

  /** 场景2：从研发任务转采购询价 → 生成需求草稿 PR-…-001（来源：研发流转），并回传研发时间线。 */
  generateFromRdTask(taskId: string, prefill: RequirementPrefill): string {
    if (!state.requirements.some((r) => r.id === MAIN_REQ_ID)) {
      const req: Requirement = {
        id: MAIN_REQ_ID,
        code: MAIN_REQ_CODE,
        materialName: prefill.materialName,
        spec: prefill.spec,
        quantity: prefill.quantity,
        unit: "件",
        expectedDate: prefill.expectedDate,
        source: "rd",
        owner: PURCHASER,
        rdContact: prefill.rdContact,
        useDesc: prefill.useDesc,
        status: "draft",
        relatedRdTaskId: taskId,
        hasAttachment: true,
        quotes: [
          { id: "q-001-1", supplier: "华东橡塑", unitPrice: 3.8, leadDays: 10, createdAt: today() },
          { id: "q-001-2", supplier: "宁波恒力", unitPrice: 4.2, leadDays: 7, createdAt: today() },
        ],
        logs: [{ id: uid("log"), at: today(), text: "由研发任务「新压缩机950减震垫选型」流转生成需求草稿（来源：研发流转）" }],
        createdAt: today(),
        updatedAt: today(),
      };
      set({
        ...state,
        requirements: [req, ...state.requirements],
        rdTasks: state.rdTasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                relatedRequirementId: MAIN_REQ_ID,
                timeline: [...t.timeline, { id: uid("tl"), at: today(), text: `采购动态：需求单 ${MAIN_REQ_CODE} 已生成（来源研发流转）`, kind: "proc" }],
              }
            : t,
        ),
      });
    }
    toast.success(`已生成采购需求草稿 ${MAIN_REQ_CODE}（来源：研发流转）`);
    return MAIN_REQ_CODE;
  },

  /** 手动新建需求（非主线，提交后进列表）。 */
  createRequirement(input: { materialName: string; spec: string; quantity: number }): string {
    const n = state.requirements.length + 1;
    const code = `PR-20260703-${String(n).padStart(3, "0")}`;
    const req: Requirement = {
      id: uid("PR"),
      code,
      materialName: input.materialName,
      spec: input.spec,
      quantity: input.quantity,
      unit: "件",
      expectedDate: "2026-08-01",
      source: "self",
      owner: PURCHASER,
      status: "draft",
      quotes: [],
      logs: [{ id: uid("log"), at: today(), text: "采购自建草稿，待补全提交" }],
      createdAt: today(),
      updatedAt: today(),
    };
    set({ ...state, requirements: [req, ...state.requirements] });
    toast.success(`已新建需求草稿 ${code}`);
    return code;
  },

  submit(reqId: string) {
    updateReq(reqId, (r) => (r.status === "draft" ? withLog({ ...r, status: "pending_inquiry" }, "已提交，进入待询价") : r));
    toast.success("需求已提交，进入待询价");
  },

  addQuote(reqId: string, quote: Omit<Quote, "id" | "createdAt">) {
    updateReq(reqId, (r) => {
      const quotes = [...r.quotes, { ...quote, id: uid("q"), createdAt: today() }];
      const status = r.status === "pending_inquiry" ? ("inquiring" as const) : r.status;
      return withLog({ ...r, quotes, status }, `录入报价：${quote.supplier} ¥${quote.unitPrice}/交期${quote.leadDays}天`);
    });
    toast.success("报价已录入，进入询价中");
  },

  selectForSample(reqId: string, quoteId: string) {
    let supplier = "";
    updateReq(reqId, (r) => {
      const quotes = r.quotes.map((q) => ({ ...q, selected: q.id === quoteId, requestedSample: q.id === quoteId }));
      supplier = quotes.find((q) => q.id === quoteId)?.supplier ?? "";
      return withLog({ ...r, quotes, selectedQuoteId: quoteId, status: "pending_sample" }, `选定 ${supplier} 报价并发起打样`);
    });
    toast.success("已选定报价并要样，等待到样");
  },

  sampleArrived(reqId: string) {
    const contact = state.requirements.find((r) => r.id === reqId)?.rdContact ?? "";
    updateReq(reqId, (r) => withLog({ ...r, status: "testing", sampleArrivedAt: today() }, "样品已到，进入测试"));
    pushRdProc(reqId, "样品已到，请研发对接人安排测试");
    toast.success(`已通知研发对接人 ${contact || "—"}`);
  },

  testPass(reqId: string) {
    updateReq(reqId, (r) => withLog({ ...r, status: "priced", testConclusion: "测试通过，进入定价" }, "测试通过，已定价"));
    pushRdProc(reqId, "测试通过，已定价");
    toast.success("测试通过，已定价");
  },

  testFail(reqId: string, note: string) {
    updateReq(reqId, (r) => withLog({ ...r, testConclusion: `测试不通过：${note}` }, `测试不通过：${note}`));
    toast.error("已记录测试不通过");
  },

  /** 进入合同流程：主线关联预置合同 HT-2026-001（审批中），需求转「待签合同」，回传研发时间线。 */
  toContract(reqId: string): string {
    updateReq(reqId, (r) => withLog({ ...r, status: "pending_contract", relatedContractId: MAIN_CONTRACT_ID }, `进入合同流程，生成合同 ${MAIN_CONTRACT_ID}`));
    pushRdProc(reqId, `合同 ${MAIN_CONTRACT_ID} 已签订，进入企微审批`);
    toast.success("已进入合同流程，请在合同台账查看");
    return MAIN_CONTRACT_ID;
  },

  simContractApproval(cid: string) {
    updateContract(cid, (c) => (c.contractApproval === "approving" ? { ...c, contractApproval: "effective", updatedAt: today() } : c));
    toast.success("企微合同审批已通过，合同已生效");
  },

  simDelivery(cid: string) {
    const before = state.contracts.find((c) => c.id === cid);
    if (!before || before.deliveryPlan.length === 0) {
      toast.info("该合同已全部到货");
      return;
    }
    updateContract(cid, (c) => {
      const [qty, ...rest] = c.deliveryPlan;
      return {
        ...c,
        delivered: c.delivered + qty,
        deliveries: [...c.deliveries, { batch: `第${c.deliveries.length + 1}批`, date: today(), qty, operator: "仓管·王芳" }],
        deliveryPlan: rest,
        updatedAt: today(),
      };
    });
    const after = state.contracts.find((c) => c.id === cid);
    toast.success(after && after.deliveryPlan.length === 0 ? "已模拟到货，合同已全部到货" : "已模拟一批到货入库");
  },

  // ── 供应商档案维护 ──────────────────────────────────────────────────────
  upsertSupplier(input: Supplier) {
    const exists = state.suppliers.some((s) => s.id === input.id);
    if (exists) {
      set({ ...state, suppliers: state.suppliers.map((s) => (s.id === input.id ? input : s)) });
      toast.success(`已更新供应商「${input.name}」`);
    } else {
      const id = input.id || uid("S");
      set({ ...state, suppliers: [{ ...input, id }, ...state.suppliers] });
      toast.success(`已新增供应商「${input.name}」`);
    }
  },
  deleteSupplier(id: string) {
    const s = state.suppliers.find((x) => x.id === id);
    set({ ...state, suppliers: state.suppliers.filter((x) => x.id !== id) });
    toast.success(`已删除供应商「${s?.name ?? id}」`);
  },
  importSuppliers(list: Supplier[]): number {
    if (list.length === 0) {
      toast.error("未解析到有效供应商数据，请检查表头是否与模板一致");
      return 0;
    }
    const withIds = list.map((s, i) => ({ ...s, id: s.id || uid(`S-imp-${i}`) }));
    set({ ...state, suppliers: [...withIds, ...state.suppliers] });
    toast.success(`已导入 ${withIds.length} 家供应商`);
    return withIds.length;
  },
  importRequirements(rows: Array<{ materialName: string; spec: string; quantity: number; expectedDate?: string; source?: "rd" | "self" }>): number {
    const valid = rows.filter((r) => r.materialName);
    if (valid.length === 0) {
      toast.error("未解析到有效需求数据，请检查表头是否与模板一致（至少含「物料名称」）");
      return 0;
    }
    let seqBase = state.requirements.length;
    const built: Requirement[] = valid.map((r, i) => {
      seqBase += 1;
      const code = `PR-20260703-${String(seqBase).padStart(3, "0")}`;
      return {
        id: uid(`PR-imp-${i}`),
        code,
        materialName: r.materialName,
        spec: r.spec || "—",
        quantity: Number(r.quantity) || 0,
        unit: "件",
        expectedDate: r.expectedDate || "2026-08-01",
        source: r.source === "rd" ? "rd" : "self",
        owner: PURCHASER,
        status: "draft",
        quotes: [],
        logs: [{ id: uid("log"), at: today(), text: "批量导入生成草稿，待补全提交" }],
        createdAt: today(),
        updatedAt: today(),
      };
    });
    set({ ...state, requirements: [...built, ...state.requirements] });
    toast.success(`已导入 ${built.length} 条采购需求`);
    return built.length;
  },

  simPayment(cid: string) {
    updateContract(cid, (c) => ({
      ...c,
      paymentApproval: "approved",
      payments: c.payments.length ? c.payments.map((p) => ({ ...p, status: "approved" as const })) : [{ label: "付款", ratio: "100%", amount: c.amount, status: "approved" as const }],
      updatedAt: today(),
    }));
    toast.success("企微付款审批已通过");
  },
};
