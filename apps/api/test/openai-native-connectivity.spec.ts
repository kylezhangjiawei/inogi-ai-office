import * as assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { OpenAiScreeningService } from '../src/modules/resume-screening/openai-screening.service';

function createService() {
  return new OpenAiScreeningService(
    { get: () => undefined } as never,
    {} as never,
  );
}

test('DashScope 图片连通探测使用原生端点并将参数校验响应视为可达', async () => {
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const fetchMock = mock.method(globalThis, 'fetch', async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({
      code: 'InvalidParameter',
      message: 'input.messages must contain one item',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const result = await createService().testDashScopeNativeConnection(
      'image',
      'test-key',
      'qwen-image-2.0',
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'Qwen',
    );

    assert.equal(
      requestedUrl,
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    assert.equal(requestedInit?.method, 'POST');
    assert.match(String(requestedInit?.body), /qwen-image-2\.0/);
    assert.equal(result.modelName, 'qwen-image-2.0');
    assert.match(result.outputText, /未发起内容生成/);
  } finally {
    fetchMock.mock.restore();
  }
});

test('DashScope 原生探测不会把模型不支持错误误判为成功', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'InvalidParameter',
    message: "Unsupported model: 'qwen-image-2.0'.",
  }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    await assert.rejects(
      createService().testDashScopeNativeConnection(
        'image',
        'test-key',
        'qwen-image-2.0',
        'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        'Qwen',
      ),
      /Unsupported model/,
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test('DashScope TTS 缺少生成参数时返回模型服务 415 仍证明原生协议可达', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    code: 'InternalError.Algo',
    message: "[tts-frontend]Failed to invoke 'jai_stream_processor_start_customized', ret=415",
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await createService().testDashScopeNativeConnection(
      'audio',
      'test-key',
      'qwen-audio-3.0-tts-plus',
      'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      'Qwen',
    );
    assert.equal(result.modelName, 'qwen-audio-3.0-tts-plus');
    assert.match(result.outputText, /未发起内容生成/);
  } finally {
    fetchMock.mock.restore();
  }
});
