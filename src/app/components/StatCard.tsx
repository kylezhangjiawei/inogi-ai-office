import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'motion/react';

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  gradient: string;
  trend?: number;
  trendLabel?: string;
  large?: boolean;
  compact?: boolean;
}

export function StatCard({ title, value, icon, gradient, trend = 0, trendLabel = '较上周', large = false, compact = false }: StatCardProps) {
  const isPositive = trend > 0;
  const isNegative = trend < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      whileHover={{ y: -6, scale: 1.02 }}
      className={`rounded-2xl overflow-hidden transition-all duration-300 relative ${compact ? 'p-5' : large ? 'p-8' : 'p-6'}`}
      style={{
        background: gradient,
        boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
      }}
    >
      {/* 装饰性图案 */}
      <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}></div>
      </div>

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className={`${compact ? 'w-12 h-12' : large ? 'w-20 h-20' : 'w-16 h-16'} rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shadow-lg`}>
            <div className="text-white">
              {icon}
            </div>
          </div>
          {trend !== 0 && (
            <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-white/30 backdrop-blur-sm text-white`}>
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : isNegative ? <TrendingDown className="w-3.5 h-3.5" /> : null}
              <span>{isPositive ? '+' : ''}{trend}%</span>
            </div>
          )}
        </div>

        <div className={`${compact ? 'text-xs' : 'text-sm'} text-white/90 mb-2 font-medium`}>{title}</div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className={`${compact ? 'text-3xl' : large ? 'text-6xl' : 'text-5xl'} font-bold text-white mb-1`}
        >
          {value}
        </motion.div>
        {trend !== 0 && (
          <div className={`${compact ? 'text-xs' : 'text-sm'} text-white/80`}>{trendLabel}</div>
        )}
      </div>

      {/* 底部渐变装饰 */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/30"></div>
    </motion.div>
  );
}
