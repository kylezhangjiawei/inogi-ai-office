import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import type {
  AiGatewayAdapterResult,
  AiGatewayChatRequest,
  AiGatewayTarget,
} from './ai-gateway.types';
import { isAliyunOpenAiEndpoint } from './openai-endpoint-policy';

@Injectable()
export class OpenAiCompatibleAdapter {
  constructor(private readonly config: ConfigService) {}

  async complete(
    target: AiGatewayTarget,
    request: Omit<AiGatewayChatRequest, 'targets'>,
  ): Promise<AiGatewayAdapterResult> {
    const isQwenTarget = /qwen|tongyi|dashscope|通义|阿里/i.test(`${target.provider} ${target.model}`);
    const proxyFetch =
      isQwenTarget || isAliyunOpenAiEndpoint(target.baseUrl)
        ? undefined
        : this.buildProxyFetch();
    const client = new OpenAI({
      apiKey: target.apiKey,
      ...(target.baseUrl ? { baseURL: target.baseUrl } : {}),
      ...(typeof request.timeoutMs === 'number' ? { timeout: request.timeoutMs } : {}),
      ...(proxyFetch ? { fetch: proxyFetch } : {}),
      // The gateway owns cross-target retries. SDK retries here would multiply latency and cost.
      maxRetries: 0,
    });
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
