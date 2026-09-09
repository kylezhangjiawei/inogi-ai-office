import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const source = await readFile(new URL('src/app/RDTaskDetailPage.tsx', root), 'utf8');
const ast = ts.createSourceFile('detail.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['countRelationNodes', 'AttachSubtasksDialog', 'DetachSubtasksDialog'];
const functions = names.map(name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast)).join('\n');
const module = `import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CheckCircle2, ChevronRight, Undo2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '/src/app/components/ui/dialog';
import { Input } from '/src/app/components/ui/input';
import { cn } from '/src/app/components/ui/utils';
import '/src/styles/index.css';
const t = (text, params = {}) => text.replace(/\\{(\\w+)\\}/g, (m, key) => params[key] ?? m);
const useI18n = () => {};
const toast = { error() {} };
const STATUS_CONFIG = { in_progress: { dot: 'bg-blue-500' } };
const displayPersonName = value => value;
const AutoTranslatedText = ({ text }) => <>{text}</>;
${functions}
function Harness() {
  const [result, setResult] = useState('');
  const query = new URLSearchParams(location.search);
  const Component = query.get('kind') === 'detach' ? DetachSubtasksDialog : AttachSubtasksDialog;
  const candidates = Array.from({ length: query.get('count') === '0' ? 0 : 80 }, (_, i) => ({ task_id: 'RD-2026-' + String(i + 1).padStart(6, '0') + '-J8Y', title: '验证任务 ' + (i + 1) + '：Q7 各档位浓度及流量复测和文档输出', primary_owner: '测试工程师', status: 'in_progress', subtasks: i % 3 === 0 ? [{ task_id: 'child-' + i, title: '保留的下级', subtasks: [] }] : [] }));
  return result ? <p role="status">{result}</p> : <Component parentTask={{ task_id: 'PARENT', title: 'Q7 各档位数据复测及 ECN 文档归档' }} candidates={candidates} onCancel={() => setResult('取消成功')} onConfirm={async ids => { setResult('确认成功：' + ids.join(', ')); }} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
setInterval(() => {
 const dialog = document.querySelector('[role="dialog"]');
 if (!dialog) return;
 const list = dialog.querySelector('[role="group"]');
 const sections = [...dialog.children].filter(el => el.tagName !== 'BUTTON');
 const rect = el => {const r=el.getBoundingClientRect();return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), scrollWidth:el.scrollWidth, clientWidth:el.clientWidth}};
 parent.postMessage({kind:'layout', viewport:[innerWidth,innerHeight], direction:getComputedStyle(dialog).flexDirection, dialog:rect(dialog), sections:sections.map(rect), listScrollable:list.scrollHeight>list.clientHeight, listScrollTop:list.scrollTop}, location.origin);
}, 500);
`;
await writeFile(new URL('fixture.tsx', import.meta.url), module);
await writeFile(new URL('frame.html', import.meta.url), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
await writeFile(new URL('index.html', import.meta.url), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>任务关系弹窗局部验证</title><style>body{margin:12px;font:14px system-ui}nav{display:flex;gap:14px;padding-bottom:8px}iframe{border:1px solid #888;display:block}pre{white-space:pre-wrap;margin:8px 0}</style></head><body><nav><a href="?size=desktop">桌面并入</a><a href="?size=mobile">窄屏并入</a><a href="?size=small">小屏并入</a><a href="?size=mobile&kind=detach">窄屏批量取消</a><a href="?size=desktop&kind=detach">桌面批量取消</a><a href="?size=mobile&count=0">空候选列表</a></nav><iframe title="真实任务关系弹窗" id="frame"></iframe><pre id="metrics" aria-live="polite"></pre><script>const p=new URLSearchParams(location.search); const dimensions=p.get('size')==='mobile'?[390,844]:p.get('size')==='small'?[320,568]:[1200,800]; const frame=document.getElementById('frame'); [frame.width,frame.height]=dimensions;frame.src='./frame.html?'+p; addEventListener('message',event=>{if(event.origin===location.origin&&event.data.kind==='layout')document.getElementById('metrics').textContent=JSON.stringify(event.data)});</script></body></html>`);
console.log('Prepared real relation dialogs with existing Radix components and application styles.');
