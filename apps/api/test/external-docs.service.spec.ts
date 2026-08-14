import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AiGatewayChatRequest, AiGatewayTarget } from '../src/modules/ai-gateway/ai-gateway.types';
import { ExternalDocumentAiService } from '../src/modules/external-docs/external-document-ai.service';
import { ExternalDocsService } from '../src/modules/external-docs/external-docs.service';

type StoredDifference = {
  id: string;
  type: 'modified';
  risk: 'medium';
  location: string;
  title: string;
  before: string;
  after: string;
  confidence: number;
  reviewed: boolean;
  source: string;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reviewPrisma(initialDifferences: StoredDifference[]) {
  let comparison = {
    id: 'comparison-1',
    documentId: 'document-1',
    status: 'review',
    differences: clone(initialDifferences),
  };
  let lockTail = Promise.resolve();

  return {
    get differences() {
      return clone(comparison.differences);
    },
    async $transaction<T>(callback: (tx: unknown) => Promise<T>) {
      let releaseLock: (() => void) | undefined;
      const transaction = {
        $queryRaw: async () => {
          const previous = lockTail;
          lockTail = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          await previous;
          return [{ id: comparison.id }];
        },
        externalDocumentComparison: {
          findUnique: async () => clone(comparison),
          update: async ({ data }: { data: { differences: StoredDifference[] } }) => {
            // 让两个请求在没有行锁保护时有足够机会读到同一份旧 JSON。
            await new Promise((resolve) => setTimeout(resolve, 5));
            comparison = { ...comparison, differences: clone(data.differences) };
            return clone(comparison);
          },
        },
      };
      try {
        return await callback(transaction);
      } finally {
        releaseLock?.();
      }
    },
  };
}

function difference(id: string): StoredDifference {
  return {
    id,
    type: 'modified',
    risk: 'medium',
    location: `${id} 行`,
    title: id,
    before: '旧内容',
    after: '新内容',
    confidence: 80,
    reviewed: false,
    source: 'docx_text → docx_text',
  };
}

test('并发复核不同差异项时不会发生 JSON 覆盖丢失', async () => {
  const prisma = reviewPrisma([difference('diff-1'), difference('diff-2')]);
  const service = new ExternalDocsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );

  await Promise.all([
    service.reviewDifference('comparison-1', 'diff-1', true),
    service.reviewDifference('comparison-1', 'diff-2', true),
  ]);

  assert.deepEqual(
    prisma.differences.map((item) => [item.id, item.reviewed]),
    [['diff-1', true], ['diff-2', true]],
  );
});

test('详情接口保留历史版本对应的比对任务编号', async () => {
  const now = new Date('2026-07-23T00:00:00.000Z');
  const makeVersion = (id: string, version: string, status: string) => ({
    id,
    version,
    fileName: `${version}.docx`,
    fileSize: 128,
    uploadedByName: '测试用户',
    createdAt: now,
    fileUploadedAt: now,
    status,
    fileHash: id.repeat(8),
    uploadRevision: 1,
    replacementHistory: [],
  });
  const makeComparison = (
    id: string,
    jobCode: string,
    baselineVersionId: string,
    candidateVersionId: string,
  ) => ({
    id,
    jobCode,
    baselineVersionId,
    candidateVersionId,
    status: 'archived',
    summary: '归档摘要',
    differences: [],
    aiModel: 'deterministic-diff-v1',
    aiProvider: 'local-diff:fallback',
    aiGenerationMode: 'fallback',
    aiWarning: '规则降级',
    ocrProvider: 'native_text',
    ocrConfidence: null,
    errorMessage: null,
    completedAt: now,
    archivedAt: now,
  });
  let query: Record<string, unknown> | undefined;
  const prisma = {
    externalDocument: {
      findUnique: async (input: Record<string, unknown>) => {
        query = input;
        return {
          id: 'document-1',
          code: 'DOC-1',
          name: '对外资料',
          category: '产品资料',
          ownerName: '测试用户',
          currentVersionId: 'version-3',
          status: 'current',
          allowSend: true,
          updatedAt: now,
          versions: [
            makeVersion('version-3', 'V3.0', 'current'),
            makeVersion('version-2', 'V2.0', 'superseded'),
            makeVersion('version-1', 'V1.0', 'superseded'),
          ],
          comparisons: [
            makeComparison('comparison-2', 'CMP-LATEST', 'version-2', 'version-3'),
            makeComparison('comparison-1', 'CMP-OLD', 'version-1', 'version-2'),
          ],
        };
      },
    },
  };
  const service = new ExternalDocsService(
    prisma as never,
    {} as never,
    {} as never,
    { integrationStatus: async () => ({ ai: {}, ocr: {} }) } as never,
  );

  const detail = await service.detail('document-1');
  const comparisons = (query?.include as {
    comparisons?: { take?: number };
  }).comparisons;

  assert.equal(comparisons?.take, undefined);
  assert.equal(detail.versions.find((item) => item.id === 'version-2')?.compareId, 'CMP-OLD');
  assert.equal(detail.versions.find((item) => item.id === 'version-3')?.compareId, 'CMP-LATEST');
});

test('AI 返回内容不完整时标记为规则降级而不是 AI 已生效', async () => {
  const service = new ExternalDocumentAiService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const internal = service as unknown as {
    resolveRuntimeConfig: () => Promise<Record<string, string>>;
    callJson: () => Promise<string>;
  };
  internal.resolveRuntimeConfig = async () => ({
    apiKey: 'test',
    model: 'test-model',
    provider: 'test-provider',
  });
  internal.callJson = async () => JSON.stringify({
    summary: '只有摘要，没有逐项差异结果',
    differences: [],
  });

  const result = await service.analyze({
    baselineText: '产品型号 A',
    candidateText: '产品型号 B',
    baselineProvider: 'docx_text',
    candidateProvider: 'docx_text',
    baselineVersion: 'V1.0',
    candidateVersion: 'V1.1',
  });

  assert.equal(result.generationMode, 'fallback');
  assert.match(result.provider, /fallback/);
  assert.match(result.warning ?? '', /AI 差异分类调用失败/);
});

test('对外资料归档摘要通过统一网关场景路由生成', async () => {
  const calls: AiGatewayChatRequest[] = [];
  const routeTarget: AiGatewayTarget = {
    id: 'external-route',
    connectionId: 'external-route',
    provider: 'DeepSeek',
    model: 'deepseek-chat',
    apiKey: 'route-key',
  };
  const prisma = { integrationConfig: { findMany: async () => [] } };
  const config = { get: () => undefined };
  const aiGateway = {
    resolveTargets: async () => ({ targets: [routeTarget], timeoutMs: 45_000, source: 'route' }),
    complete: async (request: AiGatewayChatRequest) => {
      calls.push(request);
      return {
        content: '{"summary":"V2.0 已完成复核，可以归档。"}',
        model: 'deepseek-chat',
        provider: 'DeepSeek',
      };
    },
  };
  const service = new ExternalDocumentAiService(
    prisma as never,
    config as never,
    {} as never,
    {} as never,
    aiGateway as never,
  );

  const result = await service.regenerateSummary({
    baselineVersion: 'V1.0',
    candidateVersion: 'V2.0',
    differences: [difference('diff-1')],
  });

  assert.equal(result.generationMode, 'ai');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(result.provider, 'DeepSeek');
  assert.equal(calls[0]?.scene, 'external_docs.version_compare');
  assert.equal(calls[0]?.timeoutMs, 45_000);
  assert.equal(calls[0]?.retryWithoutResponseFormat, true);
  assert.deepEqual(calls[0]?.responseFormat, { type: 'json_object' });
});
