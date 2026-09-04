/**
 * AI 连通性测试失败原因诊断。
 *
 * 上游（OpenAI SDK / 阿里云百炼 / 原生接口）抛出的都是英文原文加状态码，
 * 很难一眼看出是 Key 错了、模型不存在还是接口形态不对。这里按错误签名和
 * HTTP 状态归类，翻译成中文结论 + 按可能性排序的具体情况，供「全部测试」
 * 结果面板、模型卡片和 last_error_message 统一使用。
 */

export type AiConnectionErrorCode =
  | 'CONFIG_MISSING'
  | 'TIMEOUT'
  | 'API_MODE_UNSUPPORTED'
  | 'NETWORK_UNREACHABLE'
  | 'BILLING'
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'MODEL_NOT_FOUND'
  | 'ENDPOINT_NOT_FOUND'
  | 'EMPTY_RESPONSE'
  | 'BAD_REQUEST'
  | 'UPSTREAM_ERROR'
  | 'UNKNOWN';

export type AiConnectionErrorDiagnosis = {
  code: AiConnectionErrorCode;
  /** 一句话中文结论 */
  reason: string;
  /** 可能造成该错误的具体情况，按可能性从高到低 */
  causes: string[];
  /** 上游原始错误文本（含状态码、错误码） */
  raw: string;
  /** 结论 + 可能情况 + 原始错误，可直接展示或落库 */
  message: string;
};

export type AiConnectionErrorContext = {
  provider?: string | null;
  model: string;
  baseUrl?: string | null;
};

type ErrorFacts = {
  status: number | null;
  code: string;
  type: string;
  name: string;
  /** raw + code + type 拼成的匹配文本 */
  text: string;
};

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function extractFacts(error: unknown, raw: string): ErrorFacts {
  const source = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  const nested = (source.error && typeof source.error === 'object' ? source.error : {}) as Record<string, unknown>;
  const cause = (source.cause && typeof source.cause === 'object' ? source.cause : {}) as Record<string, unknown>;

  let status: number | null = null;
  if (typeof source.status === 'number') {
    status = source.status;
  } else if (typeof cause.status === 'number') {
    status = cause.status;
  } else {
    const matched = raw.match(/^(\d{3})\s/)
      ?? raw.match(/status=(\d{3})/)
      ?? raw.match(/HTTP (\d{3})/)
      ?? raw.match(/<(\d{3})>/);
    status = matched ? Number(matched[1]) : null;
  }

  const code = readString(source.code) || readString(nested.code) || readString(cause.code);
  const type = readString(source.type) || readString(nested.type);
  const name = readString(source.name);

  return { status, code, type, name, text: `${raw} ${code} ${type}` };
}

