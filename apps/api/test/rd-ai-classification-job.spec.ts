import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { RdAiController } from '../src/modules/research-development/rd-ai.controller';
import type {
  RdAiProjectClassificationInput,
  RdAiProjectClassificationResult,
  RdAiService,
} from '../src/modules/research-development/rd-ai.service';
import type { ResearchDevelopmentService } from '../src/modules/research-development/research-development.service';

const completedResult: RdAiProjectClassificationResult = {
  scope: {
    product_id: 'all-products',
    category_id: 'all-categories',
    label: '全部线上任务（跨产品库）',
    task_count: 1,
    analyzed_task_count: 1,
    attachment_count: 0,
  },
  summary: '分析完成',
  categories: [],
  duplicate_groups: [],
  homogeneous_clusters: [],
  member_task_lines: [],
  recommendations: [],
  warnings: [],
  provider: 'local',
  model: 'test-model',
  generated_at: '2026-08-06T00:00:00.000Z',
};

test('full-task classification job returns immediately and exposes the completed result only to its creator', async () => {
  let resolveAnalysis!: (result: RdAiProjectClassificationResult) => void;
  const analysis = new Promise<RdAiProjectClassificationResult>((resolve) => {
    resolveAnalysis = resolve;
  });
  let receivedInput: RdAiProjectClassificationInput | undefined;

  const aiService = {
    classifyProject(input: RdAiProjectClassificationInput) {
      receivedInput = input;
      return analysis;
    },
  } as unknown as RdAiService;
  const rdService = {
    async getProjectClassificationContext() {
      return {
        product_id: 'all-products',
        category_id: 'all-categories',
        label: '全部线上任务（跨产品库）',
        task_count: 1,
        tasks: [{
          task_id: 'task-1',
          title: '任务一',
          description: '',
          status: 'in_progress',
          progress: 10,
          priority: 'medium',
          primary_owner: '成员甲',
          due_date: '2026-08-31',
          category_path: '研发 / 测试',
          parent_task_id: null,
          tree_depth: 0,
        }],
      };
    },
  } as unknown as ResearchDevelopmentService;
  const controller = new RdAiController(aiService, rdService);

  const created = await controller.createProjectClassificationJob(
    { user: { id: 'admin-1' } },
    [],
    { instruction: '检查重复任务' },
  );

  assert.equal(created.status, 'queued');
  assert.ok(created.job_id);
  assert.equal(receivedInput, undefined, '后台分析不应阻塞创建任务的响应');

  await new Promise<void>((resolve) => setImmediate(resolve));
  const startedInput = receivedInput as RdAiProjectClassificationInput | undefined;
  assert.equal(startedInput?.instruction, '检查重复任务');
  assert.equal(controller.getProjectClassificationJob(
    { user: { id: 'admin-1' } },
    created.job_id,
  ).status, 'running');

  assert.throws(
    () => controller.getProjectClassificationJob({ user: { id: 'admin-2' } }, created.job_id),
    NotFoundException,
  );

  resolveAnalysis(completedResult);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const completed = controller.getProjectClassificationJob(
    { user: { id: 'admin-1' } },
    created.job_id,
  );
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result, completedResult);
});
