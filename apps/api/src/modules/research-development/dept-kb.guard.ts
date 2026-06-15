import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DEPT_KB_OPS, deptKbPageCode, isDeptKbId } from './dept-knowledge.constants';

export const DEPT_KB_OP_KEY = 'deptKbOps';

/**
 * 标注某写操作端点所需的部门知识库操作码（任一满足即可，OR 逻辑）。
 * 不标注的端点视为只读：仅要求持有该部门库的页面码。
 */
export const DeptKbOp = (...ops: string[]) => SetMetadata(DEPT_KB_OP_KEY, ops);

/**
 * 部门知识库守卫：在全局 JwtAuthGuard/RolesGuard 之后运行（控制器级 @UseGuards）。
 * 与研发知识库静态 @Permissions 不同——这里 kbId 来自路由参数，必须运行时动态判定：
 *  1. 超管（*）直接放行；
 *  2. 校验 kbId 在部门白名单内，否则 404；
 *  3. 必须持有该部门库的页面码 page:dept-kb-{kbId}（即「属于该部门库」），否则拒绝——
 *     这是部门间隔离的关键：操作码 dept-kb:* 是所有部门库共用的，光有操作码不能跨部门访问；
 *  4. 写端点再校验 @DeptKbOp 标注的操作码（dept-kb:manage 隐含全部）。
 */
@Injectable()
export class DeptKbGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: { permissions?: string[] };
      params?: { kbId?: string };
    }>();
    const user = req.user;
    if (!user) return false;

    // 先校验 kbId 白名单（含超管）：非法部门路由一律 404，避免读到空的未知库
    const kbId = req.params?.kbId;
    if (!isDeptKbId(kbId)) throw new NotFoundException('部门知识库不存在');

    const perms = user.permissions ?? [];
    if (perms.includes('*')) return true;

    // 必须属于该部门库（持有其页面码）；操作码为共用，不能凭操作码跨部门访问
    if (!perms.includes(deptKbPageCode(kbId!))) return false;

    const requiredOps = this.reflector.get<string[]>(DEPT_KB_OP_KEY, context.getHandler());
    if (!requiredOps || requiredOps.length === 0) return true; // 只读端点

    if (perms.includes(DEPT_KB_OPS.MANAGE)) return true;
    return requiredOps.some((op) => perms.includes(op));
  }
}
