import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Edit3,
  ChevronDown, ChevronUp, Download, FileSpreadsheet, FilePlus2,
  Sparkles, Loader2
} from 'lucide-react';
import { cn } from './components/ui/utils';
import { toast } from 'sonner';

const extractedFields = [
  { key: '收货人', value: 'Medline International Inc.', status: 'ok' },
  { key: '收货地址', value: '1 Medline Place, Mundelein, IL 60060, USA', status: 'ok' },
  { key: '产品型号', value: 'OC-5 × 20台, OC-10 × 10台', status: 'ok' },
  { key: '数量', value: '30台', status: 'ok' },
  { key: '箱数', value: '15箱', status: 'ok' },
  { key: '毛重', value: '450 kg', status: 'ok' },
  { key: '净重', value: '380 kg', status: 'ok' },
  { key: '贸易条款', value: 'FOB Shanghai', status: 'ok' },
  { key: '发票金额', value: 'USD 45,000.00', status: 'ok' },
  { key: 'HS编码', value: '', status: 'missing' },
];

const checkItems = [
  { label: '收货人信息一致', status: 'ok', detail: 'PI 与 PL 收货人完全一致' },
  { label: '产品型号一致', status: 'ok', detail: 'OC-5 × 20台 & OC-10 × 10台' },
  { label: '数量一致: 30台', status: 'ok', detail: 'PI、PL、订单三方数量吻合' },
  { label: '箱数一致: 15箱', status: 'ok', detail: '装箱明细与订单一致' },
  { label: '金额存在差异', status: 'warning', detail: 'PI 显示 $45,000 / PL 显示 $44,850，差额 $150，可能为运费调整所致，建议与财务核实' },
  { label: '重量一致', status: 'ok', detail: '毛重 450kg，净重 380kg，与包装记录一致' },
  { label: '贸易条款一致', status: 'ok', detail: 'FOB Shanghai，双方确认' },
];

