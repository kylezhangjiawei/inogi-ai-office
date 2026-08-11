/**
 * MateChat Agent 的权限桥。
 *
 * 背景：Agent 的写操作不走 HTTP 管道，所以 RolesGuard 不会自动生效。此前的做法是每个工具
 * 手抄一遍权限码——工具一多，就必然出现「控制器改了权限码、Agent 这边没跟上」的越权缺口。
 *
 * 这里改成**从控制器方法上反射它自己声明的 @Permissions**，注册表里一个权限码都不写。
 * 判定逻辑与 RolesGuard 逐行对齐；控制器改权限码，Agent 自动跟随。
 *
 * 失败关闭是本文件最重要的性质：反射不到权限声明、或声明为空数组（`@Permissions()` 在
 * RolesGuard 里等同放行），一律按「不可暴露给 Agent」处理。系统里有几十个没挂
 * @Permissions 的写端点，靠这条规则把它们挡在 Agent 能力之外。
 */
import 'reflect-metadata';

import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';

/**
 * 能被反射的目标：控制器类本身（不是实例）。
 * 用宽松类型是为了让任意 @Controller 类都能直接传进来，无需在调用处加断言。
 */
export type ControllerClass = Function;

/**
 * 反射控制器方法声明的权限码。
 *
 * 与 RolesGuard 的 getAllAndOverride([handler, class]) 同序：方法级优先，回退类级。
 * 返回 null 表示「没有有效声明」——调用方必须据此拒绝，而不是当作放行。
 */
export function requiredPermissionsFor(
  controller: ControllerClass,
  handlerName: string,
): string[] | null {
  const prototype = (controller as { prototype?: Record<string, unknown> }).prototype;
  const handler = prototype?.[handlerName];
  if (typeof handler !== 'function') return null;

  const fromHandler = Reflect.getMetadata(PERMISSIONS_KEY, handler) as unknown;
  const fromClass = Reflect.getMetadata(PERMISSIONS_KEY, controller) as unknown;
  const declared = normalizeCodes(fromHandler) ?? normalizeCodes(fromClass);

  // 空数组在 RolesGuard 里等同「无要求、直接放行」。对 HTTP 端点这可能是有意为之
  // （靠服务层自查），但对 Agent 必须按拒绝处理：我们没有能力逐个确认它们的内部校验。
  return declared && declared.length > 0 ? declared : null;
}

/** 元数据必须是数组；非字符串与空串项丢弃（宁可少放行，不可多放行） */
function normalizeCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((code): code is string => typeof code === 'string' && code.trim() !== '');
}

/**
 * 判定用户是否满足这组权限码。与 RolesGuard.canActivate 完全一致：
 * `*` 通配放行，否则命中任意一个即可（OR）。
 *
 * 注意 required 为空时这里返回 false，而 RolesGuard 返回 true——差异是刻意的：
 * 守卫在「端点没声明要求」时放行，而 Agent 在「拿不到要求」时必须拒绝。
 * 调用方本就应该先用 requiredPermissionsFor 的 null 结果拦掉这种情况。
 */
export function satisfiesPermissions(userPermissions: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return false;
  if (userPermissions.includes('*')) return true;
  return required.some((code) => userPermissions.includes(code));
}

/** 单条 Agent 操作的权限判定结果 */
export type AgentPermissionVerdict =
  | { allowed: true; required: string[] }
  /** undeclared：控制器没有有效的 @Permissions 声明，该操作不该暴露给 Agent */
  | { allowed: false; reason: 'undeclared'; required: null }
  /** denied：声明了权限，但当前用户不满足 */
  | { allowed: false; reason: 'denied'; required: string[] };

/**
 * 给定控制器方法与用户权限，给出是否放行。
 * 这是 Agent 侧唯一的权限入口——注册表、工具挂载、执行前校验都走它。
 */
export function checkAgentPermission(
  controller: ControllerClass,
  handlerName: string,
  userPermissions: readonly string[],
): AgentPermissionVerdict {
  const required = requiredPermissionsFor(controller, handlerName);
  if (!required) return { allowed: false, reason: 'undeclared', required: null };
  if (!satisfiesPermissions(userPermissions, required)) {
    return { allowed: false, reason: 'denied', required };
  }
  return { allowed: true, required };
}