function classify(
  facts: ErrorFacts,
  ctx: AiConnectionErrorContext,
): Pick<AiConnectionErrorDiagnosis, 'code' | 'reason' | 'causes'> {
  const { status, code, name, text } = facts;
  const baseUrl = ctx.baseUrl?.trim() || '';
  const baseUrlLabel = baseUrl || '默认官方地址';
  const providerLabel = ctx.provider?.trim() || '该服务商';
  const isAliyun = /aliyuncs\.com/i.test(baseUrl);

  // 1. 本地配置缺失：还没发出请求
  if (status === null && /not configured|未配置|不能为空|需要配置/i.test(text)) {
    return {
      code: 'CONFIG_MISSING',
      reason: '本地配置不完整，尚未向服务商发起请求',
      causes: [
        '该模型没有保存 API Key，或保存的 Key 无法解密',
        '视频 / 音频类模型缺少阿里云百炼原生协议地址',
        '模型标识为空',
      ],
    };
  }

  // 2. 超时
  if (
    name === 'APIConnectionTimeoutError'
    || name === 'AbortError'
    || status === 408
    || /timed?\s?out|timeout|超时|ETIMEDOUT/i.test(text)
  ) {
    return {
      code: 'TIMEOUT',
      reason: '请求超时，服务商在限定时间内没有返回结果',
      causes: [
        '服务商当前排队或响应缓慢（深度思考类模型首个 token 可能很慢）',
        `服务器到 ${baseUrlLabel} 的网络链路不稳定，或需要经过代理`,
        '服务地址填错，连接一直挂起直到超时',
      ],
    };
  }

  // 3. 接口形态不被支持（百炼第三方模型不支持 Responses / Agent 接口的典型签名）
  if (/Agent capabilities are not enabled|agent_api_metadata|responses?\s?api.*(not supported|unsupported)|(not support|unsupported).*responses/i.test(text)) {
    return {
      code: 'API_MODE_UNSUPPORTED',
      reason: '服务商不支持用当前接口形态（OpenAI Responses / Agent 接口）调用该模型',
      causes: [
        `系统对「${ctx.model}」走的是 OpenAI Responses 接口，而它在${isAliyun ? '阿里云百炼' : providerLabel}的当前服务地址上只开放了 Chat Completions 接口；目前只有 DeepSeek 与文档类模型会自动改走 Chat Completions`,
        isAliyun
          ? '阿里云百炼上的第三方模型（GLM / Kimi / MiniMax 等）普遍只支持 Chat Completions，需要为它们单独指定接口形态'
          : '账号或套餐没有为该模型开通 Agent 能力',
        '模型标识与服务地址不匹配，请求落到了不支持该接口的网关',
      ],
    };
  }

  // 4. 网络不可达
  if (
    name === 'APIConnectionError'
    || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|getaddrinfo|fetch failed|socket hang up|certificate|self.signed|\bSSL\b|\bTLS\b|Connection error/i.test(text)
  ) {
    return {
      code: 'NETWORK_UNREACHABLE',
      reason: `无法连接到服务地址 ${baseUrlLabel}`,
      causes: [
        'Base URL 拼写错误、域名不存在或已停用',
        '服务器无法访问该域名（出网受限、需要代理、DNS 解析失败）',
        'HTTPS 证书校验失败（自签证书或中间人代理）',
      ],
    };
  }

  // 5. 欠费 / 额度：要先于 403 / 429 的泛化判断
  if (
    status === 402
    || /arrearage|insufficient.?quota|insufficient.?balance|quota.*(exceed|exhaust)|unpurchased|good standing|欠费|余额|额度不足|billing/i.test(text)
  ) {
    return {
      code: 'BILLING',
      reason: '账号欠费或额度不足，服务商拒绝了计费调用',
      causes: [
        '账户余额不足或已欠费',
        '免费额度 / 预付费套餐已用完或已过期',
        `该模型没有在 ${providerLabel} 账号下开通计费或购买套餐`,
      ],
    };
  }

  // 6. 鉴权失败
  if (
    status === 401
    || /invalid_?api_?key|InvalidApiKey|InvalidAccessKeyId/i.test(code)
    || /invalid[\s_-]*api[\s_-]*key|incorrect api key|api[\s-]?key[^.]{0,40}(invalid|expired|not found|incorrect)|unauthori[sz]ed|authentication|access[\s-]?token[^.]{0,30}(expired|invalid)/i.test(text)
  ) {
    return {
      code: 'AUTH_FAILED',
      reason: 'API Key 无效，未通过服务商鉴权',
      causes: [
        'API Key 填写错误、已删除或已过期',
        `Key 与服务商不匹配（例如把 OpenAI 的 Key 用在了 ${baseUrlLabel} 上）`,
        'Key 所属地域与服务地址不一致（百炼北京 / 新加坡地域的 Key 互不通用）',
      ],
    };
  }

  // 7. 无权限
  if (status === 403 || /forbidden|access.?denied|permission|not authorized|无权限/i.test(text)) {
    return {
      code: 'PERMISSION_DENIED',
      reason: '账号无权调用该模型',
      causes: [
        `该模型需要在 ${providerLabel} 控制台申请开通或加入白名单`,
        '子账号 / 项目级 Key 没有该模型的调用权限',
        '账号被限制，或所在地域不提供该模型',
      ],
    };
  }

  // 8. 限流
  if (status === 429 || /rate.?limit|too many requests|throttl|限流/i.test(text)) {
    return {
      code: 'RATE_LIMITED',
      reason: '触发服务商限流，请求被拒绝',
      causes: [
        '短时间内并发或每分钟请求数超过账号配额（「全部测试」会同时发起 3 个请求）',
        '账号处于低速率等级，需要提升配额',
        '稍后重试或降低并发即可恢复',
      ],
    };
  }

  // 9. 模型不存在
  if (
    /model_not_found|ModelNotFound|ModelNotExist|invalid_model|unknown_model/i.test(code)
    // 只在同一句里找"模型 … 不存在"，避免跨过括号里的 code=InvalidParameter 误判
    || /(?:\bmodel\b|模型)[^.;()]{0,60}(?:not found|does not exist|not exist|not available|不存在)|unsupported model|no such model|unknown model|invalid model\b/i.test(text)
  ) {
    return {
      code: 'MODEL_NOT_FOUND',
      reason: `模型标识「${ctx.model}」在 ${baseUrlLabel} 下不存在`,
      causes: [
        '模型标识拼写或版本号错误（注意大小写和连字符）',
        '模型已下线或更名',
        '该服务地址 / 地域没有提供这个模型（例如百炼北京地域未上架）',
      ],
    };
  }

  // 10. 接口路径不存在
  if (status === 404 || /request path not found|endpoint.+not found/i.test(text)) {
    return {
      code: 'ENDPOINT_NOT_FOUND',
      reason: `服务地址 ${baseUrlLabel} 下找不到接口路径`,
      causes: [
        'Base URL 少写或多写了路径（OpenAI 兼容地址通常以 /v1 结尾）',
        '该地址不是 OpenAI 兼容接口，需要改用服务商的兼容模式地址',
        '服务商已更改接口路径',
      ],
    };
  }

  // 11. 有响应但没内容
  if (/empty content|未返回向量|返回空/i.test(text)) {
    return {
      code: 'EMPTY_RESPONSE',
      reason: '服务商已响应，但没有返回可用内容',
      causes: [
        '深度思考类模型把仅有的输出预算用在了推理上，正文为空',
        '内容被服务商安全策略拦截',
        'Embedding 接口没有返回向量',
      ],
    };
  }

  // 12. 参数被拒
  if (status === 400 || status === 422 || /invalid_request_error/i.test(facts.type) || /InvalidParameter/i.test(code)) {
    return {
      code: 'BAD_REQUEST',
      reason: '请求参数被服务商拒绝',
      causes: [
        '该模型不支持测试所用的参数或接口形态（例如 max_tokens / enable_thinking / JSON 模式）',
        '模型标识与服务地址不匹配',
        `${providerLabel} 对该模型有额外的必填参数要求`,
      ],
    };
  }

  // 13. 服务商内部错误
  if ((status !== null && status >= 500) || /InternalError|internal server error|bad gateway|service unavailable|gateway timeout/i.test(text)) {
    return {
      code: 'UPSTREAM_ERROR',
      reason: `服务商内部错误${status ? `（HTTP ${status}）` : ''}`,
      causes: [
        '服务商临时故障或模型实例过载，稍后重试通常可恢复',
        'InternalError.Algo 类错误通常表示算法服务拒绝了该模型的请求形态或参数',
        '该模型在当前地域尚未真正开放',
      ],
    };
  }

  return {
    code: 'UNKNOWN',
    reason: '连通性测试失败，未能识别具体原因',
    causes: [
      '请对照原始错误检查 Base URL、模型标识、API Key 三者是否匹配',
      '用该模型卡片上的「测试连通性」重试一次，排除偶发故障',
    ],
  };
}

export function diagnoseAiConnectionError(
  error: unknown,
  raw: string,
  ctx: AiConnectionErrorContext,
): AiConnectionErrorDiagnosis {
  const facts = extractFacts(error, raw);
  const classified = classify(facts, ctx);
  const causeText = classified.causes.map((cause, index) => `${index + 1}）${cause}`).join('；');
  return {
    ...classified,
    raw,
    message: `${classified.reason}。可能情况：${causeText}。原始错误：${raw}`,
  };
}
