import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ClipboardList,
  Eye,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  Warehouse,
} from "lucide-react";

import { AutoTranslatedText } from "../../components/TranslatableText";
import { cn } from "../../components/ui/utils";
import { usePermission } from "../../hooks/usePermission";
import { useI18n } from "../../lib/i18n";
import { routePath } from "../../lib/routePaths";
import {
  getTplusInventoryDetail,
  type Material,
  type ProcurementTask,
  type ProcTaskTreeNode,
  type TplusInventoryDetail,
} from "../../lib/procurementApi";
import { EditTaskModal, NewRequirementModal } from "./modals";
import { StatusPill } from "./common";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { removalModeOf, useProcTaskAction } from "./taskActions";

const QUANTITY_FORMATTER = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });

function formatQuantity(value: number) {
  return QUANTITY_FORMATTER.format(value);
}

function taskDescription(task: ProcurementTask) {
  const detail = task.consumableNote?.trim() || task.rdTaskTitle?.trim() || task.spec.trim();
  return [task.materialName, detail].filter(Boolean).join(" · ");
}

export function ProcurementModuleDetail({
  materials,
  node,
  parentName,
  productName,
  tasks,
  onBack,
}: {
  materials: Material[];
  node: ProcTaskTreeNode;
  parentName?: string;
  productName: string;
  tasks: ProcurementTask[];
  onBack: () => void;
}) {
  const { t } = useI18n();
  const canCreate = usePermission("proc-task:create");
  const canEdit = usePermission("proc-task:create");
  const canDelete = usePermission("proc-task:delete");
  const canViewMaterials = usePermission("page:proc-materials");
  const material = useMemo(
    () => materials.find((item) => item.id === node.materialId) ?? null,
    [materials, node.materialId],
  );
  const moduleTasks = useMemo(() => {
    const taskIds = new Set(node.taskIds);
    return tasks
      .filter((task) => task.productId === node.productId && taskIds.has(task.id))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }, [node.productId, node.taskIds, tasks]);
  const [inventory, setInventory] = useState<TplusInventoryDetail | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryVersion, setInventoryVersion] = useState(0);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [openTask, setOpenTask] = useState<ProcurementTask | null>(null);
  const [editTask, setEditTask] = useState<ProcurementTask | null>(null);
  const taskAction = useProcTaskAction({ onOpenDetail: setOpenTask });
  const inventoryCode = material?.tpInventoryCode?.trim() || null;

  const retryInventory = useCallback(() => {
    setInventoryVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    setInventory(null);
    setInventoryError(null);
    setInventoryLoading(false);
    if (!inventoryCode) return;

    const controller = new AbortController();
    setInventoryLoading(true);
    void getTplusInventoryDetail(inventoryCode, controller.signal)
      .then((result) => setInventory(result))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInventoryError(error instanceof Error ? error.message : t("仓库库存加载失败"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setInventoryLoading(false);
      });
    return () => controller.abort();
  }, [inventoryCode, inventoryVersion, t]);

  useEffect(() => {
    setOpenTask((current) => current ? moduleTasks.find((task) => task.id === current.id) ?? null : null);
    setEditTask((current) => current ? moduleTasks.find((task) => task.id === current.id) ?? null : null);
  }, [moduleTasks]);

  const item = inventory?.item;
  const totalStock = item?.stock ?? material?.stockQty ?? 0;
  const taskDefaults = {
    productId: node.productId,
    materialId: node.materialId ?? undefined,
    materialName: material?.name ?? node.name,
    spec: material?.spec ?? node.spec ?? undefined,
    unit: material?.unit ?? undefined,
  };

  return (
    <section className="proc-horizon-module-detail material-card flex min-h-0 flex-1 flex-col overflow-hidden border-slate-200 bg-white shadow-sm">
      <header className="proc-horizon-module-header flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="proc-horizon-module-identity flex min-w-0 flex-1 basis-96 items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label={t("返回子系统全景")}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-primary/25 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <p className="break-words text-pretty text-xs text-slate-500">
              {t(productName)}{parentName ? ` / ${parentName}` : ""}
            </p>
            <h2 className="mt-0.5 break-words text-balance text-lg font-semibold text-slate-950">
              <AutoTranslatedText text={node.name} />
            </h2>
            <p className="mt-0.5 break-words text-pretty text-xs text-slate-500">
              {[node.code, node.spec].filter(Boolean).join(" · ") || t("模块库存与采购任务详情")}
            </p>
          </div>
        </div>
        <div className="proc-horizon-module-actions flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-50 px-3 text-xs text-slate-600">
            <Boxes className="size-3.5 text-slate-400" />
            {t("库存")} <strong className="tabular-nums text-slate-900">{formatQuantity(totalStock)}</strong>
          </span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs text-primary">
            <ClipboardList className="size-3.5" />
            {t("任务")} <strong className="tabular-nums">{moduleTasks.length}</strong>
          </span>
          {canCreate && (
            <button
              type="button"
              onClick={() => setNewTaskOpen(true)}
              className="material-button-primary inline-flex h-8 items-center gap-1.5 px-3 text-xs"
            >
              <Plus className="size-3.5" />
              {t("新增任务")}
            </button>
          )}
        </div>
      </header>

      <div className="proc-horizon-module-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4 lg:p-5">
        <section className="proc-horizon-module-inventory flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="text-balance text-sm font-semibold text-slate-900">{t("仓库库存")}</h3>
              <p className="mt-0.5 break-words text-pretty text-xs text-slate-500">
                {inventoryCode ? `${t("T+ 存货编码")}：${inventoryCode}` : t("当前模块未关联 T+ 存货编码")}
              </p>
            </div>
            {inventoryCode && (
              <button
                type="button"
                onClick={retryInventory}
                disabled={inventoryLoading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
              >
                <RefreshCw className={cn("size-3.5", inventoryLoading && "animate-spin motion-reduce:animate-none")} />
                {t("刷新")}
              </button>
            )}
          </div>

          <div className="proc-horizon-module-inventory-body max-h-96 overflow-y-auto">
            {inventoryLoading ? (
              <div className="proc-horizon-module-inventory-stats grid grid-cols-2 gap-3 p-4" aria-label={t("正在加载仓库库存")}>
                {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />)}
              </div>
            ) : inventoryError ? (
              <div role="alert" className="m-4 flex flex-col items-center rounded-lg border border-dashed border-rose-200 bg-rose-50 px-4 py-6 text-center text-xs text-rose-700">
                <AlertTriangle className="size-6 text-rose-500" />
                <p className="mt-2 font-semibold">{t("仓库库存加载失败")}</p>
                <p className="mt-1 max-w-lg text-pretty text-rose-600">{inventoryError}</p>
                <button type="button" onClick={retryInventory} className="material-button-secondary mt-3 px-3 py-1.5 text-xs">{t("重新加载")}</button>
              </div>
            ) : !inventoryCode || !item ? (
              <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
                <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                  <Warehouse aria-hidden="true" className="size-7 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-600">{t("暂无仓库库存明细")}</p>
                    <p className="mt-1 text-pretty text-xs text-slate-500">{t("下一步：前往物料库关联 T+ 存货编码，并执行一次库存同步。")}</p>
                  </div>
                </div>
                {canViewMaterials && (
                  <Link to={routePath("page:proc-materials", "/proc-materials")} className="material-button-secondary inline-flex min-h-9 shrink-0 items-center justify-center px-3 py-2 text-xs">
                    {t("查看物料库")}
                  </Link>
                )}
              </div>
            ) : (
              <div className="p-4">
                <div className="proc-horizon-module-inventory-stats mb-4 grid grid-cols-2 gap-3">
                  <InventoryStat icon={Boxes} label={t("现存量")} value={item.stock} />
                  <InventoryStat icon={PackageCheck} label={t("可用量")} value={item.available} />
                  <InventoryStat icon={Truck} label={t("在途量")} value={item.in} />
                  <InventoryStat icon={Warehouse} label={t("仓库数")} value={item.warehouses.length} integer />
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2.5 font-medium">{t("仓库")}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("现存量")}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("可用量")}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("在途量")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {item.warehouses.map((warehouse) => (
                        <tr key={warehouse.name} className="text-slate-600">
                          <td className="px-3 py-2.5 font-medium text-slate-800">{warehouse.name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatQuantity(warehouse.stock)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatQuantity(warehouse.available)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatQuantity(warehouse.inTransit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {item.syncedAt && <p className="mt-2 text-right text-[11px] tabular-nums text-slate-500">{t("库存同步时间")}：{new Date(item.syncedAt).toLocaleString("zh-CN")}</p>}
              </div>
            )}
          </div>
        </section>

        <section className="proc-horizon-module-tasks flex shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="text-balance text-sm font-semibold text-slate-900">{t("任务列表")}</h3>
              <p className="mt-0.5 text-pretty text-xs text-slate-500">{t("当前模块关联的全部采购任务")}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] tabular-nums text-slate-500">{moduleTasks.length}</span>
          </div>

          {moduleTasks.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                <ClipboardList aria-hidden="true" className="size-7 shrink-0 text-slate-400" />
                <p className="text-pretty text-sm font-medium text-slate-600">{t("该模块暂无采购任务")}</p>
              </div>
              {canCreate && <button type="button" onClick={() => setNewTaskOpen(true)} className="material-button-secondary inline-flex min-h-9 shrink-0 items-center justify-center px-3 py-2 text-xs font-semibold text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{t("创建第一条任务")}</button>}
            </div>
          ) : (
            <div className="proc-horizon-module-task-scroll max-h-96 overflow-auto">
              <table className="proc-horizon-module-task-table w-full min-w-4xl table-fixed text-left text-xs">
                <colgroup>
                  <col className="w-72" />
                  <col className="w-28" />
                  <col className="w-24" />
                  <col className="w-36" />
                  <col className="w-28" />
                  <col className="w-36" />
                </colgroup>
                <thead className="sticky top-0 z-20 bg-slate-50 text-slate-500">
                  <tr>
                    <th scope="col" className="proc-horizon-module-task-identity sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-4 py-2.5 font-medium">{t("任务")}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{t("状态")}</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("数量")}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{t("负责人")}</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">{t("创建时间")}</th>
                    <th scope="col" className="proc-horizon-module-task-actions sticky right-0 z-20 border-l border-slate-200 bg-slate-50 px-4 py-2.5 text-right font-medium">{t("操作")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {moduleTasks.map((task) => (
                    <tr key={task.id} className="group text-slate-600 hover:bg-slate-50">
                      <td className="proc-horizon-module-task-identity sticky left-0 z-10 border-r border-slate-100 bg-white px-4 py-3 group-hover:bg-slate-50">
                        <button type="button" onClick={() => setOpenTask(task)} className="block w-full min-w-0 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
                          <span className="block font-semibold text-slate-900">{task.code}</span>
                          <span className="mt-0.5 line-clamp-2 break-words text-pretty text-xs text-slate-500" title={taskDescription(task)}>{taskDescription(task)}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3"><StatusPill status={task.status} /></td>
                      <td className="break-words px-3 py-3 text-right tabular-nums">{formatQuantity(task.quantity)} {t(task.unit)}</td>
                      <td className="px-3 py-3"><span className="line-clamp-2 break-words" title={task.buyer || t("未指派")}>{task.buyer || t("未指派")}</span></td>
                      <td className="px-3 py-3 tabular-nums text-slate-500">{new Date(task.createdAt).toLocaleDateString("zh-CN")}</td>
                      <td className="proc-horizon-module-task-actions sticky right-0 z-10 border-l border-slate-100 bg-white px-4 py-3 group-hover:bg-slate-50">
                        <div className="flex items-center justify-end gap-1">
                          <TaskActionButton label={t("查看")} icon={Eye} onClick={() => setOpenTask(task)} />
                          {canEdit && <TaskActionButton label={t("编辑")} icon={Pencil} onClick={() => setEditTask(task)} />}
                          {canDelete && removalModeOf(task) !== "review" && (
                            <TaskActionButton
                              label={removalModeOf(task) === "cancel" ? t("取消任务") : t("删除")}
                              icon={Trash2}
                              danger
                              onClick={() => taskAction.remove(task)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {newTaskOpen && <NewRequirementModal onClose={() => setNewTaskOpen(false)} defaults={taskDefaults} lockContext />}
      {openTask && <TaskDetailDrawer task={openTask} onClose={() => setOpenTask(null)} />}
      {editTask && <EditTaskModal task={editTask} onClose={() => setEditTask(null)} />}
      {taskAction.modal}
    </section>
  );
}

function InventoryStat({
  icon: Icon,
  integer = false,
  label,
  value,
}: {
  icon: typeof Boxes;
  integer?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-slate-50 px-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm"><Icon className="size-4" /></span>
      <span className="min-w-0 break-words">
        <strong className="block text-lg font-semibold tabular-nums text-slate-900">{integer ? value : formatQuantity(value)}</strong>
        <span className="text-[11px] text-slate-500">{label}</span>
      </span>
    </div>
  );
}

function TaskActionButton({
  danger = false,
  icon: Icon,
  label,
  onClick,
}: {
  danger?: boolean;
  icon: typeof Eye;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        danger && "hover:bg-rose-50 hover:text-rose-600",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
