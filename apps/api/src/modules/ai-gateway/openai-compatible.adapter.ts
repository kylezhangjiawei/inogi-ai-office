import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import type {
  AiGatewayAdapterResult,
  AiGatewayChatRequest,
  AiGatewayStreamChunk,
  AiGatewayStreamRequest,
  AiGatewayTarget,
} from './ai-gateway.types';
import { isAliyunOpenAiEndpoint } from './openai-endpoint-policy';

@Injectable()
export class OpenAiCompatibleAdapter {
  constructor(private readonly config: ConfigService) {}

  /**
   * 流式补全。与 complete 共用目标判定，但由调用方逐分片消费；usage 通过
   * stream_options 随最后一个分片回传，替代按字数粗估 token。
   */
  async stream(
    target: AiGatewayTarget,
    request: Omit<AiGatewayStreamRequest, 'targets' | 'requestId' | 'onTargetSettled'>,
  ): Promise<AsyncIterable<AiGatewayStreamChunk>> {
    const isQwenTarget = this.isQwenTarget(target);
    const client = this.buildClient(target, request.timeoutMs, isQwenTarget);
    return client.chat.completions.create(
      {
        model: target.model,
        messages: request.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.tools?.length ? { tools: request.tools } : {}),
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
        ...(isQwenTarget ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
        // enable_search 只有阿里 compatible-mode 认；按目标端点判断，避免降级到其他
        // 厂商的连接时带着未知参数被 400。
        ...(request.webSearch && isAliyunOpenAiEndpoint(target.baseUrl)
          ? ({ enable_search: true, search_options: { forced_search: false } } as Record<string, unknown>)
          : {}),
      },
      { ...(request.signal ? { signal: request.signal } : {}) },
    );
  }

  async complete(
    target: AiGatewayTarget,
    request: Omit<AiGatewayChatRequest, 'targets'>,
  ): Promise<AiGatewayAdapterResult> {
    const isQwenTarget = this.isQwenTarget(target);
    const client = this.buildClient(target, request.timeoutMs, isQwenTarget);
    const response = await client.chat.completions.create({
      model: target.model,
      messages: request.messages,
      ...(request.responseFormat ? { response_format: request.responseFormat } : {}),
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
      ...(typeof request.maxTokens === 'number' ? { max_tokens: request.maxTokens } : {}),
      ...(isQwenTarget ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
    });

    return {
      content: (response.choices[0]?.message?.content ?? '').trim(),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }

  private isQwenTarget(target: AiGatewayTarget): boolean {
    return /qwen|tongyi|dashscope|通义|阿里/i.test(`${target.provider} ${target.model}`);
  }

  private buildClient(target: AiGatewayTarget, timeoutMs: number | undefined, isQwenTarget: boolean): OpenAI {
    const proxyFetch =
      isQwenTarget || isAliyunOpenAiEndpoint(target.baseUrl)
        ? undefined
        : this.buildProxyFetch();
    return new OpenAI({
      apiKey: target.apiKey,
      ...(target.baseUrl ? { baseURL: target.baseUrl } : {}),
      ...(typeof timeoutMs === 'number' ? { timeout: timeoutMs } : {}),
      ...(proxyFetch ? { fetch: proxyFetch } : {}),
      // The gateway owns cross-target retries. SDK retries here would multiply latency and cost.
      maxRetries: 0,
    });
  }

  private buildProxyFetch(): typeof fetch | undefined {
    const proxyUrl =
      this.config.get<string>('HTTPS_PROXY') ??
      this.config.get<string>('https_proxy') ??
      this.config.get<string>('HTTP_PROXY') ??
      this.config.get<string>('http_proxy') ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy;
    if (!proxyUrl?.trim()) return undefined;

    try {
      const undici = require('undici') as {
        ProxyAgent?: new (uri: string) => unknown;
        fetch?: (input: unknown, init?: Record<string, unknown>) => Promise<unknown>;
      };
      if (!undici.ProxyAgent || !undici.fetch) return undefined;
      const dispatcher = new undici.ProxyAgent(proxyUrl.trim());
      const noProxyList = (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      return ((input: unknown, init?: Record<string, unknown>) => {
        const targetUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        const hostname = targetUrl ? new URL(targetUrl).hostname.toLowerCase() : '';
        const bypass = hostname && noProxyList.some(
          (item) => hostname === item || hostname.endsWith(`.${item.replace(/^\./, '')}`),
        );
        if (bypass) {
          return globalThis.fetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
        }
        return undici.fetch!(input, { ...(init ?? {}), dispatcher }) as Promise<Response>;
      }) as typeof fetch;
    } catch {
      return undefined;
    }
  }
}
