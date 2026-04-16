import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Search, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown,
  Factory, Download, Printer, AlertOctagon, ChevronRight,
  ChevronDown
} from 'lucide-react';
import { cn } from './components/ui/utils';
import { toast } from 'sonner';
import { Link } from 'react-router';

const searchModes = ['批号查询', '序列号(SN)', '订单号'];

const rawMaterials = [
  { name: '压缩机 (大韦德)', batch: 'DW-20240310', iqc: '合格', iqcNo: 'IQC-240310', status: 'ok' },
  { name: '分子筛 (国瑞材料)', batch: 'GR-20240308', iqc: '合格', iqcNo: 'IQC-240308', status: 'ok' },
  { name: '主板 PCB (振华)', batch: 'ZH-20240312', iqc: '让步接收', iqcNo: 'IQC-240312', status: 'warning' },
];

const processSteps = [
  { step: '组装', time: '04-15 09:00', operator: '王师傅', result: '合格', done: true },
  { step: '调试', time: '04-15 14:00', operator: '李工', result: '合格', done: true },
  { step: 'FQC检验', time: '04-16', operator: 'QA: 陈检', result: '合格', done: true },
  { step: '包装', time: '04-17', operator: '包装组', result: '合格', done: true },
  { step: '放行', time: '04-17', operator: 'QA主管审批', result: '已放行', done: true },
];

const shipments = [
  { sn: 'OC5-2024-001', customer: 'Medline Mexico', date: '04-20出库', status: 'shipped' },
  { sn: 'OC5-2024-002', customer: 'Medline Mexico', date: '04-20出库', status: 'shipped' },
  { sn: 'OC5-2024-003', customer: 'Medline Mexico', date: '04-20出库', status: 'shipped' },
  { sn: 'OC5-2024-019', customer: '库存', date: '', status: 'stock' },
  { sn: 'OC5-2024-020', customer: '售后工单CS-892', date: '', status: 'afterSales' },
];

