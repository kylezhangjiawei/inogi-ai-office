import { ArrowLeft, Upload, Sparkles } from 'lucide-react';
import { useState } from 'react';

interface NewTicketFormProps {
  onBack: () => void;
}

export function NewTicketForm({ onBack }: NewTicketFormProps) {
  const [formData, setFormData] = useState({
    customerName: '',
    productModel: '',
    serialNumber: '',
    reportDate: '',
    problemTypes: [] as string[],
    workMode: '',
    description: '',
    selfChecked: '',
    environment: '',
  });

  const problemTypes = ['报警', '不出氧', '异常噪音', '开机故障', '其他'];

  const isFormComplete =
    formData.serialNumber &&
    formData.description &&
    formData.customerName &&
    formData.productModel &&
    formData.reportDate &&
    formData.problemTypes.length > 0 &&
    formData.workMode &&
    formData.selfChecked;

  const missingFields = [];
  if (!formData.serialNumber) missingFields.push('序列号');
  if (!formData.description) missingFields.push('问题现象描述');
  if (!formData.customerName) missingFields.push('客户名称');
  if (!formData.productModel) missingFields.push('产品型号');

  const toggleProblemType = (type: string) => {
    setFormData(prev => ({
      ...prev,
      problemTypes: prev.problemTypes.includes(type)
        ? prev.problemTypes.filter(t => t !== type)
        : [...prev.problemTypes, type]
    }));
  };

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-[800px] mx-auto py-8 px-6">
        <div className="mb-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>
          <h1 className="text-3xl font-bold mb-3">新建售后工单</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            请填写完整信息，系统将自动生成技术摘要
          </p>

          <div className="flex items-center gap-3 mt-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full text-white text-sm flex items-center justify-center font-medium shadow-md" style={{ background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)' }}>
                1
              </div>
              <span className="text-sm font-medium">填写信息</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-300"></div>
            <div className="flex items-center gap-2 opacity-50">
              <div className="w-8 h-8 rounded-full bg-gray-300 text-gray-600 text-sm flex items-center justify-center font-medium">2</div>
              <span className="text-sm text-muted-foreground">AI生成摘要</span>
            </div>
            <div className="w-16 h-0.5 bg-gray-300"></div>
            <div className="flex items-center gap-2 opacity-50">
              <div className="w-8 h-8 rounded-full bg-gray-300 text-gray-600 text-sm flex items-center justify-center font-medium">3</div>
              <span className="text-sm text-muted-foreground">提交</span>
            </div>
          </div>
        </div>

        <div className="rounded p-8 bg-card space-y-8" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <div>
            <div className="mb-5">
              <h2 className="font-semibold text-base">基础信息</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  客户名称 <span className="text-[#FF5252]">*</span>
                </label>
                <input
                  type="text"
                  value={formData.customerName}
                  onChange={(e) => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                  className="w-full h-11 px-4 rounded text-sm focus:outline-none border-b-2 border-gray-300 focus:border-[#2196F3] transition-colors bg-transparent hover:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  产品型号 <span className="text-[#FF5252]">*</span>
                </label>
                <select
                  value={formData.productModel}
                  onChange={(e) => setFormData(prev => ({ ...prev, productModel: e.target.value }))}
                  className="w-full h-11 px-4 rounded text-sm focus:outline-none border-b-2 border-gray-300 focus:border-[#2196F3] transition-colors bg-transparent hover:bg-gray-50"
                >
                  <option value="">请选择</option>
                  <option value="OC-3">OC-3</option>
                  <option value="OC-5">OC-5</option>
                  <option value="OC-10">OC-10</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  序列号(S/N) <span className="text-[#FF5252]">*</span>
                </label>
                <input
                  type="text"
                  value={formData.serialNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, serialNumber: e.target.value }))}
                  placeholder="格式：XXXXXXXX"
                  className="w-full h-11 px-4 rounded text-sm focus:outline-none border-b-2 border-gray-300 focus:border-[#2196F3] transition-colors bg-transparent hover:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  报障日期 <span className="text-[#FF5252]">*</span>
                </label>
                <input
                  type="date"
                  value={formData.reportDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, reportDate: e.target.value }))}
                  className="w-full h-11 px-4 rounded text-sm focus:outline-none border-b-2 border-gray-300 focus:border-[#2196F3] transition-colors bg-transparent hover:bg-gray-50"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-5">
              <h2 className="font-semibold text-base">问题描述</h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  问题类型 <span className="text-[#FF5252]">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {problemTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleProblemType(type)}
                      className={`px-4 py-2 rounded text-sm font-medium transition-all ${
                        formData.problemTypes.includes(type)
                          ? 'text-white'
                          : 'bg-white border border-gray-300 hover:bg-gray-50'
                      }`}
                      style={formData.problemTypes.includes(type) ? { background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)', boxShadow: '0 2px 4px rgba(33, 150, 243, 0.3)' } : {}}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  档位/工作模式 <span className="text-[#FF5252]">*</span>
                </label>
                <div className="flex gap-4">
                  {['1档', '2档', '3档', '持续流'].map((mode) => (
                    <label key={mode} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="workMode"
                        value={mode}
                        checked={formData.workMode === mode}
                        onChange={(e) => setFormData(prev => ({ ...prev, workMode: e.target.value }))}
                        className="w-5 h-5 text-[#1976D2] accent-[#2196F3]"
                      />
                      <span className="text-sm font-medium">{mode}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  问题现象描述 <span className="text-[#FF5252]">*</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="请详细描述问题现象"
                  rows={4}
                  className="w-full px-4 py-3 rounded border border-gray-300 text-sm resize-none focus:outline-none focus:border-[#2196F3] focus:ring-2 focus:ring-blue-200 transition-all bg-transparent hover:bg-gray-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  是否已自查 <span className="text-[#FF5252]">*</span>
                </label>
                <div className="flex gap-4">
                  {['是', '否'].map((option) => (
                    <label key={option} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="selfChecked"
                        value={option}
                        checked={formData.selfChecked === option}
                        onChange={(e) => setFormData(prev => ({ ...prev, selfChecked: e.target.value }))}
                        className="w-5 h-5 text-[#1976D2] accent-[#2196F3]"
                      />
                      <span className="text-sm font-medium">{option}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">使用环境</label>
                <input
                  type="text"
                  value={formData.environment}
                  onChange={(e) => setFormData(prev => ({ ...prev, environment: e.target.value }))}
                  placeholder="如：高原/沿海/室内"
                  className="w-full h-11 px-4 rounded text-sm focus:outline-none border-b-2 border-gray-300 focus:border-[#2196F3] transition-colors bg-transparent hover:bg-gray-50"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="mb-5">
              <h2 className="font-semibold text-base">附件上传</h2>
            </div>

            <div className="space-y-4">
              {[
                { id: 'sn', label: 'S/N照片', required: true, formats: 'JPG, PNG (最大5MB)' },
                { id: 'video', label: '报警/故障视频', required: false, formats: 'MP4, MOV (最大50MB)' },
                { id: 'other', label: '其他附件', required: false, formats: '支持常见文档格式' },
              ].map((upload) => (
                <div key={upload.id}>
                  <label className="block text-sm font-medium mb-2">
                    {upload.label} {upload.required && <span className="text-[#FF5252]">*</span>}
                  </label>
                  <div
                    className="border-2 border-dashed rounded p-8 text-center hover:border-[#64B5F6] hover:bg-blue-50 transition-all cursor-pointer bg-gray-50"
                    style={{ borderColor: '#BDBDBD' }}
                  >
                    <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <div className="text-sm font-medium mb-1">点击或拖拽上传</div>
                    <div className="text-xs text-muted-foreground">{upload.formats}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          className={`sticky bottom-6 mt-8 p-5 rounded ${
            isFormComplete ? 'bg-green-50' : 'bg-amber-50'
          }`}
          style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
        >
          {isFormComplete ? (
            <div className="flex items-center gap-3 text-sm font-medium" style={{ color: '#388E3C' }}>
              <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs" style={{ background: '#4CAF50' }}>✓</div>
              <span>信息完整，可提交</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm font-medium" style={{ color: '#E65100' }}>
              <div className="w-6 h-6 rounded-full text-white flex items-center justify-center text-xs" style={{ background: '#FB8C00' }}>!</div>
              <span>以下必填项未完成: {missingFields.join('、')}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-4 mt-8 pb-8">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="button"
            className="px-6 py-3 rounded border border-gray-300 bg-white hover:bg-gray-50 transition-colors font-medium"
          >
            保存草稿
          </motion.button>
          <motion.button
            whileHover={isFormComplete ? { scale: 1.02, boxShadow: '0 6px 16px rgba(33, 150, 243, 0.4)' } : {}}
            whileTap={isFormComplete ? { scale: 0.98 } : {}}
            type="button"
            disabled={!isFormComplete}
            className={`px-6 py-3 rounded font-medium transition-all flex items-center gap-2 ${
              isFormComplete
                ? 'text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
            style={isFormComplete ? { background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)', boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)' } : {}}
          >
            <span>下一步：生成AI摘要</span>
            <Sparkles className="w-5 h-5" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
