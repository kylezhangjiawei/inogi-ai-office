import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'motion/react';

const data = [
  { name: '新建', value: 4, color: '#90CAF9' },
  { name: '处理中', value: 5, color: '#64B5F6' },
  { name: '待客户', value: 2, color: '#4DD0E1' },
  { name: '已完成', value: 18, color: '#81C784' },
];

export function TicketStatusChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="rounded-2xl p-7 bg-white relative overflow-hidden"
      style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}
    >
      {/* 装饰性渐变 */}
      <div className="absolute top-0 right-0 w-64 h-64 opacity-5" style={{ background: 'radial-gradient(circle, #1976D2 0%, transparent 70%)' }}></div>

      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <h3 className="font-semibold text-xl mb-1">工单状态分布</h3>
          <p className="text-sm text-muted-foreground">近30天数据统计</p>
        </div>
        <div className="px-4 py-2 rounded-full bg-gradient-to-r from-blue-400 to-blue-600 text-white text-xs font-bold shadow-md">
          总计 29 单
        </div>
      </div>

      <div className="relative z-10">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 70 }}>
            <defs>
              {data.map((entry, index) => (
                <linearGradient key={`gradient-${index}`} id={`colorGradient${index}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={entry.color} stopOpacity={0.7}/>
                  <stop offset="100%" stopColor={entry.color} stopOpacity={1}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" horizontal={true} vertical={false} />
            <XAxis type="number" stroke="#757575" style={{ fontSize: '13px', fontWeight: '500' }} />
            <YAxis
              type="category"
              dataKey="name"
              stroke="#757575"
              style={{ fontSize: '13px', fontWeight: '600' }}
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.98)',
                border: 'none',
                borderRadius: '12px',
                fontSize: '13px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                padding: '10px 14px'
              }}
              cursor={{ fill: 'rgba(25, 118, 210, 0.05)' }}
            />
            <Bar dataKey="value" radius={[0, 12, 12, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={`url(#colorGradient${index})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="grid grid-cols-4 gap-4 mt-6">
          {data.map((item, index) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.1 }}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: `${item.color}10` }}
            >
              <div className="w-3 h-3 rounded-full" style={{ background: item.color }}></div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">{item.name}</div>
                <div className="text-lg font-bold" style={{ color: item.color }}>{item.value}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
