import { motion } from 'motion/react';
import { MoreVertical, Calendar, User } from 'lucide-react';

interface TodoItem {
  id: string;
  name: string;
  module: string;
  assignee: string;
  deadline: string;
  status: 'pending' | 'in-progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

const todos: TodoItem[] = [
  {
    id: '1',
    name: 'OC-5 序列号 20240315 报警处理',
    module: '售后工单',
    assignee: '张工',
    deadline: '2026-04-12',
    status: 'pending',
    priority: 'high'
  },
  {
    id: '2',
    name: '3月批次报关单整理',
    module: '报关单证',
    assignee: '李明',
    deadline: '2026-04-11',
    status: 'in-progress',
    priority: 'medium'
  },
  {
    id: '3',
    name: 'CE认证资料更新',
    module: '资料库',
    assignee: '王芳',
    deadline: '2026-04-15',
    status: 'in-progress',
    priority: 'medium'
  },
  {
    id: '4',
    name: '氧浓度传感器异常问题分析',
    module: '研发问题',
    assignee: '赵工',
    deadline: '2026-04-10',
    status: 'pending',
    priority: 'high'
  },
  {
    id: '5',
    name: 'Q1质量报告审核',
    module: '质量管理',
    assignee: '刘总',
    deadline: '2026-04-08',
    status: 'completed',
    priority: 'low'
  },
];

const statusConfig = {
  pending: { label: '待处理', gradient: 'linear-gradient(135deg, #FFCDD2 0%, #EF9A9A 100%)', textColor: '#D32F2F' },
  'in-progress': { label: '进行中', gradient: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 100%)', textColor: '#1976D2' },
  completed: { label: '已完成', gradient: 'linear-gradient(135deg, #C8E6C9 0%, #A5D6A7 100%)', textColor: '#388E3C' },
};

const priorityConfig = {
  high: { label: '高', gradient: 'linear-gradient(135deg, #EF5350 0%, #E53935 100%)' },
  medium: { label: '中', gradient: 'linear-gradient(135deg, #FFA726 0%, #FB8C00 100%)' },
  low: { label: '低', gradient: 'linear-gradient(135deg, #90CAF9 0%, #64B5F6 100%)' },
};

export function TodoTable() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="rounded-2xl bg-white overflow-hidden relative"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
    >
      {/* 顶部装饰渐变 */}
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #64B5F6 0%, #2196F3 50%, #1976D2 100%)' }}></div>
      <div className="p-7 border-b flex items-center justify-between" style={{ borderColor: '#E0E0E0' }}>
        <div>
          <h3 className="font-semibold text-xl mb-1">待办事项</h3>
          <p className="text-sm text-muted-foreground">优先级管理 · 共 {todos.length} 项</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-5 py-2.5 text-sm font-bold text-white rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #64B5F6 0%, #2196F3 100%)',
              boxShadow: '0 4px 12px rgba(33, 150, 243, 0.4)'
            }}
          >
            全部
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05, backgroundColor: '#F5F5F5' }}
            whileTap={{ scale: 0.95 }}
            className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-100 rounded-xl transition-colors"
          >
            待处理
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05, backgroundColor: '#F5F5F5' }}
            whileTap={{ scale: 0.95 }}
            className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-100 rounded-xl transition-colors"
          >
            进行中
          </motion.button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/30" style={{ borderColor: '#E5E8EB' }}>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground">事项名称</th>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground">来源模块</th>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground">负责人</th>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground">截止时间</th>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground">状态</th>
              <th className="text-left px-5 py-3 text-sm font-semibold text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {todos.map((todo, index) => (
              <motion.tr
                key={todo.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="border-b last:border-0 group cursor-pointer hover:bg-muted/20"
                style={{ borderColor: '#F1F3F5' }}
              >
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    {todo.priority && (
                      <div className="w-1.5 h-8 rounded-full" style={{ background: priorityConfig[todo.priority].gradient }}></div>
                    )}
                    <div className="text-sm font-medium">
                      {todo.name}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <span className="text-sm text-muted-foreground">
                    {todo.module}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                      style={{ background: `hsl(${index * 60}, 65%, 55%)` }}
                    >
                      {todo.assignee[0]}
                    </div>
                    <span>{todo.assignee}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-muted-foreground">{todo.deadline}</td>
                <td className="px-5 py-3.5">
                  <span
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold shadow-sm"
                    style={{
                      background: statusConfig[todo.status].gradient,
                      color: statusConfig[todo.status].textColor
                    }}
                  >
                    {statusConfig[todo.status].label}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <button className="p-1.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    <MoreVertical className="w-4 h-4 text-muted-foreground" />
                  </button>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
