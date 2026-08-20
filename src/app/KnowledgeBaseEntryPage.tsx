import { useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { useAuth } from "./auth";
import { hasPermission } from "./lib/permissions";
import { useDepartmentDirectory } from "./lib/departmentDirectory";
import { t, useI18n } from "./lib/i18n";
import { useNavHiddenCodes } from "./lib/permissionCatalogApi";
import { routePath } from "./lib/routePaths";
import { DEPT_KBS } from "./routesConfig";
import { NativeSelect } from "./components/ui/native-select";
import { RDKnowledgeBasePage } from "./RDKnowledgeBasePage";

/**
 * 知识库统一入口（部门库 + 研发库）。
 *
 * 这些库本来就复用同一个页面组件，差别只在 kbId；原先各挂一条路由，侧栏被十几个
 * 「XX部知识库」占满。这里合成一个入口，库在页内下拉切换：
 * - 能切的范围由权限决定（部门库看 page:dept-kb-{id}，研发库看 page:rd-knowledge-base）
 * - 底层一律没动：研发库仍走 /knowledge/* 与 rd-kb:* 权限，部门库走 /dept-knowledge/{id}/*
 *   与 dept-kb:*，存储键与 OSS 路径各自隔离，后端 guard 逐请求校验
 * - URL 仍是各自的老地址（/rd-knowledge-base、/dept-kb/{id}）：老链接、刷新、面包屑照旧
 */
const LAST_KB_KEY = "inogi-kb-last";
/** 研发库在下拉里的取值：它没有 kbId（kbScope 传 undefined），用这个哨兵区分。 */
const RD_KB_VALUE = "__rd__";

function readLastKb(): string | null {
  try {
    return window.localStorage.getItem(LAST_KB_KEY);
  } catch {
    return null;
  }
}

function writeLastKb(value: string) {
  try {
    window.localStorage.setItem(LAST_KB_KEY, value);
  } catch {
    /* 隐私模式写不了，忽略 */
  }
}

export function KnowledgeBaseEntryPage({ scope }: { scope?: "rd" } = {}) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { nameByCode } = useDepartmentDirectory();
  const navHiddenCodes = useNavHiddenCodes(user?.id);
  // 订阅语言与词典就绪：库名在渲染处走 t()，与侧栏、面包屑用同一本词典
  // （英文态下「人事行政部知识库」→「HR & Admin KB」）
  useI18n();

  const permissions = user?.permissions ?? [];
  const permissionKey = permissions.join("|");
  const rdPath = routePath("page:rd-knowledge-base", "/rd-knowledge-base");

  const accessibleDepts = useMemo(
    () => DEPT_KBS.filter((item) => hasPermission(permissions, `page:dept-kb-${item.id}`)),
    // permissions 每次渲染都是新数组，用拼串做依赖，避免无谓重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionKey],
  );
  const canUseRdKb = hasPermission(permissions, "page:rd-knowledge-base");

  const labelOf = useCallback(
    (item: (typeof DEPT_KBS)[number]) =>
      item.departmentCode ? nameByCode(item.departmentCode, item.label) : item.label,
    [nameByCode],
  );

  const activeValue = scope === "rd" && canUseRdKb
    ? RD_KB_VALUE
    : id && accessibleDepts.some((item) => item.id === id)
      ? id
      : null;

  /**
   * 有权限的全部库。hidden = 在「角色权限」里被标成「导航隐藏」——沿用目录里
   * 「隐藏但仍可访问」的既有语义：不进下拉，但直链打开照样能用。
   */
  const accessible = useMemo(
    () => [
      ...accessibleDepts.map((item) => ({
        value: item.id,
        label: `${labelOf(item)}知识库`,
        hidden: navHiddenCodes.has(`page:dept-kb-${item.id}`),
      })),
      ...(canUseRdKb
        ? [{ value: RD_KB_VALUE, label: "研发知识库", hidden: navHiddenCodes.has("page:rd-knowledge-base") }]
        : []),
    ],
    // 这里存中文原文，翻译放到渲染处：词典是异步拉的，就绪时只 bump dictVersion 不改 lang，
    // 把 t() 的结果 memo 进来会永远停在首屏那次的语言（i18n.ts 里记着这个坑）。
    [accessibleDepts, canUseRdKb, labelOf, navHiddenCodes],
  );

  // 当前正打开的库即便被隐藏也要留在下拉里，否则选择器显示空白、看着像坏了
  const options = useMemo(
    () => accessible.filter((item) => !item.hidden || item.value === activeValue),
    [accessible, activeValue],
  );

  /** 落到哪个库：路由指定的 → 自己部门的 → 上次看过的 → 第一个没被隐藏的 → 第一个有权限的。 */
  const fallbackValue = useMemo(() => {
    const own = user?.departmentCode
      ? accessibleDepts.find((item) => item.departmentCode === user.departmentCode)
      : undefined;
    if (own && !navHiddenCodes.has(`page:dept-kb-${own.id}`)) return own.id;
    const last = readLastKb();
    if (last && accessible.some((item) => item.value === last && !item.hidden)) return last;
    // 全部被隐藏时仍回落到第一个有权限的库——隐藏只是不推荐，不该把人锁在门外
    return accessible.find((item) => !item.hidden)?.value ?? accessible[0]?.value ?? null;
  }, [accessible, accessibleDepts, navHiddenCodes, user?.departmentCode]);

  const goTo = useCallback(
    (value: string, replace = false) => {
      navigate(value === RD_KB_VALUE ? rdPath : `/dept-kb/${value}`, { replace });
    },
    [navigate, rdPath],
  );

  // URL 没指定库、或指定了个没权限的，就换成能访问的那个。replace 不留历史，
  // 免得用户点返回又被弹回来。
  useEffect(() => {
    if (activeValue || !fallbackValue) return;
    if (id) {
      const target = options.find((option) => option.value === fallbackValue);
      if (target) toast.info(t("没有该知识库的权限，已切到「{name}」", { name: t(target.label) }));
    }
    goTo(fallbackValue, true);
  }, [activeValue, fallbackValue, goTo, id, options]);

  useEffect(() => {
    if (activeValue) writeLastKb(activeValue);
  }, [activeValue]);

  // 按「有没有权限」判空，而不是按下拉里剩几个：全被设成导航隐藏时也不该报「没有权限」
  if (accessible.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
        <div className="text-4xl">🔒</div>
        <p className="text-base font-medium">{t("你还没有任何知识库的访问权限")}</p>
        <p className="text-sm text-slate-400">{t("如需开通，请联系系统管理员")}</p>
      </div>
    );
  }

  // 等上面的重定向把 URL 补上
  if (!activeValue) return null;

  const activeDept = activeValue === RD_KB_VALUE
    ? null
    : accessibleDepts.find((item) => item.id === activeValue)!;

  // 切换器直接塞进知识库页的工具条（和筛选、类型、权限分同一排）。
  // 单独占一行只放一个下拉，白吃掉一整条纵向空间，列表反而更挤。
  // 只有一个可访问的库时连下拉也不给，没什么可切的。
  const switcher = options.length > 1 ? (
    <NativeSelect
      value={activeValue}
      onValueChange={(value) => goTo(value)}
      aria-label={t("切换知识库")}
      className="h-9 w-auto min-w-[10rem] rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-shadow focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{t(option.label)}</option>
      ))}
    </NativeSelect>
  ) : null;

  // key 强制换库即重挂载：不加的话 React 会复用实例，上一个库的分类与条目会留在界面上
  return activeDept ? (
    <RDKnowledgeBasePage
      key={activeDept.id}
      kbScope={{ kbId: activeDept.id, label: labelOf(activeDept) }}
      toolbarLeading={switcher}
    />
  ) : (
    <RDKnowledgeBasePage key="kb-rd" toolbarLeading={switcher} />
  );
}
