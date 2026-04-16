import { motion } from 'motion/react';
import { CheckCircle, AlertCircle, FileText, User } from 'lucide-react';

const activities = [
  {
    id: '1',
    type: 'completed',
    title: '工单 #20240315 已完成',
    user: '张工',
    time: '5分钟前',
    icon: CheckCircle,
    gradient: 'linear-gradient(135deg, #81C784 0%, #4CAF50 100%)'
  },
  {
    id: '2',
    type: 'update',
    title: 'CE认证资料已更新',
    user: '王芳',
    time: '1小时前',
    icon: FileText,
    gradient: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)'
  },
  {
    id: '3',
    type: 'alert',
    title: '报关单审核超时提醒',
    user: '系统',
    time: '2小时前',
    icon: AlertCircle,
    gradient: 'linear-gradient(135deg, #FFB74D 0%, #FB8C00 100%)'
  },
  {
    id: '4',
    type: 'assigned',
    title: '新工单已分配',
    user: '李明',
    time: '3小时前',
    icon: User,
    gradient: 'linear-gradient(135deg, #90CAF9 0%, #64B5F6 100%)'
  },
];

export function ActivityFeed() {
  return (
    <div className="rounded-2xl p-6 bg-white relative overflow-hidden" style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
      <div className="absolute top-0 right-0 w-40 h-40 opacity-5" style={{ background: 'radial-gradient(circle, #764ba2 0%, transparent 70%)' }}></div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <h3 className="font-semibold text-xl">最近动态</h3>
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
      </div>

      <div className="space-y-4 relative z-10">
        {activities.map((activity, index) => {
          const Icon = activity.icon;

          return (
            <motion.div
              key={activity.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              whileHover={{ x: 4 }}
              className="flex items-start gap-3 p-3 rounded-xl hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all cursor-pointer group"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md group-hover:scale-110 transition-transform"
                style={{ background: activity.gradient }}
              >
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium mb-1">
                  {activity.title}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{activity.user}</span>
                  <span>•</span>
                  <span>{activity.time}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full mt-6 py-3 text-sm font-medium text-white rounded-xl transition-all"
        style={{ background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)', boxShadow: '0 4px 12px rgba(33, 150, 243, 0.4)' }}
      >
        查看全部动态
      </motion.button>
    </div>
  );
}
