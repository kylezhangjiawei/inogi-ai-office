import { Search, Bell, User } from 'lucide-react';
import { motion } from 'motion/react';

export function Header() {
  const currentDate = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });

  return (
    <div className="h-16 bg-white flex items-center justify-between px-8 relative overflow-hidden" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
      {/* 顶部装饰渐变 */}
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #64B5F6 0%, #2196F3 50%, #1976D2 100%)' }}></div>

      <div className="flex items-center gap-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">数据看板</h1>
        <span className="text-sm text-muted-foreground px-3 py-1.5 bg-gray-100 rounded-full">
          {currentDate} {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索工单、文档..."
            className="w-80 h-10 pl-11 pr-4 rounded-full text-sm focus:outline-none transition-all bg-gray-100 hover:bg-gray-200 focus:bg-white focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#D32F2F] rounded-full"></span>
        </motion.button>

        <div className="flex items-center gap-3 pl-4 border-l" style={{ borderColor: '#E0E0E0' }}>
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)' }}
          >
            <User className="w-5 h-5 text-white" />
          </motion.div>
          <div className="hidden lg:block">
            <div className="text-sm font-medium">林云飞</div>
            <div className="text-xs text-muted-foreground">管理员</div>
          </div>
        </div>
      </div>
    </div>
  );
}
