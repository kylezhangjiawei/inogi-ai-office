import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Database,
  Eye,
  EyeOff,
  ListTree,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Skeleton } from "./components/ui/skeleton";
import { cn } from "./components/ui/utils";
import {
  DictionaryType,
  EmailDictionaryItem,
  GenericDictionaryItem,
  dictionaryApi,
} from "./lib/dictionaryApi";

const PAGE_SIZE = 5;
const TABLE_HEADER_CLASS = "whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600";
const TABLE_CELL_CLASS = "px-4 py-3.5 align-middle text-sm text-slate-700";

type DialogMode =
  | "add-type"
  | "edit-type"
  | "delete-type"
  | "add-email"
  | "edit-email"
  | "add-generic"
  | "edit-generic"
  | "delete-row"
  | null;

type FormErrors = Partial<Record<"typeLabel" | "account" | "password" | "code" | "label", string>>;

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function dictionaryItemName(item: EmailDictionaryItem | GenericDictionaryItem | null) {
  if (!item) return "当前条目";
  return item.kind === "email" ? item.account : item.label;
}

function ActionIconButton({
  label,
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: React.ReactNode }) {
  return (
    <Button
      {...props}
      type={props.type ?? "button"}
      variant="outline"
      size="icon"
      className={cn("size-9 rounded-lg text-slate-600", className)}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

function TableLoadingRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 3 }, (_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className={TABLE_CELL_CLASS}>
              <Skeleton className={cn("h-4", columnIndex === columns - 1 ? "ml-auto w-16" : "w-full max-w-36")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DictionaryList() {
  const [dictTypes, setDictTypes] = useState<DictionaryType[]>([]);
  const [activeTypeId, setActiveTypeId] = useState("");
  const [items, setItems] = useState<(EmailDictionaryItem | GenericDictionaryItem)[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [operators, setOperators] = useState<string[]>([]);
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});

  const [loadingTypes, setLoadingTypes] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadTypesError, setLoadTypesError] = useState("");
  const [loadItemsError, setLoadItemsError] = useState("");
  const [savingType, setSavingType] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [deletingType, setDeletingType] = useState(false);
  const [deletingItem, setDeletingItem] = useState(false);

  const [keyword, setKeyword] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [jumpInput, setJumpInput] = useState("");

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [dialogError, setDialogError] = useState("");
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [editEmailId, setEditEmailId] = useState<string | null>(null);
  const [editGenericId, setEditGenericId] = useState<string | null>(null);
  const [deleteTypeId, setDeleteTypeId] = useState<string | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);

  const [fTypeLabel, setFTypeLabel] = useState("");
  const [fAccount, setFAccount] = useState("");
  const [fPassword, setFPassword] = useState("");
  const [fCode, setFCode] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fRemark, setFRemark] = useState("");

  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const stableTypeFocusRef = useRef<HTMLButtonElement | null>(null);
  const stableItemFocusRef = useRef<HTMLInputElement | null>(null);
  const typeLabelRef = useRef<HTMLInputElement | null>(null);
  const accountRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  const labelRef = useRef<HTMLInputElement | null>(null);
  const typesRequestRef = useRef(0);
  const itemsRequestRef = useRef(0);

  const activeType = dictTypes.find((item) => item.id === activeTypeId) ?? null;
  const emailRows = activeType?.kind === "email" ? (items as EmailDictionaryItem[]) : [];
  const genericRows = activeType?.kind === "generic" ? (items as GenericDictionaryItem[]) : [];
  const emailTypeCount = dictTypes.filter((item) => item.kind === "email").length;
  const genericTypeCount = dictTypes.length - emailTypeCount;
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(page, safeTotalPages);
  const hasActiveFilters = Boolean(keyword.trim()) || operatorFilter !== "ALL";
  const formDialogOpen = ["add-type", "edit-type", "add-email", "edit-email", "add-generic", "edit-generic"].includes(dialogMode ?? "");
  const deleteDialogOpen = dialogMode === "delete-type" || dialogMode === "delete-row";
  const deleteTargetType = dictTypes.find((item) => item.id === deleteTypeId) ?? null;
  const deleteTargetRow = items.find((item) => item.id === deleteRowId) ?? null;
  const dialogBusy = savingType || savingItem;
  const deleteBusy = deletingType || deletingItem;

  const loadTypes = useCallback(async (preferredTypeId?: string | null) => {
    const requestId = ++typesRequestRef.current;
    setLoadingTypes(true);
    setLoadTypesError("");
    try {
      const response = await dictionaryApi.listTypes();
      if (requestId !== typesRequestRef.current) return;
      setDictTypes(response);
      setActiveTypeId((current) => {
        if (preferredTypeId && response.some((item) => item.id === preferredTypeId)) return preferredTypeId;
        if (current && response.some((item) => item.id === current)) return current;
        return response[0]?.id ?? "";
      });
      if (!response.length) {
        setItems([]);
        setTotal(0);
        setTotalPages(1);
        setOperators([]);
      }
    } catch (error) {
      if (requestId !== typesRequestRef.current) return;
      const message = error instanceof Error ? error.message : "读取字典类型失败";
      setLoadTypesError(message);
      toast.error(message);
    } finally {
      if (requestId === typesRequestRef.current) setLoadingTypes(false);
    }
  }, []);

  const loadItems = useCallback(async (targetTypeId = activeTypeId, targetPage = page) => {
    const requestId = ++itemsRequestRef.current;
    if (!targetTypeId) {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
      setOperators([]);
      setLoadItemsError("");
      setLoadingItems(false);
      return;
    }
    setLoadingItems(true);
    setLoadItemsError("");
    try {
      const response = await dictionaryApi.listItems(targetTypeId, {
        page: targetPage,
        pageSize: PAGE_SIZE,
        keyword,
        operator: operatorFilter,
      });
      if (requestId !== itemsRequestRef.current) return;
      const nextTotalPages = Math.max(1, response.total_pages);
      setItems(response.items);
      setTotal(response.total);
      setTotalPages(nextTotalPages);
      setOperators(response.operators);
      if (targetPage > nextTotalPages) setPage(nextTotalPages);
    } catch (error) {
      if (requestId !== itemsRequestRef.current) return;
      const message = error instanceof Error ? error.message : "读取字典条目失败";
      setLoadItemsError(message);
      toast.error(message);
    } finally {
      if (requestId === itemsRequestRef.current) setLoadingItems(false);
    }
  }, [activeTypeId, keyword, operatorFilter, page]);

  useEffect(() => { void loadTypes(); }, [loadTypes]);
  useEffect(() => {
    setKeyword("");
    setOperatorFilter("ALL");
    setPage(1);
    setJumpInput("");
    setShowPwd({});
  }, [activeTypeId]);
  useEffect(() => { setPage(1); }, [keyword, operatorFilter]);
  useEffect(() => { void loadItems(); }, [loadItems]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  function rememberTrigger(trigger: HTMLElement) {
    dialogTriggerRef.current = trigger;
    setDialogError("");
    setFormErrors({});
  }

  function closeDialog() {
    setDialogMode(null);
    setDialogError("");
    setFormErrors({});
  }

  function openAddType(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setFTypeLabel("");
    setEditTypeId(null);
    setDialogMode("add-type");
  }

  function openEditType(type: DictionaryType, event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setEditTypeId(type.id);
    setFTypeLabel(type.label);
    setDialogMode("edit-type");
  }

  function openDeleteType(typeId: string, event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setDeleteTypeId(typeId);
    setDialogMode("delete-type");
  }

  function openAddEmail(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setFAccount("");
    setFPassword("");
    setEditEmailId(null);
    setDialogMode("add-email");
  }

  function openEditEmail(row: EmailDictionaryItem, event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setFAccount(row.account);
    setFPassword(row.password);
    setEditEmailId(row.id);
    setDialogMode("edit-email");
  }

  function openAddGeneric(event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setFCode("");
    setFLabel("");
    setFRemark("");
    setEditGenericId(null);
    setDialogMode("add-generic");
  }

  function openEditGeneric(row: GenericDictionaryItem, event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setFCode(row.code);
    setFLabel(row.label);
    setFRemark(row.remark);
    setEditGenericId(row.id);
    setDialogMode("edit-generic");
  }

  function openDeleteRow(itemId: string, event: React.MouseEvent<HTMLButtonElement>) {
    rememberTrigger(event.currentTarget);
    setDeleteRowId(itemId);
    setDialogMode("delete-row");
  }

  function focusFirstInvalid(errors: FormErrors) {
    const first = ([
      ["typeLabel", typeLabelRef],
      ["account", accountRef],
      ["password", passwordRef],
      ["code", codeRef],
      ["label", labelRef],
    ] as const).find(([key]) => Boolean(errors[key]));
    window.requestAnimationFrame(() => first?.[1].current?.focus());
  }

  async function submitType() {
    const errors: FormErrors = {};
    if (!fTypeLabel.trim()) errors.typeLabel = "请输入类型名称";
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      focusFirstInvalid(errors);
      return;
    }
    setSavingType(true);
    setDialogError("");
    try {
      const saved = await dictionaryApi.saveType({ id: editTypeId ?? undefined, label: fTypeLabel.trim() });
      toast.success(editTypeId ? "字典类型已更新" : "字典类型已新增");
      closeDialog();
      await loadTypes(saved.id);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "保存字典类型失败");
    } finally {
      setSavingType(false);
    }
  }

  async function submitEmail() {
    if (!activeTypeId) return;
    const errors: FormErrors = {};
    if (!fAccount.trim()) errors.account = "请输入邮箱账号";
    if (!fPassword) errors.password = "请输入邮箱密码";
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      focusFirstInvalid(errors);
      return;
    }
    setSavingItem(true);
    setDialogError("");
    try {
      await dictionaryApi.saveItem(activeTypeId, { id: editEmailId ?? undefined, account: fAccount.trim(), password: fPassword });
      toast.success(editEmailId ? "邮箱账号已更新" : "邮箱账号已新增");
      closeDialog();
      if (page !== 1) setPage(1);
      else await loadItems(activeTypeId, 1);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "保存邮箱账号失败");
    } finally {
      setSavingItem(false);
    }
  }

  async function submitGeneric() {
    if (!activeTypeId) return;
    const errors: FormErrors = {};
    if (!fCode.trim()) errors.code = "请输入条目编码";
    if (!fLabel.trim()) errors.label = "请输入显示标签";
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      focusFirstInvalid(errors);
      return;
    }
    setSavingItem(true);
    setDialogError("");
    try {
      await dictionaryApi.saveItem(activeTypeId, {
        id: editGenericId ?? undefined,
        code: fCode.trim(),
        label: fLabel.trim(),
        remark: fRemark.trim(),
      });
      toast.success(editGenericId ? "字典条目已更新" : "字典条目已新增");
      closeDialog();
      if (page !== 1) setPage(1);
      else await loadItems(activeTypeId, 1);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "保存字典条目失败");
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmDeleteType() {
    if (!deleteTypeId) return;
    const currentIndex = dictTypes.findIndex((item) => item.id === deleteTypeId);
    const fallbackTypeId = dictTypes[currentIndex + 1]?.id ?? dictTypes[currentIndex - 1]?.id ?? "";
    setDeletingType(true);
    setDialogError("");
    try {
      await dictionaryApi.deleteType(deleteTypeId);
      toast.success("字典类型已删除");
      dialogTriggerRef.current = stableTypeFocusRef.current;
      closeDialog();
      await loadTypes(fallbackTypeId);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "删除字典类型失败");
    } finally {
      setDeletingType(false);
    }
  }

  async function confirmDeleteRow() {
    if (!deleteRowId) return;
    setDeletingItem(true);
    setDialogError("");
    try {
      await dictionaryApi.deleteItem(deleteRowId);
      toast.success("字典条目已删除");
      dialogTriggerRef.current = stableItemFocusRef.current;
      closeDialog();
      await loadItems();
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "删除字典条目失败");
    } finally {
      setDeletingItem(false);
    }
  }

  function handleJump() {
    const value = Number.parseInt(jumpInput, 10);
    if (Number.isNaN(value)) {
      setJumpInput("");
      return;
    }
    setPage(Math.min(safeTotalPages, Math.max(1, value)));
    setJumpInput("");
  }

  function clearFilters() {
    setKeyword("");
    setOperatorFilter("ALL");
  }

  const formDialogTitle = dialogMode === "add-type"
    ? "新增字典类型"
    : dialogMode === "edit-type"
      ? "编辑字典类型"
      : dialogMode === "add-email"
        ? "新增邮箱账号"
        : dialogMode === "edit-email"
          ? "编辑邮箱账号"
          : dialogMode === "add-generic"
            ? `新增 · ${activeType?.label ?? "字典条目"}`
            : `编辑 · ${activeType?.label ?? "字典条目"}`;

  return (
    <div className="horizon-theme hz-page">
      <div className="hz-page-inner space-y-3">
        <HorizonPageHeader
          Icon={Database}
          eyebrow="SYSTEM MANAGEMENT · DATA DICTIONARY"
          title="字典列表"
          description="集中维护全局枚举、邮箱账号与业务基础数据；先选择左侧类型，再管理对应条目。"
          meta={(
            <>
              <span>每页 <span className="tabular-nums">{PAGE_SIZE}</span> 条</span>
              <span>当前类型：{activeType?.label ?? "未选择"}</span>
            </>
          )}
          actions={(
            <>
              <Button type="button" variant="outline" onClick={() => void loadTypes()} disabled={loadingTypes}>
                <RefreshCw className={cn("size-4", loadingTypes && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                刷新类型
              </Button>
              <Button type="button" className="hz-primary-action" onClick={openAddType} disabled={savingType}>
                <Plus className="size-4" aria-hidden="true" />
                新增类型
              </Button>
            </>
          )}
        />

        <HorizonMetricGrid>
          <HorizonMetric Icon={ListTree} label="字典类型" value={dictTypes.length} note="全部可维护类型" />
          <HorizonMetric Icon={BookOpen} label="通用类型" value={genericTypeCount} note="编码、标签与备注" tone="brand" />
          <HorizonMetric Icon={Mail} label="邮箱类型" value={emailTypeCount} note="受控账号与凭据" tone="warning" />
          <HorizonMetric Icon={Rows3} label="当前条目" value={total} note={activeType?.label ?? "请选择类型"} tone="success" />
        </HorizonMetricGrid>

        <section className="grid min-w-0 gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader
              Icon={ListTree}
              title="字典类型"
              description="选择类型后查看对应条目"
              trailing={(
                <Button ref={stableTypeFocusRef} type="button" variant="outline" size="sm" onClick={openAddType}>
                  <Plus className="size-4" aria-hidden="true" />
                  新增
                </Button>
              )}
            />
            <div className="space-y-1 p-2">
              {loadingTypes && dictTypes.length === 0 ? (
                Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-11 w-full rounded-xl" />)
              ) : loadTypesError && dictTypes.length === 0 ? (
                <HorizonEmptyState
                  Icon={Database}
                  title="字典类型加载失败"
                  description={loadTypesError}
                  action={<Button type="button" variant="outline" size="sm" onClick={() => void loadTypes()}>重新加载</Button>}
                />
              ) : dictTypes.length === 0 ? (
                <HorizonEmptyState
                  Icon={ListTree}
                  title="暂无字典类型"
                  description="创建第一个类型后即可维护业务条目。"
                  action={<Button type="button" size="sm" className="hz-primary-action" onClick={openAddType}>新增类型</Button>}
                />
              ) : (
                dictTypes.map((type) => (
                  <div
                    key={type.id}
                    className={cn(
                      "flex min-w-0 items-center gap-1 rounded-xl border px-1.5 py-1",
                      activeTypeId === type.id ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm focus-visible:outline-none",
                        activeTypeId === type.id ? "font-semibold text-[#002fa7]" : "text-slate-700",
                      )}
                      aria-pressed={activeTypeId === type.id}
                      onClick={() => setActiveTypeId(type.id)}
                    >
                      <span className="block truncate">{type.label}</span>
                      <span className="mt-0.5 block text-xs font-normal text-slate-500">{type.kind === "email" ? "邮箱账号" : "通用枚举"}</span>
                    </button>
                    <ActionIconButton label={`编辑类型：${type.label}`} className="border-transparent bg-transparent" onClick={(event) => openEditType(type, event)}>
                      <Pencil className="size-4" aria-hidden="true" />
                    </ActionIconButton>
                    {type.key !== "ai_provider" ? (
                      <ActionIconButton label={`删除类型：${type.label}`} className="border-transparent bg-transparent text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDeleteType(type.id, event)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </ActionIconButton>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="hz-surface min-w-0 overflow-hidden">
            <HorizonSectionHeader
              Icon={activeType?.kind === "email" ? Mail : Rows3}
              title={activeType?.label ?? "字典条目"}
              description={activeType ? `${activeType.kind === "email" ? "邮箱账号" : "通用枚举"} · 共 ${total} 条` : "请先选择或创建一个字典类型"}
              trailing={activeType ? (
                <Button
                  type="button"
                  size="sm"
                  className="hz-primary-action"
                  onClick={(event) => activeType.kind === "email" ? openAddEmail(event) : openAddGeneric(event)}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  新增条目
                </Button>
              ) : null}
            />

            <div className="hz-toolbar flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Label htmlFor="dictionary-search" className="sr-only">搜索字典条目</Label>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  ref={stableItemFocusRef}
                  id="dictionary-search"
                  type="search"
                  className="pl-9"
                  placeholder={activeType?.kind === "email" ? "搜索账号或操作人" : "搜索编码、标签或备注"}
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  disabled={!activeType}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Label htmlFor="dictionary-operator-filter" className="sr-only">按操作人筛选</Label>
                <Select value={operatorFilter} onValueChange={setOperatorFilter} disabled={!activeType}>
                  <SelectTrigger id="dictionary-operator-filter" className="w-full sm:w-44" aria-label="按操作人筛选">
                    <SelectValue placeholder="全部操作人" />
                  </SelectTrigger>
                  <SelectContent className="horizon-portal">
                    <SelectItem value="ALL">全部操作人</SelectItem>
                    {operators.map((operator) => <SelectItem key={operator} value={operator}>{operator}</SelectItem>)}
                  </SelectContent>
                </Select>
                {hasActiveFilters ? <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>清除筛选</Button> : null}
              </div>
            </div>

            {!activeType ? (
              <HorizonEmptyState Icon={ListTree} title="请选择字典类型" description="从左侧选择现有类型，或新建类型后再添加条目。" />
            ) : loadItemsError && !loadingItems ? (
              <HorizonEmptyState Icon={Database} title="条目加载失败" description={loadItemsError} action={<Button type="button" variant="outline" size="sm" onClick={() => void loadItems()}>重新加载</Button>} />
            ) : (
              <>
                <div className="min-w-0 overflow-x-auto">
                  {activeType.kind === "email" ? (
                    <table className="w-full min-w-[820px] border-collapse text-left">
                      <caption className="sr-only">{activeType.label}邮箱账号列表</caption>
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th scope="col" className={TABLE_HEADER_CLASS}>账号</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>密码</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>操作时间</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>操作人</th>
                          <th scope="col" className={cn(TABLE_HEADER_CLASS, "text-right")}>操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loadingItems ? <TableLoadingRows columns={5} /> : emailRows.length === 0 ? (
                          <tr><td colSpan={5}><HorizonEmptyState
                            Icon={Mail}
                            title={hasActiveFilters ? "没有匹配的邮箱账号" : "暂无邮箱账号"}
                            description={hasActiveFilters ? "调整搜索或操作人筛选后重试。" : "新增账号后会显示在这里。"}
                            action={hasActiveFilters
                              ? <Button type="button" variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button>
                              : <Button type="button" size="sm" className="hz-primary-action" onClick={openAddEmail}>新增账号</Button>}
                          /></td></tr>
                        ) : emailRows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50">
                            <td className={TABLE_CELL_CLASS}><div className="max-w-64 truncate font-medium text-slate-900">{row.account}</div></td>
                            <td className={TABLE_CELL_CLASS}>
                              <div className="flex items-center gap-2">
                                <span className="max-w-40 truncate font-mono text-xs">{showPwd[row.id] ? row.password : "••••••••"}</span>
                                <Button type="button" variant="ghost" size="icon" className="size-8 rounded-lg" aria-label={`${showPwd[row.id] ? "隐藏" : "显示"}${row.account}的密码`} aria-pressed={Boolean(showPwd[row.id])} onClick={() => setShowPwd((current) => ({ ...current, [row.id]: !current[row.id] }))}>
                                  {showPwd[row.id] ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                                </Button>
                              </div>
                            </td>
                            <td className={cn(TABLE_CELL_CLASS, "whitespace-nowrap tabular-nums text-slate-500")}>{formatDate(row.updated_at)}</td>
                            <td className={TABLE_CELL_CLASS}><div className="max-w-40 truncate">{row.updated_by || "—"}</div></td>
                            <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                              <div className="flex justify-end gap-2">
                                <ActionIconButton label={`编辑邮箱账号：${row.account}`} onClick={(event) => openEditEmail(row, event)}><Pencil className="size-4" aria-hidden="true" /></ActionIconButton>
                                <ActionIconButton label={`删除邮箱账号：${row.account}`} className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDeleteRow(row.id, event)}><Trash2 className="size-4" aria-hidden="true" /></ActionIconButton>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full min-w-[920px] border-collapse text-left">
                      <caption className="sr-only">{activeType.label}通用字典条目列表</caption>
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th scope="col" className={TABLE_HEADER_CLASS}>编码</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>标签</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>备注</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>操作时间</th>
                          <th scope="col" className={TABLE_HEADER_CLASS}>操作人</th>
                          <th scope="col" className={cn(TABLE_HEADER_CLASS, "text-right")}>操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {loadingItems ? <TableLoadingRows columns={6} /> : genericRows.length === 0 ? (
                          <tr><td colSpan={6}><HorizonEmptyState
                            Icon={Rows3}
                            title={hasActiveFilters ? "没有匹配的字典条目" : "暂无字典条目"}
                            description={hasActiveFilters ? "调整搜索或操作人筛选后重试。" : "新增条目后会显示在这里。"}
                            action={hasActiveFilters
                              ? <Button type="button" variant="outline" size="sm" onClick={clearFilters}>清除筛选</Button>
                              : <Button type="button" size="sm" className="hz-primary-action" onClick={openAddGeneric}>新增条目</Button>}
                          /></td></tr>
                        ) : genericRows.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50">
                            <td className={cn(TABLE_CELL_CLASS, "font-mono text-xs text-slate-600")}><div className="max-w-40 truncate">{row.code}</div></td>
                            <td className={TABLE_CELL_CLASS}><div className="max-w-56 truncate font-medium text-slate-900">{row.label}</div></td>
                            <td className={TABLE_CELL_CLASS}><div className="max-w-64 truncate text-slate-500">{row.remark || "—"}</div></td>
                            <td className={cn(TABLE_CELL_CLASS, "whitespace-nowrap tabular-nums text-slate-500")}>{formatDate(row.updated_at)}</td>
                            <td className={TABLE_CELL_CLASS}><div className="max-w-40 truncate">{row.updated_by || "—"}</div></td>
                            <td className={cn(TABLE_CELL_CLASS, "text-right")}>
                              <div className="flex justify-end gap-2">
                                <ActionIconButton label={`编辑字典条目：${row.label}`} onClick={(event) => openEditGeneric(row, event)}><Pencil className="size-4" aria-hidden="true" /></ActionIconButton>
                                <ActionIconButton label={`删除字典条目：${row.label}`} className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={(event) => openDeleteRow(row.id, event)}><Trash2 className="size-4" aria-hidden="true" /></ActionIconButton>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                  <div>共 <span className="tabular-nums font-semibold text-slate-700">{total}</span> 条，第 <span className="tabular-nums">{safePage} / {safeTotalPages}</span> 页</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1 || loadingItems}>上一页</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setPage(Math.min(safeTotalPages, safePage + 1))} disabled={safePage === safeTotalPages || loadingItems}>下一页</Button>
                    <Label htmlFor="dictionary-page-jump" className="text-sm font-normal text-slate-500">跳转</Label>
                    <Input id="dictionary-page-jump" inputMode="numeric" className="h-8 w-16 text-center tabular-nums" value={jumpInput} onChange={(event) => setJumpInput(event.target.value.replace(/\D/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") handleJump(); }} placeholder={String(safePage)} />
                    <Button type="button" variant="outline" size="sm" onClick={handleJump} disabled={loadingItems}>前往</Button>
                  </div>
                </div>
              </>
            )}
          </section>
        </section>
      </div>

      <Dialog open={formDialogOpen} onOpenChange={(open) => { if (!open && !dialogBusy) closeDialog(); }}>
        <DialogContent
          className="horizon-portal max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
          }}
        >
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (dialogMode === "add-type" || dialogMode === "edit-type") void submitType();
              else if (dialogMode === "add-email" || dialogMode === "edit-email") void submitEmail();
              else void submitGeneric();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-balance text-slate-900">{formDialogTitle}</DialogTitle>
              <DialogDescription className="text-pretty">
                {dialogMode === "add-type" || dialogMode === "edit-type"
                  ? "类型名称会出现在左侧目录中。"
                  : dialogMode === "add-email" || dialogMode === "edit-email"
                    ? "维护邮箱账号与访问凭据，请确认信息来源和使用范围。"
                    : "编码用于系统识别，标签用于界面展示。"}
              </DialogDescription>
            </DialogHeader>

            {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}

            {dialogMode === "add-type" || dialogMode === "edit-type" ? (
              <div>
                <Label htmlFor="dictionary-type-label" className="mb-1.5 block text-sm font-semibold text-slate-700">类型名称 <span className="text-red-600">*</span></Label>
                <Input ref={typeLabelRef} id="dictionary-type-label" autoFocus placeholder="例如：产品系列" value={fTypeLabel} onChange={(event) => { setFTypeLabel(event.target.value); if (formErrors.typeLabel) setFormErrors((current) => ({ ...current, typeLabel: undefined })); }} aria-invalid={Boolean(formErrors.typeLabel)} aria-describedby={formErrors.typeLabel ? "dictionary-type-label-error" : undefined} />
                {formErrors.typeLabel ? <p id="dictionary-type-label-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.typeLabel}</p> : null}
              </div>
            ) : dialogMode === "add-email" || dialogMode === "edit-email" ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="dictionary-email-account" className="mb-1.5 block text-sm font-semibold text-slate-700">账号 <span className="text-red-600">*</span></Label>
                  <Input ref={accountRef} id="dictionary-email-account" autoFocus autoComplete="off" placeholder="example@domain.com" value={fAccount} onChange={(event) => { setFAccount(event.target.value); if (formErrors.account) setFormErrors((current) => ({ ...current, account: undefined })); }} aria-invalid={Boolean(formErrors.account)} aria-describedby={formErrors.account ? "dictionary-email-account-error" : undefined} />
                  {formErrors.account ? <p id="dictionary-email-account-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.account}</p> : null}
                </div>
                <div>
                  <Label htmlFor="dictionary-email-password" className="mb-1.5 block text-sm font-semibold text-slate-700">密码 <span className="text-red-600">*</span></Label>
                  <Input ref={passwordRef} id="dictionary-email-password" type="password" autoComplete="new-password" placeholder="输入密码" value={fPassword} onChange={(event) => { setFPassword(event.target.value); if (formErrors.password) setFormErrors((current) => ({ ...current, password: undefined })); }} aria-invalid={Boolean(formErrors.password)} aria-describedby={formErrors.password ? "dictionary-email-password-error" : undefined} />
                  {formErrors.password ? <p id="dictionary-email-password-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.password}</p> : null}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="dictionary-item-code" className="mb-1.5 block text-sm font-semibold text-slate-700">编码 <span className="text-red-600">*</span></Label>
                  <Input ref={codeRef} id="dictionary-item-code" autoFocus className="font-mono" placeholder="例如：XX-001" value={fCode} onChange={(event) => { setFCode(event.target.value); if (formErrors.code) setFormErrors((current) => ({ ...current, code: undefined })); }} aria-invalid={Boolean(formErrors.code)} aria-describedby={formErrors.code ? "dictionary-item-code-error" : undefined} />
                  {formErrors.code ? <p id="dictionary-item-code-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.code}</p> : null}
                </div>
                <div>
                  <Label htmlFor="dictionary-item-label" className="mb-1.5 block text-sm font-semibold text-slate-700">标签 <span className="text-red-600">*</span></Label>
                  <Input ref={labelRef} id="dictionary-item-label" placeholder="显示名称" value={fLabel} onChange={(event) => { setFLabel(event.target.value); if (formErrors.label) setFormErrors((current) => ({ ...current, label: undefined })); }} aria-invalid={Boolean(formErrors.label)} aria-describedby={formErrors.label ? "dictionary-item-label-error" : undefined} />
                  {formErrors.label ? <p id="dictionary-item-label-error" role="alert" className="mt-1.5 text-xs font-medium text-red-600">{formErrors.label}</p> : null}
                </div>
                <div>
                  <Label htmlFor="dictionary-item-remark" className="mb-1.5 block text-sm font-semibold text-slate-700">备注</Label>
                  <Input id="dictionary-item-remark" placeholder="可选" value={fRemark} onChange={(event) => setFRemark(event.target.value)} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog} disabled={dialogBusy}>取消</Button>
              <Button type="submit" className="hz-primary-action" disabled={dialogBusy}>{dialogBusy ? "保存中…" : "保存"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { if (!open && !deleteBusy) closeDialog(); }}>
        <AlertDialogContent
          className="horizon-portal sm:max-w-md"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = dialogTriggerRef.current;
            dialogTriggerRef.current = null;
            if (trigger?.isConnected) trigger.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance text-slate-900">{dialogMode === "delete-type" ? "确认删除字典类型？" : "确认删除字典条目？"}</AlertDialogTitle>
            <AlertDialogDescription className="text-pretty leading-6">
              {dialogMode === "delete-type"
                ? `将删除“${deleteTargetType?.label ?? "当前类型"}”及其全部条目。此操作不可恢复。`
                : `将删除“${dictionaryItemName(deleteTargetRow)}”。此操作不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialogError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{dialogError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>保留</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
              disabled={deleteBusy}
              onClick={(event) => {
                event.preventDefault();
                if (dialogMode === "delete-type") void confirmDeleteType();
                else void confirmDeleteRow();
              }}
            >
              {deleteBusy ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
