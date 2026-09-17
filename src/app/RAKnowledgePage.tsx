import React, { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CircleCheck,
  FileCheck2,
  Filter,
  History,
  Layers3,
  Library,
  Search,
  ShieldCheck,
  Tag,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { cn } from "./components/ui/utils";
import { routePath } from "./lib/routePaths";

type Framework = "FDA" | "CE MDR" | "NMPA";
type RegType = "强制标准" | "指导原则" | "技术规范";
type SearchMode = "精确匹配" | "语义检索";

interface Clause {
  id: string;
  num: string;
  text: string;
  tags: string[];
}

interface Regulation {
  id: string;
  title: string;
  authority: string;
  version: string;
  date: string;
  framework: Framework;
  regType: RegType;
  category: string[];
  status: "有效" | "已废止";
  clauses: Clause[];
}

const mockRegulations: Regulation[] = [
  {
    id: "FDA-820",
    title: "21 CFR Part 820 – Quality System Regulation",
    authority: "FDA",
    version: "2024修订版",
    date: "2024-02-02",
    framework: "FDA",
    regType: "强制标准",
    category: ["CPAP", "BiPAP", "呼吸机"],
    status: "有效",
    clauses: [
      { id: "820.30", num: "§820.30", text: "设计控制 (Design Controls)：制造商应建立和维护设计控制程序，以确保满足指定的设计要求。", tags: ["硬件", "软件"] },
      { id: "820.75", num: "§820.75", text: "过程确认 (Process Validation)：当过程结果不能被后续检查和测试完全验证时，制造商应以高度保证验证该过程。", tags: ["生产"] },
      { id: "820.100", num: "§820.100", text: "纠正和预防措施 (CAPA)：制造商应建立和维护纠正和预防措施的程序。", tags: ["质量"] },
      { id: "820.181", num: "§820.181", text: "设备历史文件 (DHF)：制造商应维护设备历史文件。", tags: ["硬件", "软件", "质量"] },
    ],
  },
  {
    id: "CE-MDR-AnnexII",
    title: "MDR 2017/745 Annex II – Technical Documentation",
    authority: "EU Commission",
    version: "MDR 2017/745",
    date: "2021-05-26",
    framework: "CE MDR",
    regType: "强制标准",
    category: ["CPAP", "BiPAP"],
    status: "有效",
    clauses: [
      { id: "AII-1", num: "第 1 节", text: "设备描述和规格，包括变型和附件。设备预期用途、适应症、适用人群及设备与治疗目的的关系。", tags: ["硬件"] },
      { id: "AII-2", num: "第 2 节", text: "对制造商规格参考的信息，包括标准版本；该标准与符合 MDR 第 5 条相关的一般安全和性能要求的符合性声明。", tags: ["质量", "报警"] },
      { id: "AII-6", num: "第 6 节", text: "预期用途及临床评价报告，包含临床数据的汇总与临床评价计划。", tags: ["临床"] },
    ],
  },
  {
    id: "NMPA-REG",
    title: "医疗器械注册申报资料要求（2021年版）",
    authority: "国家药品监督管理局",
    version: "2021年第16号令",
    date: "2021-06-01",
    framework: "NMPA",
    regType: "强制标准",
    category: ["CPAP", "BiPAP", "呼吸机", "制氧机"],
    status: "有效",
    clauses: [
      { id: "NMPA-1", num: "第一条", text: "申请医疗器械注册，应当按照相关规定提交申报资料。第二类、三类医疗器械首次注册，应包含产品技术要求、安全性与有效性研究及综述资料。", tags: ["质量"] },
      { id: "NMPA-3", num: "第三条", text: "注册申请人应当提供充分证明医疗器械安全有效的资料，涵盖产品描述、非临床研究资料及临床评价资料。", tags: ["临床", "硬件", "软件"] },
    ],
  },
];

const frameworkColors: Record<Framework, string> = {
  FDA: "border-blue-200 bg-blue-50 text-blue-700",
  "CE MDR": "border-emerald-200 bg-emerald-50 text-emerald-700",
  NMPA: "border-rose-200 bg-rose-50 text-rose-700",
};

const tagColors: Record<string, string> = {
  报警: "border-orange-200 bg-orange-50 text-orange-700",
  电源: "border-yellow-200 bg-yellow-50 text-yellow-800",
  软件: "border-blue-200 bg-blue-50 text-blue-700",
  硬件: "border-sky-200 bg-sky-50 text-sky-700",
  临床: "border-cyan-200 bg-cyan-50 text-cyan-800",
  质量: "border-emerald-200 bg-emerald-50 text-emerald-700",
  生产: "border-amber-200 bg-amber-50 text-amber-800",
};

const ALL_FRAMEWORKS: Framework[] = ["FDA", "CE MDR", "NMPA"];
const ALL_REGTYPES: RegType[] = ["强制标准", "指导原则", "技术规范"];
const ALL_CATEGORIES = ["CPAP", "BiPAP", "呼吸机", "制氧机"];
const SEMANTIC_TERMS: Record<string, string[]> = {
  设计: ["design", "dhf", "设计控制"],
  质量: ["quality", "qsr", "capa", "纠正", "预防"],
  品质: ["质量", "quality", "qsr"],
  生产: ["process", "validation", "过程确认"],
  临床: ["clinical", "评价报告"],
  注册: ["registration", "申报", "nmpa"],
  技术文档: ["technical documentation", "annex ii"],
};

function matchesRegulation(regulation: Regulation, keyword: string, mode: SearchMode) {
  const searchableText = [
    regulation.title,
    regulation.authority,
    regulation.id,
    ...regulation.category,
    ...regulation.clauses.map((clause) => `${clause.num} ${clause.text} ${clause.tags.join(" ")}`),
  ].join(" ").toLowerCase();

  if (mode === "精确匹配") return searchableText.includes(keyword);

  const directTerms = keyword.split(/\s+/).filter(Boolean);
  const relatedTerms = Object.entries(SEMANTIC_TERMS)
    .filter(([concept]) => keyword.includes(concept) || concept.includes(keyword))
    .flatMap(([concept, aliases]) => [concept, ...aliases]);
  return [...new Set([...directTerms, ...relatedTerms])].some((term) => searchableText.includes(term.toLowerCase()));
}

function FilterGroup({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: readonly string[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="text-xs font-semibold text-slate-700">{title}</legend>
      <div className="space-y-2">
        {values.map((value) => {
          const id = `reg-filter-${title}-${value}`.replace(/\s+/g, "-");
          return (
            <div key={value} className="flex min-h-8 items-center gap-2.5">
              <Checkbox id={id} checked={selected.includes(value)} onCheckedChange={() => onToggle(value)} />
              <Label htmlFor={id} className="cursor-pointer text-xs font-medium text-slate-600">{value}</Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RAKnowledgePage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [regTypes, setRegTypes] = useState<RegType[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [searchMode, setSearchMode] = useState<SearchMode>("精确匹配");
  const [selectedId, setSelectedId] = useState(mockRegulations[0].id);
  const [expandedClauses, setExpandedClauses] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const normalizedKeyword = deferredKeyword.trim().toLowerCase();
    return mockRegulations.filter((regulation) => {
      if (frameworks.length && !frameworks.includes(regulation.framework)) return false;
      if (regTypes.length && !regTypes.includes(regulation.regType)) return false;
      if (categories.length && !regulation.category.some((category) => categories.includes(category))) return false;
      if (!normalizedKeyword) return true;
      return matchesRegulation(regulation, normalizedKeyword, searchMode);
    });
  }, [categories, deferredKeyword, frameworks, regTypes, searchMode]);

  const selected = filtered.find((regulation) => regulation.id === selectedId) ?? filtered[0] ?? null;
  const activeFilterCount = frameworks.length + regTypes.length + categories.length;
  const totalClauses = mockRegulations.reduce((sum, regulation) => sum + regulation.clauses.length, 0);

  const resetFilters = () => {
    setFrameworks([]);
    setRegTypes([]);
    setCategories([]);
    setKeyword("");
    setSelectedId(mockRegulations[0].id);
  };

  const removeFilter = (filter: string) => {
    setSelectedId("");
    if (ALL_FRAMEWORKS.includes(filter as Framework)) {
      setFrameworks((current) => current.filter((item) => item !== filter));
    } else if (ALL_REGTYPES.includes(filter as RegType)) {
      setRegTypes((current) => current.filter((item) => item !== filter));
    } else {
      setCategories((current) => current.filter((item) => item !== filter));
    }
  };

  return (
    <div className="horizon-theme hz-page mx-auto flex min-h-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={BookOpen}
        eyebrow="REGULATORY INTELLIGENCE · KNOWLEDGE"
        title="法规知识库"
        description="集中检索 FDA、CE MDR 与 NMPA 法规，快速定位条款、适用产品和版本状态。"
        meta={<><span>3 套法规体系</span><span>·</span><span>{totalClauses} 条重点条款</span><span>·</span><span>版本数据更新至 2024-02-02</span></>}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={routePath("page:quality-dms", "/quality-dms")}>质量文件 DMS<ArrowRight className="size-4" /></Link>
            </Button>
            <Button className="hz-primary-action" onClick={() => toast.success("法规同步检查已加入任务队列")}>同步检查</Button>
          </>
        }
      />

      <HorizonMetricGrid>
        <HorizonMetric Icon={Layers3} label="法规体系" value={mockRegulations.length} note="FDA / CE MDR / NMPA" />
        <HorizonMetric Icon={CircleCheck} label="有效文档" value={mockRegulations.filter((item) => item.status === "有效").length} note="当前可引用版本" tone="success" />
        <HorizonMetric Icon={FileCheck2} label="重点条款" value={totalClauses} note="已完成业务标签" />
        <HorizonMetric Icon={Search} label="当前结果" value={filtered.length} note={activeFilterCount ? `${activeFilterCount} 项筛选已启用` : "展示全部法规"} tone={filtered.length ? "brand" : "warning"} />
      </HorizonMetricGrid>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[190px_minmax(280px,310px)_minmax(0,1fr)]">
        <section className="hz-surface min-w-0 overflow-hidden border" aria-label="法规筛选范围">
          <HorizonSectionHeader
            Icon={Filter}
            title="筛选范围"
            description="按体系、类型和适用产品收窄结果。"
            trailing={activeFilterCount > 0 ? <Button variant="ghost" size="sm" onClick={resetFilters}>清空</Button> : undefined}
          />
          <div className="space-y-5 p-4">
            {activeFilterCount > 0 ? (
              <div className="flex flex-wrap gap-1.5" aria-label="已启用筛选">
                {[...frameworks, ...regTypes, ...categories].map((filter) => (
                  <span key={filter} className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-blue-700">
                    {filter}
                    <Button variant="unstyled" type="button" className="inline-flex size-6 items-center justify-center rounded-full hover:bg-accent" onClick={() => removeFilter(filter)} aria-label={`移除筛选 ${filter}`}>
                      <X className="size-3.5" />
                    </Button>
                  </span>
                ))}
              </div>
            ) : null}
            <FilterGroup title="法规体系" values={ALL_FRAMEWORKS} selected={frameworks} onToggle={(value) => { setSelectedId(""); setFrameworks((current) => current.includes(value as Framework) ? current.filter((item) => item !== value) : [...current, value as Framework]); }} />
            <FilterGroup title="法规类型" values={ALL_REGTYPES} selected={regTypes} onToggle={(value) => { setSelectedId(""); setRegTypes((current) => current.includes(value as RegType) ? current.filter((item) => item !== value) : [...current, value as RegType]); }} />
            <FilterGroup title="适用产品" values={ALL_CATEGORIES} selected={categories} onToggle={(value) => { setSelectedId(""); setCategories((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }} />
          </div>
        </section>

        <section className="hz-surface min-w-0 overflow-hidden border" aria-label="法规目录">
          <HorizonSectionHeader Icon={Library} title="法规目录" description="搜索法规名称、机构、条款和业务标签。" trailing={<span className="text-xs text-slate-500" aria-live="polite">{filtered.length} 份</span>} />
          <div className="hz-toolbar space-y-3 border-b p-3">
            <Label htmlFor="regulation-search" className="sr-only">搜索法规与条款</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="regulation-search" type="search" value={keyword} onChange={(event) => { setKeyword(event.target.value); setSelectedId(""); }} placeholder="搜索法规、条款或关键词" className="bg-white pl-9" />
            </div>
            <Tabs value={searchMode} onValueChange={(value) => { setSearchMode(value as SearchMode); setSelectedId(""); }}>
              <TabsList className="grid w-full grid-cols-2 bg-slate-100" aria-label="检索方式">
                <TabsTrigger value="精确匹配" className="data-[state=active]:text-primary">精确匹配</TabsTrigger>
                <TabsTrigger value="语义检索" className="data-[state=active]:text-primary">语义检索</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="text-pretty text-[11px] leading-4 text-slate-500">
              {searchMode === "精确匹配" ? "按输入词在法规、条款和标签中直接匹配。" : "扩展设计、质量、临床等常用中英文监管术语。"}
            </p>
          </div>
          <div className="max-h-[620px] overflow-y-auto">
            {filtered.length ? (
              <ul className="divide-y divide-slate-100" aria-label="法规文档列表">
                {filtered.map((regulation) => (
                  <li key={regulation.id}>
                    <Button variant="unstyled"
                      type="button"
                      aria-pressed={selected?.id === regulation.id}
                      onClick={() => setSelectedId(regulation.id)}
                      className={cn(
                        "w-full cursor-pointer px-4 py-3.5 text-left transition-colors hover:bg-slate-50",
                        selected?.id === regulation.id && "border-l-2 border-primary bg-accent/70 pl-[14px]",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", frameworkColors[regulation.framework])}>{regulation.framework}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700"><CircleCheck className="size-3" />{regulation.status}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-slate-800">{regulation.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{regulation.authority}</div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">{regulation.category.join(" · ")}</span>
                        <time className="shrink-0 tabular-nums" dateTime={regulation.date}>{regulation.date}</time>
                      </div>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <HorizonEmptyState Icon={Search} title="没有匹配的法规文档" description="调整关键词或清除筛选条件后重试。" action={<Button size="sm" variant="outline" onClick={resetFilters}>清除筛选</Button>} />
            )}
          </div>
        </section>

        <section className="hz-surface min-w-0 overflow-hidden border" aria-label="法规详情">
          {selected ? (
            <>
              <HorizonSectionHeader Icon={ShieldCheck} title="法规详情" description="查看版本身份、重点条款和历史状态。" trailing={<span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", frameworkColors[selected.framework])}>{selected.framework}</span>} />
              <div className="border-b border-slate-100 p-4 sm:p-5">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-primary">{selected.id}</span>
                      <span>·</span>
                      <span>{selected.regType}</span>
                      <span className="inline-flex items-center gap-1 text-emerald-700"><BadgeCheck className="size-3.5" />{selected.status}</span>
                    </div>
                    <h2 className="mt-2 text-balance text-lg font-bold leading-7 text-[#1b2559]">{selected.title}</h2>
                    <p className="mt-2 text-pretty text-sm text-slate-600">发布机构：{selected.authority}</p>
                  </div>
                  <dl className="grid w-full shrink-0 grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs 2xl:w-auto">
                    <div><dt className="text-slate-500">版本</dt><dd className="mt-1 font-semibold text-slate-800">{selected.version}</dd></div>
                    <div><dt className="text-slate-500">生效日期</dt><dd className="mt-1 font-semibold tabular-nums text-slate-800">{selected.date}</dd></div>
                    <div className="col-span-2"><dt className="text-slate-500">适用产品</dt><dd className="mt-1 font-semibold text-slate-800">{selected.category.join("、")}</dd></div>
                  </dl>
                </div>
              </div>

              <Tabs key={selected.id} defaultValue="clauses" className="gap-0">
                <div className="border-b border-slate-100 px-4 pt-3 sm:px-5">
                  <TabsList className="bg-slate-100" aria-label="法规详情视图">
                    <TabsTrigger value="clauses" className="data-[state=active]:text-primary">条款与标注</TabsTrigger>
                    <TabsTrigger value="history" className="data-[state=active]:text-primary">版本历史</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="clauses" className="m-0 p-4 sm:p-5">
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {selected.clauses.map((clause, index) => {
                      const expanded = expandedClauses[clause.id] ?? index === 0;
                      return (
                        <details
                          key={clause.id}
                          open={expanded}
                          onToggle={(event) => {
                            const isOpen = event.currentTarget.open;
                            setExpandedClauses((current) => ({ ...current, [clause.id]: isOpen }));
                          }}
                          className="group"
                        >
                          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden hover:bg-slate-50">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-primary">{clause.num}</span>
                              <span className="line-clamp-2 text-sm font-semibold text-slate-700">{clause.text}</span>
                            </div>
                            <span className="shrink-0 text-xs text-slate-500">{expanded ? "收起条款" : "展开条款"}</span>
                          </summary>
                          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                            <p className="text-pretty text-sm leading-6 text-slate-700">{clause.text}</p>
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap gap-1.5" aria-label="条款标签">
                                {clause.tags.map((tag) => (
                                  <span key={tag} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold", tagColors[tag] ?? "border-slate-200 bg-white text-slate-600")}><Tag className="size-3" />{tag}</span>
                                ))}
                              </div>
                              <Button size="sm" variant="outline" onClick={() => toast.success(`已为 ${clause.num} 添加标注`)}>添加标注</Button>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </TabsContent>
                <TabsContent value="history" className="m-0 p-4 sm:p-5">
                  <ol className="space-y-0" aria-label="法规版本历史">
                    {[
                      { version: selected.version, date: selected.date, note: "当前有效版本，可用于注册与质量文件引用。", active: true },
                      { version: "上一版本", date: "2019-03-01", note: "历史版本，仅用于变更追溯与差异核对。", active: false },
                    ].map((version, index) => (
                      <li key={`${selected.id}-${version.version}`} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                        <div className="relative flex justify-center">
                          <span className={cn("z-10 mt-0.5 inline-flex size-7 items-center justify-center rounded-full border", version.active ? "border-blue-200 bg-blue-50 text-primary" : "border-slate-200 bg-white text-slate-500")}><History className="size-3.5" /></span>
                          {index === 0 ? <span className="absolute bottom-0 top-7 w-px bg-slate-200" aria-hidden="true" /> : null}
                        </div>
                        <div className="min-w-0 rounded-xl border border-slate-200 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold text-slate-800">{version.version}</div>
                            <time className="text-xs tabular-nums text-slate-500" dateTime={version.date}>{version.date}</time>
                          </div>
                          <p className="mt-1 text-pretty text-xs leading-5 text-slate-600">{version.note}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <HorizonEmptyState Icon={BookOpen} title="请选择法规文档" description="从法规目录选择一份文档查看条款与版本历史。" action={<Button size="sm" variant="outline" onClick={resetFilters}>恢复全部法规</Button>} />
          )}
        </section>
      </div>
    </div>
  );
}
