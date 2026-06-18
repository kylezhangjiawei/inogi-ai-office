import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/**
 * 展开/收起的高度 + 透明度过渡（供日报/月报等就地展开区复用）。
 *
 * 性能取舍：
 * - 仅在 `open` 时挂载内容；收起时由 AnimatePresence 短暂保留旧节点播放退出动画，
 *   不长期占用 DOM（折叠项不渲染重内容）。
 * - 动画只作用于 height/opacity，外层 overflow-hidden 防止动画期间内容溢出；
 *   高度过渡时长很短（~0.22s），且一次只有一个区块在动。
 * - 尊重系统「减少动态效果」偏好：useReducedMotion 命中时跳过位移/高度动画，仅留淡入淡出。
 */
export function CollapseTransition({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ overflow: "hidden" }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