export function QATraceability() {
  const [searchMode, setSearchMode] = useState('批号查询');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(true);
  const [expandedMaterial, setExpandedMaterial] = useState<string | null>(null);

  const handleSearch = () => {
    if (!query.trim()) { toast.error('请输入查询内容'); return; }
    setSearched(true);
    toast.success(`正在追溯批号: ${query}`);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">全链路追溯查询</h1>
        <p className="text-sm text-gray-400 mt-0.5">原材料 → 生产过程 → 销售去向，全程透明可追</p>
      </div>

      {/* Search Area */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <div className="flex items-center justify-center gap-2">
            {searchModes.map(m => (
              <button
                key={m}
                onClick={() => setSearchMode(m)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-xs font-bold transition-all border',
                  searchMode === m ? 'bg-[#1976D2] text-white border-[#1976D2] shadow-sm' : 'border-gray-100 text-gray-500 hover:border-gray-200'
                )}
              >{m}</button>
            ))}
          </div>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="输入批号，如: 20240315-OC5-001"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-sm font-medium outline-none focus:bg-white focus:border-blue-200 transition-all"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-6 py-3 bg-[#1976D2] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/10 hover:shadow-xl transition-all"
            >
              查询
            </button>
          </div>
          {searched && (
            <p className="text-xs text-gray-500 font-medium">
              当前查询：<span className="font-bold text-gray-700">批号 20240315-OC5-001</span>
            </p>
          )}
        </div>
      </div>

      {/* Three Panel Traceability */}
      {searched && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-12 gap-5">
          {/* Panel 1 - Raw Materials */}
          <div className="col-span-12 md:col-span-4">
            <div className="bg-green-50/40 rounded-2xl p-5 border border-green-100 h-full space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center">
                  <ArrowUp className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">向上追溯 — 原材料</h3>
                  <p className="text-[10px] text-gray-400">↑ 原材料来源</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {rawMaterials.map((mat) => (
                  <div key={mat.name}>
                    <button
                      onClick={() => setExpandedMaterial(expandedMaterial === mat.name ? null : mat.name)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-white border transition-all hover:border-green-200',
                        mat.status === 'warning' ? 'border-orange-100' : 'border-transparent'
                      )}
                    >
                      <div className={cn('w-2 h-2 rounded-full shrink-0', mat.status === 'ok' ? 'bg-green-400' : 'bg-orange-400')}></div>
                      <p className="text-xs font-bold text-gray-700 flex-1 text-left">{mat.name}</p>
                      {expandedMaterial === mat.name ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    {expandedMaterial === mat.name && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                        className="mx-1 mb-1 bg-white border border-t-0 border-gray-100 rounded-b-xl px-4 py-3 space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-[10px] font-bold text-gray-400">批次</span>
                          <span className="text-[10px] font-mono font-bold text-gray-700">{mat.batch}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-gray-400">来料检验</span>
                          <span className={cn(
                            'text-[10px] font-bold px-2 py-0.5 rounded-full',
                            mat.status === 'ok' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                          )}>
                            {mat.iqc === '合格' ? '✓ 合格' : '⚠ ' + mat.iqc}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] font-bold text-gray-400">检验单号</span>
                          <span className="text-[10px] font-mono text-gray-500">{mat.iqcNo}</span>
                        </div>
                      </motion.div>
                    )}
                  </div>
                ))}
              </div>

              <button className="text-[11px] font-bold text-green-600 hover:underline flex items-center gap-1.5">
                查看来料检验报告
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Panel 2 - Production Process */}
          <div className="col-span-12 md:col-span-4">
            <div className="bg-white rounded-2xl p-5 border-2 border-[#1976D2] h-full space-y-4 shadow-lg shadow-blue-900/5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Factory className="w-4 h-4 text-[#1976D2]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">🏭 生产批次信息</h3>
                </div>
              </div>

              <div className="px-3 py-3 bg-blue-50/30 rounded-xl border border-blue-100 space-y-2">
                <p className="font-mono text-lg font-bold text-[#1976D2]">20240315-OC5-001</p>
                <p className="text-xs font-bold text-gray-500">产品型号: OC-5</p>
                <div className="flex gap-4 mt-1">
                  <div><p className="text-[10px] text-gray-400 font-bold">生产数量</p><p className="text-sm font-bold text-gray-800">20台</p></div>
                  <div><p className="text-[10px] text-gray-400 font-bold">合格</p><p className="text-sm font-bold text-green-600">19台</p></div>
                  <div><p className="text-[10px] text-gray-400 font-bold">不合格</p><p className="text-sm font-bold text-red-500">1台</p></div>
                </div>
              </div>

              <div className="space-y-4 relative">
                <div className="absolute left-3.5 top-2 bottom-2 w-px bg-gray-100"></div>
                {processSteps.map((s, idx) => (
                  <div key={idx} className="flex gap-4 relative">
                    <div className={cn('w-7 h-7 rounded-full flex items-center justify-center border-2 shrink-0 z-10 bg-white', s.done ? 'border-[#1976D2] bg-[#1976D2]' : 'border-gray-100')}>
                      {s.done && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="pb-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-gray-800">{s.step}</p>
                        <span className="text-[9px] font-mono text-gray-400">{s.time}</span>
                      </div>
                      <p className="text-[10px] text-gray-500 font-medium">{s.operator}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Panel 3 - Sales / After Sales */}
          <div className="col-span-12 md:col-span-4">
            <div className="bg-blue-50/20 rounded-2xl p-5 border border-blue-100 h-full space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white rounded-lg shadow-sm flex items-center justify-center">
                  <ArrowDown className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">向下追溯 — 销售去向</h3>
                  <p className="text-[10px] text-gray-400">↓ 销售去向</p>
                </div>
              </div>

              <div className="space-y-2">
                {shipments.map((s) => (
                  <div key={s.sn} className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border',
                    s.status === 'afterSales' ? 'border-red-100 bg-red-50/30' :
                    s.status === 'stock' ? 'border-green-100' : 'border-gray-50'
                  )}>
                    <span className="text-[10px] font-mono font-bold text-gray-600 w-28 shrink-0">{s.sn}</span>
                    <span className="text-[10px] font-medium flex-1 truncate text-gray-500">→ {s.customer}</span>
                    {s.status === 'shipped' && (
                      <span className="text-[9px] font-medium text-gray-400 shrink-0">{s.date}</span>
                    )}
                    {s.status === 'stock' && (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[9px] font-bold rounded-full">库存</span>
                    )}
                    {s.status === 'afterSales' && (
                      <Link to="/after-sales/CS-2024-0892" className="px-2 py-0.5 bg-red-100 text-red-600 text-[9px] font-bold rounded-full hover:bg-red-200 transition-colors">
                        🔴 售后
                      </Link>
                    )}
                  </div>
                ))}
                <div className="px-3 py-2 text-[10px] text-gray-400 font-medium">... 18台已出库</div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Action Bar */}
      {searched && (
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={() => toast.info('正在生成追溯报告 PDF...')}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all"
          >
            <Download className="w-4 h-4" />
            导出追溯报告 PDF
          </button>
          <button
            onClick={() => toast.warning('发起召回评估需要QA主管审批')}
            className="flex items-center gap-2 px-4 py-2.5 border border-red-200 text-red-500 rounded-xl text-xs font-bold hover:bg-red-50 transition-all"
          >
            <AlertOctagon className="w-4 h-4" />
            发起召回评估
          </button>
          <button
            onClick={() => toast.info('正在准备打印追溯链路...')}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all"
          >
            <Printer className="w-4 h-4" />
            打印追溯链路
          </button>
        </div>
      )}
    </div>
  );
}
