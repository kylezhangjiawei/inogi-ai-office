import { Plus, Upload, FileText, Search, Users, Receipt } from 'lucide-react';
import { motion } from 'motion/react';

const actions = [
  { id: '1', label: '新建售后工单', icon: Plus, action: 'new-ticket', gradient: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)' },
  { id: '2', label: '上传报关单', icon: Upload, action: null, gradient: 'linear-gradient(135deg, #90CAF9 0%, #64B5F6 100%)' },
  { id: '3', label: '生成会议纪要', icon: FileText, action: null, gradient: 'linear-gradient(135deg, #4DD0E1 0%, #00BCD4 100%)' },
  { id: '4', label: '查询注册进度', icon: Search, action: null, gradient: 'linear-gradient(135deg, #26C6DA 0%, #00ACC1 100%)' },
  { id: '5', label: '简历筛选', icon: Users, action: null, gradient: 'linear-gradient(135deg, #9FA8DA 0%, #5C6BC0 100%)' },
  { id: '6', label: '费用报销', icon: Receipt, action: null, gradient: 'linear-gradient(135deg, #42A5F5 0%, #1E88E5 100%)' },
];

interface QuickActionsProps {
  onNewTicket: () => void;
}

export function QuickActions({ onNewTicket }: QuickActionsProps) {
  const handleAction = (actionId: string | null) => {
    if (actionId === 'new-ticket') {
      onNewTicket();
    }
  };

  return (
    <div className="rounded-2xl p-6 bg-white relative overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
      <div className="absolute top-0 left-0 w-full h-1" style={{ background: 'linear-gradient(90deg, #64B5F6 0%, #2196F3 50%, #1976D2 100%)' }}></div>

      <h3 className="font-semibold text-xl mb-6">快捷操作</h3>
      <div className="grid grid-cols-2 gap-4">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              whileHover={{ y: -4, scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleAction(action.action)}
              className="relative flex flex-col items-center gap-3 p-5 rounded-xl transition-all text-center overflow-hidden group"
            >
              {/* 渐变背景 */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: action.gradient }}></div>

              {/* 默认背景 */}
<div className="absolute inset-0 opacity-100 group-hover:opacity-0 transition-opacity" style={{ background: 'linear-gradient(135deg, #E3F2FD 0%, #E1F5FE 100%)' }}></div>

              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 relative z-10 group-hover:scale-110 transition-transform shadow-lg"
                style={{ background: action.gradient }}
              >
                <Icon className="w-7 h-7 text-white" />
              </div>
              <span className="text-sm font-medium relative z-10 group-hover:text-white transition-colors">{action.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