export function CustomsDocs() {
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [editField, setEditField] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [expandedWarning, setExpandedWarning] = useState(false);
  const [hsCode, setHsCode] = useState('');

  const handleExtract = () => {
    setExtracting(true);
    setTimeout(() => {
      setExtracting(false);
      setExtracted(true);
      toast.success('AI 字段提取完成，共识别 12/13 个字段');
    }, 2200);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-800">报关单证自动处理</h1>
        <p className="text-sm text-gray-400 mt-0.5">AI 字段提取 · 一致性校验 · 自动生成报关文件</p>
      </div>

      <div className="grid grid-cols-12 gap-5 items-start">
        {/* Panel 1 - File Upload */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="col-span-12 md:col-span-3 space-y-5"
        >
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Upload className="w-4 h-4 text-[#1976D2]" />
              上传源文件
            </h3>

            <div className="border-2 border-dashed border-blue-100 rounded-xl p-6 text-center bg-blue-50/30 hover:bg-blue-50 transition-colors cursor-pointer group">
              <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                <Upload className="w-5 h-5 text-[#1976D2]" />
              </div>
              <p className="text-xs font-bold text-gray-600">上传 PI / 订单文件</p>
              <p className="text-[10px] text-gray-400 mt-1">支持 PDF、Excel、Word</p>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">已上传文件</p>
              {[
                { name: 'PI_Medline_2024Q2.pdf', type: 'PDF' },
                { name: 'PO_20240407.xlsx', type: 'XLS' },
              ].map((f) => (
                <div key={f.name} className="flex items-center gap-3 p-2.5 bg-green-50/50 border border-green-100 rounded-xl">
                  <div className="w-7 h-7 bg-white rounded-lg shadow-sm flex items-center justify-center">
                    {f.type === 'PDF' ? <FileText className="w-3.5 h-3.5 text-red-500" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-gray-700 truncate">{f.name}</p>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                </div>
              ))}
            </div>

            <button
              onClick={handleExtract}
              disabled={extracting}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-[#1976D2] text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/10 hover:shadow-xl transition-all disabled:opacity-60"
            >
              {extracting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />正在提取...</>
              ) : (
                <>开始提取字段 →</>
              )}
            </button>
          </div>
        </motion.div>

        {/* Panel 2 - Extracted Fields */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="col-span-12 md:col-span-5 space-y-5"
        >
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#1976D2]" />
                AI 字段提取结果
              </h3>
              {extracted && (
                <span className="px-2.5 py-1 bg-blue-50 text-[#1976D2] rounded-full text-[10px] font-bold border border-blue-100">
                  已提取 12/13 个字段
                </span>
              )}
            </div>

            <AnimatePresence>
              {!extracted && !extracting && (
                <div className="py-10 text-center text-gray-300">
                  <FilePlus2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-xs font-medium">上传文件后点击提取按钮</p>
                </div>
              )}
              {extracting && (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 mx-auto mb-3 relative">
                    <div className="w-12 h-12 border-4 border-blue-100 rounded-full"></div>
                    <div className="w-12 h-12 border-4 border-[#1976D2] border-t-transparent rounded-full animate-spin absolute top-0"></div>
                  </div>
                  <p className="text-xs font-bold text-gray-600">AI 正在识别字段...</p>
                </div>
              )}
            </AnimatePresence>

            {extracted && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                {extractedFields.map((field) => (
                  <div key={field.key} className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all',
                    field.status === 'missing' ? 'bg-orange-50/50 border-orange-100' : 'bg-gray-50/40 border-transparent hover:border-gray-100 hover:bg-white'
                  )}>
                    <span className="text-[11px] font-bold text-gray-400 w-20 shrink-0">{field.key}</span>
                    {field.status === 'missing' ? (
                      <input
                        type="text"
                        placeholder="请手动输入"
                        value={hsCode}
                        onChange={e => setHsCode(e.target.value)}
                        className="flex-1 text-xs font-medium bg-white border border-orange-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-orange-400 transition-colors"
                      />
                    ) : editField === field.key ? (
                      <input
                        type="text"
                        defaultValue={fieldValues[field.key] ?? field.value}
                        onBlur={e => { setFieldValues(p => ({ ...p, [field.key]: e.target.value })); setEditField(null); }}
                        autoFocus
                        className="flex-1 text-xs font-medium bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 outline-none"
                      />
                    ) : (
                      <span className="flex-1 text-xs font-medium text-gray-700 truncate">{fieldValues[field.key] ?? field.value}</span>
                    )}
                    {field.status === 'missing' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    ) : (
                      <button onClick={() => setEditField(field.key)} className="p-1 hover:bg-gray-100 rounded-lg transition-colors shrink-0">
                        <Edit3 className="w-3 h-3 text-gray-400" />
                      </button>
                    )}
                  </div>
                ))}

                <div className="pt-3">
                  <button
                    onClick={() => toast.success('正在生成 CI/PL 单证模板...')}
                    className="w-full py-2.5 bg-[#1976D2] text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/10 hover:shadow-xl transition-all"
                  >
                    确认字段，生成单证 →
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </motion.div>

        {/* Panel 3 - Validation Report */}
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          className="col-span-12 md:col-span-4 space-y-5"
        >
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <h3 className="text-sm font-bold text-gray-800 mb-4">一致性校验报告</h3>

            <div className="flex flex-col items-center py-4 mb-4">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-2">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <p className="text-lg font-bold text-green-600">校验通过 9/10</p>
              <p className="text-[11px] text-gray-400 font-medium">发现 1 处需关注的差异</p>
            </div>

            <div className="space-y-2">
              {checkItems.map((item, idx) => (
                <div key={idx}>
                  <button
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all',
                      item.status === 'warning' ? 'bg-orange-50 border border-orange-100' : 'bg-gray-50/40 hover:bg-gray-50'
                    )}
                    onClick={() => item.status === 'warning' && setExpandedWarning(!expandedWarning)}
                  >
                    {item.status === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
                    )}
                    <span className={cn(
                      'flex-1 text-[11px] font-bold',
                      item.status === 'warning' ? 'text-orange-700' : 'text-gray-600'
                    )}>{item.label}</span>
                    {item.status === 'warning' && (
                      expandedWarning ? <ChevronUp className="w-3.5 h-3.5 text-orange-400" /> : <ChevronDown className="w-3.5 h-3.5 text-orange-400" />
                    )}
                  </button>
                  <AnimatePresence>
                    {item.status === 'warning' && expandedWarning && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mx-2 mb-1 px-3 py-2.5 bg-orange-50/60 border border-orange-100 rounded-b-xl border-t-0">
                          <p className="text-[11px] text-orange-600 font-medium leading-relaxed">{item.detail}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2.5">
              <button
                onClick={() => toast.info('正在生成校验报告 PDF...')}
                className="w-full py-2 border border-gray-200 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                导出校验报告 PDF
              </button>
              <button
                onClick={() => toast.success('CI/PL 模板生成中...')}
                className="w-full py-2.5 bg-[#1976D2] text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-900/10 hover:shadow-xl transition-all"
              >
                生成 CI/PL 模板
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
