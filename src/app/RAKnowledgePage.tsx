import React, { useState, useMemo } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Filter,
  History,
  Search,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

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
  FDA: "bg-blue-100 text-blue-700",
  "CE MDR": "bg-emerald-100 text-emerald-700",
  NMPA: "bg-red-100 text-red-700",
};

const tagColors: Record<string, string> = {
  报警: "bg-orange-50 text-orange-600",
  电源: "bg-yellow-50 text-yellow-700",
  软件: "bg-violet-50 text-violet-700",
  硬件: "bg-sky-50 text-sky-700",
  临床: "bg-pink-50 text-pink-700",
  质量: "bg-teal-50 text-teal-700",
  生产: "bg-amber-50 text-amber-700",
};

const ALL_FRAMEWORKS: Framework[] = ["FDA", "CE MDR", "NMPA"];
const ALL_REGTYPES: RegType[] = ["强制标准", "指导原则", "技术规范"];
const ALL_CATEGORIES = ["CPAP", "BiPAP", "呼吸机", "制氧机"];

export function RAKnowledgePage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [regTypes, setRegTypes] = useState<RegType[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("精确匹配");
  const [selectedId, setSelectedId] = useState<string>(mockRegulations[0].id);
  const [expandedClauses, setExpandedClauses] = useState<Record<string, boolean>>({});
  const [versionTab, setVersionTab] = useState<"clauses" | "history">("clauses");

  const filtered = useMemo(() => {
    return mockRegulations.filter((r) => {
      if (frameworks.length && !frameworks.includes(r.framework)) return false;
      if (regTypes.length && !regTypes.includes(r.regType)) return false;
      if (categories.length && !r.category.some((c) => categories.includes(c))) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        return [r.title, r.authority, r.id, ...r.category].join(" ").toLowerCase().includes(kw);
      }
      return true;
    });
  }, [frameworks, regTypes, categories, keyword]);

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  const activeFilterCount = frameworks.length + regTypes.length + categories.length;

  const toggleFramework = (f: Framework) =>
    setFrameworks((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  const toggleRegType = (t: RegType) =>
    setRegTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const toggleCategory = (c: string) =>
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const resetFilters = () => { setFrameworks([]); setRegTypes([]); setCategories([]); };

  return (
    <div className="flex h-full gap-0 bg-gray-50 min-h-0 overflow-hidden">
      {/* Left: Filter Sidebar */}
      <div className="w-52 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-y-auto">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">筛选</span>
            {activeFilterCount > 0 && (
              <span className="text-xs bg-purple-100 text-purple-700 rounded-full px-1.5 font-medium">{activeFilterCount}</span>
            )}
          </div>
          {activeFilterCount > 0 && (
            <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
              <X className="w-3 h-3" /> 清空
            </button>
          )}
        </div>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="px-3 py-2 flex flex-wrap gap-1 border-b border-gray-50">
            {[...frameworks, ...regTypes, ...categories].map((f) => (
              <span key={f} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                {f}
                <button onClick={() => {
                  if (ALL_FRAMEWORKS.includes(f as Framework)) toggleFramework(f as Framework);
                  else if (ALL_REGTYPES.includes(f as RegType)) toggleRegType(f as RegType);
                  else toggleCategory(f);
                }}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex-1 px-3 py-3 space-y-4">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">法规体系</div>
            {ALL_FRAMEWORKS.map((f) => (
              <label key={f} className="flex items-center gap-2 py-1 cursor-pointer group">
                <input type="checkbox" checked={frameworks.includes(f)} onChange={() => toggleFramework(f)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-400" />
                <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", frameworkColors[f])}>{f}</span>
              </label>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">法规类型</div>
            {ALL_REGTYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox" checked={regTypes.includes(t)} onChange={() => toggleRegType(t)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-400" />
                <span className="text-xs text-gray-600">{t}</span>
              </label>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">产品类别</div>
            {ALL_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-2 py-1 cursor-pointer">
                <input type="checkbox" checked={categories.includes(c)} onChange={() => toggleCategory(c)}
                  className="rounded border-gray-300 text-purple-600 focus:ring-purple-400" />
                <span className="text-xs text-gray-600">{c}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Center: Search + Document List */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-400"
              placeholder="搜索条款、关键词..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(["精确匹配", "语义检索"] as SearchMode[]).map((m) => (
              <button key={m} onClick={() => setSearchMode(m)}
                className={cn("flex-1 text-xs py-1 rounded-lg font-medium transition-colors",
                  searchMode === m ? "bg-purple-100 text-purple-700" : "text-gray-500 hover:bg-gray-50"
                )}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">无匹配法规文档</div>
          ) : filtered.map((reg) => (
            <button key={reg.id} onClick={() => setSelectedId(reg.id)}
              className={cn("w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors",
                selected?.id === reg.id && "bg-purple-50"
              )}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0", frameworkColors[reg.framework])}>{reg.framework}</span>
                <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium",
                  reg.status === "有效" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400 line-through"
                )}>{reg.status}</span>
              </div>
              <div className="text-sm font-medium text-gray-800 leading-snug mb-1">{reg.title}</div>
              <div className="text-xs text-gray-400">{reg.authority} · {reg.date}</div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {reg.category.slice(0, 3).map((c) => (
                  <span key={c} className="text-xs bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">{c}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Document Detail */}
      <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
        {selected ? (
          <>
            <div className="px-6 pt-5 pb-4 border-b border-gray-100">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", frameworkColors[selected.framework])}>{selected.framework}</span>
                  <span className="text-xs text-gray-400">{selected.regType}</span>
                  <span className={cn("text-xs px-1.5 py-0.5 rounded-full",
                    selected.status === "有效" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  )}>{selected.status}</span>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{selected.version} · {selected.date}</span>
              </div>
              <h2 className="font-semibold text-gray-800 text-base leading-snug">{selected.title}</h2>
              <div className="flex items-center gap-2 mt-2">
                <BookOpen className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs text-gray-500">{selected.authority}</span>
                <span className="text-gray-200">·</span>
                <div className="flex gap-1">
                  {selected.category.map((c) => (
                    <span key={c} className="text-xs bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">{c}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 px-6 pt-3 border-b border-gray-100">
              {(["clauses", "history"] as const).map((tab) => (
                <button key={tab} onClick={() => setVersionTab(tab)}
                  className={cn("text-sm pb-2.5 font-medium border-b-2 transition-colors",
                    versionTab === tab ? "border-purple-500 text-purple-700" : "border-transparent text-gray-400 hover:text-gray-600"
                  )}>
                  {tab === "clauses" ? "条款与标注" : "版本历史"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {versionTab === "clauses" ? (
                <div className="space-y-3">
                  {selected.clauses.map((clause) => (
                    <div key={clause.id} className="border border-gray-100 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedClauses((prev) => ({ ...prev, [clause.id]: !prev[clause.id] }))}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{clause.num}</span>
                          <span className="text-sm text-gray-700 font-medium truncate">{clause.text.slice(0, 40)}...</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {clause.tags.map((t) => (
                            <span key={t} className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", tagColors[t] ?? "bg-gray-50 text-gray-500")}>{t}</span>
                          ))}
                          {expandedClauses[clause.id] ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </div>
                      </button>
                      {expandedClauses[clause.id] && (
                        <div className="px-4 pb-4 border-t border-gray-50">
                          <p className="text-sm text-gray-700 leading-relaxed mt-3">{clause.text}</p>
                          <div className="flex items-center justify-between mt-3">
                            <div className="flex gap-1.5 flex-wrap">
                              {clause.tags.map((t) => (
                                <span key={t} className={cn("text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1", tagColors[t] ?? "bg-gray-50 text-gray-500")}>
                                  <Tag className="w-3 h-3" />{t}
                                </span>
                              ))}
                            </div>
                            <button
                              onClick={() => toast.success(`已为 ${clause.num} 添加标注`)}
                              className="text-xs text-purple-600 hover:text-purple-700 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 transition-colors"
                            >
                              + 添加标注
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {[
                    { version: selected.version, date: selected.date, note: "当前有效版本", active: true },
                    { version: "上一版本", date: "2019-03-01", note: "已废止", active: false },
                  ].map((v, i) => (
                    <div key={i} className={cn("border rounded-xl p-4", v.active ? "border-purple-100 bg-purple-50/30" : "border-gray-100")}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <History className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-800">{v.version}</span>
                          {v.active ? (
                            <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full">当前版本</span>
                          ) : (
                            <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full line-through">已废止</span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">{v.date}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">{v.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-300">
            <div className="text-center">
              <BookOpen className="w-12 h-12 mx-auto opacity-20 mb-3" />
              <p className="text-sm">从左侧选择法规文档查看详情</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
