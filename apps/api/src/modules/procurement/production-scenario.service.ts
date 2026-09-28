import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ProcActor } from './procurement.types';
import { ProductionExecutionService } from './production-execution.service';
import { ProductionReadinessService } from './production-readiness.service';
import { executionDay, executionMonth, executionQty, executionText, type ExecutionPlan } from './production-execution.model';

export function scenarioProposals(input: unknown, codes: Set<string>, date: string) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 1000) throw new BadRequestException('草稿采购方案无效');
  const seen = new Set<string>();
  return input.map(row => {
    if (!row || typeof row !== 'object') throw new BadRequestException('草稿采购方案无效');
    const code = executionText(row.code, '方案物料编码');
    if (!codes.has(code) || seen.has(code)) throw new BadRequestException('方案物料不属于当前 BOM 或重复');
    seen.add(code);
    const quantity = executionQty(row.quantity, '未下单方案数量'), availableDate = executionDay(row.availableDate, '方案检验后可用日');
    return { code, quantity, availableDate, onTime: availableDate <= date };
  });
}
@Injectable()
export class ProductionScenarioService {
  constructor(private readonly execution: ProductionExecutionService, private readonly readiness: ProductionReadinessService) {}
  async simulate(input: Record<string, unknown>, actor: ProcActor) {
    if (!input || typeof input !== 'object') throw new BadRequestException('请填写试算条件');
    const month = executionMonth(input.month), date = executionDay(input.date, '草稿需求日期');
    if (!date.startsWith(month)) throw new BadRequestException('草稿需求日期须在所选月份');
    const productLine = executionText(input.productLine, 'BOM 型号'), targetQty = executionQty(input.targetQty, '草稿整机目标', true, true);
    const bom = await this.execution.bom(productLine, actor);
    if (!bom.items.length || bom.invalid || bom.items.some(row => !row.code?.trim() || !row.unit?.trim() || !Number.isFinite(row.qtyPer) || !(Number(row.qtyPer) > 0)) || new Set(bom.items.map(row => row.code)).size !== bom.items.length) throw new BadRequestException('BOM 编码、单位或用量待核对，无法试算');
    const items = bom.items.map(row => ({ ...row, code: row.code!, qtyPer: row.qtyPer! }));
    const proposals = scenarioProposals(input.proposals, new Set(items.map(row => row.code)), date);
    const plan: ExecutionPlan = { id: `scenario:${actor.id}`, version: 0, month, productId: '', productName: '草稿情景', productLine, targetQty,
      shipmentTargetQty: 0, bom: items, bomFingerprint: createHash('sha256').update(JSON.stringify(bom.items)).digest('hex'), batches: [], tasks: [], events: [] };
    const basis = await this.readiness.simulate(plan, date, actor);
    const lines = basis.lines.map(line => {
      const proposal = proposals.find(row => row.code === line.code), proposedQty = proposal?.onTime ? proposal.quantity : 0;
      return { ...line, proposal: proposal ?? null, proposedQty, scenarioAvailable: line.projected === null ? null : new Prisma.Decimal(line.projected).plus(proposedQty).toNumber(),
        scenarioGap: line.projected === null || line.problems.length ? null : Prisma.Decimal.max(new Prisma.Decimal(line.remainingDemand).minus(line.projected).minus(proposedQty), 0).toNumber() };
    });
    const scenarioSets = basis.currentSets === null ? null : Math.min(targetQty, ...lines.map(line => new Prisma.Decimal(line.scenarioAvailable!).div(line.qtyPer).floor().toNumber()));
    return { kind: 'draft-scenario' as const, month, date, productLine, targetQty, bomFingerprint: plan.bomFingerprint, calculatedAt: new Date().toISOString(),
      currentSets: basis.currentSets === null ? null : Math.min(targetQty, basis.currentSets), scenarioSets, lines,
      notice: '仅供草稿比较，不创建正式目标、不占用库存、不分配采购、不保存为正式历史。已分配给正式计划的供给不重复覆盖；未下单方案单列，不能视为正式在途。' };
  }
}
