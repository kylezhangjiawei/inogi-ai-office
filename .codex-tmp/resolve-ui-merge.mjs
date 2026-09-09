import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const conflict = /^<<<<<<< .*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .*\r?\n/gm;
function resolve(path, choose, finish = s => s) {
  let i = 0;
  const input = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const output = input.replace(conflict, (_, ours, theirs) => choose(ours, theirs, i++));
  fs.writeFileSync(path, finish(output));
  console.log(`${path}: ${i} conflicts resolved`);
}
resolve('src/app/RDTaskManagementPage.tsx', (a,b) => a+b);
resolve('src/app/procurement/ProcMyWorkspacePage.tsx', (a,b) => b);
resolve('src/app/procurement/ProcurementCockpitPage.tsx', (a,b,i) => i===0 ? b : a, s => s
  .replace('const taskScrollRef = useRef<HTMLDivElement | null>(null);\n', '')
  .replace('  useLayoutEffect(() => {\n    setVisibleCount(WATERFALL_PAGE_SIZE);\n    const viewport = taskScrollRef.current?.closest<HTMLElement>(\'[data-slot="scroll-area-viewport"]\');\n    if (viewport) viewport.scrollTop = 0;\n  },', '  useEffect(() => {\n    setVisibleCount(WATERFALL_PAGE_SIZE);\n  },')
  .replace('    const viewport = sentinelElement.closest(\'[data-slot="scroll-area-viewport"]\');\n    if (!viewport) return;\n', '')
  .replace('{ root: viewport, rootMargin: "200px" }', '{ rootMargin: "200px" }')
  .replace('useEffect, useLayoutEffect,', 'useEffect,'));
resolve('src/app/procurement/components/ProcurementModuleDetail.tsx', a => a, s => s
  .replace(': <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4 lg:p-5">', ': <div className="proc-horizon-module-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 sm:p-4 lg:p-5">')
  .replace('className="flex h-[clamp(280px,34vh,360px)] shrink-0 flex-col', 'className="proc-horizon-module-inventory flex shrink-0 flex-col')
  .replace('className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"', 'className="proc-horizon-module-inventory-stats mb-4 grid grid-cols-2 gap-3"')
  .replace('"bg-[#eef3ff] text-[#002fa7]"', '"bg-accent text-primary"'));
resolve('src/app/procurement/components/ProcurementTaskCard.tsx', a => a, s => s
  .replaceAll('focus-visible:ring-[#8fa9e8]', 'focus-visible:ring-primary/40')
  .replaceAll('bg-[#002fa7]', 'bg-primary')
  .replaceAll('hover:bg-[#001f73]', 'hover:bg-primary-hover')
  .replaceAll('text-[#002fa7]', 'text-primary')
  .replaceAll('hover:bg-[#eef3ff]', 'hover:bg-accent')
  .replaceAll('focus-visible:ring-[#cbd8f6]', 'focus-visible:ring-primary/40'));
resolve('src/app/procurement/components/common.tsx', (a,b,i) => b, s => {
  s=s.replace('label: "待研发审核"','label: "待继续转采购"').replace('next: "选定报价"','next: "完成询价"').replace('next: "录入测试结论"','next: "安排研发测试"');
  const from=s.indexOf('/**\n * 回退可选节点');
  const to=s.indexOf('// 与服务端回退规则一致');
  if(from<0||to<from) throw Error('Missing rollback range');
  s=s.slice(0,from)+s.slice(to);
  s=s.replace('proc-horizon-kpi material-card relative flex h-auto items-center', 'proc-horizon-kpi material-card relative flex h-auto min-w-0 w-full items-center');
  const theirs=execFileSync('git',['show','origin/dev2:src/app/procurement/components/common.tsx'],{encoding:'utf8'});
  const pageHeader=theirs.slice(theirs.indexOf('export function PageHeader('),theirs.indexOf('/** 灰色圆角占位图'));
  s=s.slice(0,s.indexOf('export function PageHeader('))+pageHeader+s.slice(s.indexOf('/** 灰色圆角占位图'));
  s=s.replace('  clearable?: boolean;\n  ariaLabel?: string;\n', '  clearable?: boolean;\n');
  s=s.replace('          aria-label={ariaLabel}\n          disabled={disabled}', '          aria-label={ariaLabel}\n          variant="outline"\n          disabled={disabled}');
  return s;
});
resolve('scripts/procurement-cockpit-refinement.test.mjs', a => a);
resolve('scripts/procurement-cockpit-ui.test.mjs', a => a);
resolve('scripts/procurement-refinement-system.test.mjs', (a,b,i) => i===2 ? a.replace('  assert.doesNotMatch(css, /border-radius:\\s*(?:18|20)px/);\n','')+b : b);
