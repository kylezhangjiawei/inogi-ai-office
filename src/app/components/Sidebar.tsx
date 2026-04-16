import { Home, Ticket, FileText, FolderOpen, AlertCircle, Shield, Users, Settings, BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

const navItems: NavItem[] = [
  { id: 'home', label: '数据看板', icon: BarChart3 },
  { id: 'tickets', label: '售后工单', icon: Ticket, badge: 12 },
  { id: 'customs', label: '报关单证', icon: FileText, badge: 8 },
  { id: 'knowledge', label: '资料库', icon: FolderOpen },
  { id: 'rd', label: '研发问题', icon: AlertCircle },
  { id: 'qa', label: '质量管理', icon: Shield },
  { id: 'hr', label: '人事行政', icon: Users },
  { id: 'settings', label: '系统设置', icon: Settings },
];

export function Sidebar() {
  const [activeItem, setActiveItem] = useState('home');

  return (
    <div className="w-64 h-screen flex flex-col bg-white relative overflow-hidden" style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.08)' }}>
      {/* 装饰性渐变背景 */}
      <div className="absolute top-0 left-0 right-0 h-2" style={{ background: 'linear-gradient(90deg, #64B5F6 0%, #2196F3 50%, #1976D2 100%)' }}></div>

      <div className="h-20 flex items-center px-6 relative">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center relative" style={{ background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)' }}>
            <BarChart3 className="w-7 h-7 text-white" />
            <div className="absolute inset-0 rounded-2xl bg-white opacity-20"></div>
          </div>
          <div>
            <div className="font-bold text-lg leading-none">INOGI</div>
            <div className="text-xs text-muted-foreground mt-1.5">智能办公系统</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
        <AnimatePresence>
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeItem === item.id;

            return (
              <motion.button
                key={item.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                whileHover={{ scale: isActive ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveItem(item.id)}
                className={`
                  w-full flex items-center justify-between px-4 py-3 rounded transition-all duration-200 relative
                  ${isActive
                    ? 'bg-[#1976D2] text-white'
                    : 'text-foreground hover:bg-gray-100'
                  }
                `}
                style={isActive ? { boxShadow: '0 4px 8px rgba(25, 118, 210, 0.3)' } : {}}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 rounded bg-[#1976D2]"
                    transition={{ type: 'spring', bounce: 0.15, duration: 0.6 }}
                  />
                )}
                <div className="flex items-center gap-3 relative z-10">
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="text-sm font-medium">{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full relative z-10 ${
                    isActive ? 'bg-white/25 text-white' : 'bg-red-500 text-white'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </nav>

      <div className="p-5 m-4 rounded-2xl relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)', boxShadow: '0 8px 24px rgba(33, 150, 243, 0.3)' }}>
        <div className="absolute top-0 right-0 w-20 h-20 opacity-20" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}></div>

        <div className="flex items-center gap-3 mb-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <span className="text-sm font-bold text-white">本月数据</span>
        </div>
        <p className="text-sm text-white/90 relative z-10">
          完成工单 <span className="font-bold text-2xl text-white">156</span> 个
        </p>
        <div className="mt-3 h-2 bg-white/20 rounded-full overflow-hidden relative z-10">
          <div className="h-full bg-white/60 rounded-full" style={{ width: '78%' }}></div>
        </div>
        <p className="text-xs text-white/70 mt-2 relative z-10">完成率 78%</p>
      </div>
    </div>
  );
}
