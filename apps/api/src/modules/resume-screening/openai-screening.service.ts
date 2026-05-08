import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

import { InterviewQaItem, ScreeningResult, CandidateProfile } from './resume-screening.types';

const SCREENING_SCHEMA_DESC =
  '{"ai_job": string, "score": integer 0-100, "decision": "recommend"|"hold"|"reject", ' +
  '"tags": [string, ...], "dimensions": {"job_match": {"score": integer 0-100, "label": string, "reason": string}, "experience": {"score": integer 0-100, "label": string, "reason": string}, "skills": {"score": integer 0-100, "label": string, "reason": string}, "stability": {"score": integer 0-100, "label": string, "reason": string}, "location": {"score": integer 0-100, "label": string, "reason": string}, "education": {"score": integer 0-100, "label": string, "reason": string}, "salary": {"score": integer 0-100, "label": string, "reason": string}}, ' +
  '"matched_points": [string, ...], "risks": [string, ...], "summary": string, "next_step": boolean, ' +
  '"interview_qa": [{"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}]}';

const FILE_PROFILE_EXTRACTION_SCHEMA_DESC =
  '{"is_relevant": boolean, "relevance_reason": string, ' +
  '"candidate_name": string, "candidate_gender": string, "candidate_birth_or_age": string, ' +
  '"candidate_education": string, "candidate_status": string, "candidate_city": string, ' +
  '"candidate_hukou": string, "candidate_target_job": string, "candidate_target_city": string, ' +
  '"candidate_salary_expectation": string, "candidate_recent_company": string, ' +
  '"candidate_recent_title": string, "candidate_years_experience": string, ' +
  '"candidate_work_summary": string, "candidate_resume_excerpt": string, "candidate_email": string, "candidate_phone": string, ' +
  '"language_skills": [string, ...]}';

const DIRECT_FILE_SCREENING_SCHEMA_DESC =
  '{"is_relevant": boolean, "relevance_reason": string, ' +
  '"candidate_name": string, "candidate_gender": string, "candidate_birth_or_age": string, ' +
  '"candidate_education": string, "candidate_status": string, "candidate_city": string, ' +
  '"candidate_hukou": string, "candidate_target_job": string, "candidate_target_city": string, ' +
  '"candidate_salary_expectation": string, "candidate_recent_company": string, ' +
  '"candidate_recent_title": string, "candidate_years_experience": string, ' +
  '"candidate_work_summary": string, "candidate_resume_excerpt": string, "candidate_email": string, "candidate_phone": string, ' +
  '"ai_job": string, "score": integer 0-100, "decision": "recommend"|"hold"|"reject", ' +
  '"tags": [string, ...], "dimensions": {"job_match": {"score": integer 0-100, "label": string, "reason": string}, "experience": {"score": integer 0-100, "label": string, "reason": string}, "skills": {"score": integer 0-100, "label": string, "reason": string}, "stability": {"score": integer 0-100, "label": string, "reason": string}, "location": {"score": integer 0-100, "label": string, "reason": string}, "education": {"score": integer 0-100, "label": string, "reason": string}, "salary": {"score": integer 0-100, "label": string, "reason": string}}, ' +
  '"matched_points": [string, ...], "risks": [string, ...], "summary": string, "next_step": boolean, ' +
  '"interview_qa": [{"question": string, "answer": string}, {"question": string, "answer": string}, ' +
  '{"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}]}';

const FILE_SCREENING_DOC_MODEL = 'qwen-doc-turbo';

const JOB_RULE_SCHEMA_DESC =
  '{"name": string, "jd_text": string}';

const INTERVIEW_QA_SCHEMA_DESC =
  '{"interview_qa": [{"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}, {"question": string, "answer": string}]}';

const CANDIDATE_DISCUSSION_SCHEMA_DESC =
  '{"answer": string, "suggested_tags": [string, ...], "recommended_action": string, "confidence": "high"|"medium"|"low", "profile_patch"?: {"name"?: string, "birth_or_age"?: string, "city"?: string, "education"?: string, "status"?: string, "target_job"?: string, "target_city"?: string, "salary_expectation"?: string, "recent_company"?: string, "recent_title"?: string, "years_experience"?: string, "work_summary"?: string, "email"?: string, "phone"?: string}, "screening_patch"?: {"score"?: number, "decision"?: "recommend"|"hold"|"reject", "tags"?: [string, ...], "matched_points"?: [string, ...], "risks"?: [string, ...], "summary"?: string, "next_step"?: boolean, "dimensions"?: object}, "update_reason"?: string}';

const CANDIDATE_FILTER_ITERATION_SCHEMA_DESC =
  '{"action": "filter"|"clarify", "answer": string, "clarification_question"?: string, "filter_summary": string, "criteria": [string, ...], "candidate_updates": [{"candidate_id": string, "ai_job"?: string, "score": integer 0-100, "decision": "recommend"|"hold"|"reject", "tags": [string, ...], "dimensions"?: object, "matched_points": [string, ...], "risks": [string, ...], "summary": string, "next_step": boolean, "change_reason": string}]}';

type CandidateFilterMessage = { role: 'user' | 'assistant'; content: string };

type CandidateFilterSnapshot = {
  candidate_id: string;
  job_rule_id?: string | null;
  job_rule_name?: string | null;
  name: string;
  city?: string | null;
  education?: string | null;
  age_or_birth?: string | null;
  target_job?: string | null;
  ai_job?: string | null;
  salary_expectation?: string | null;
  years_experience?: string | null;
  recent_company?: string | null;
  recent_title?: string | null;
  current_score?: number | null;
  current_decision?: string | null;
  current_summary?: string | null;
  current_tags?: string[];
  current_matched_points?: string[];
  current_risks?: string[];
  resume_excerpt?: string;
};

@Injectable()
export class OpenAiScreeningService {
  private readonly logger = new Logger(OpenAiScreeningService.name);
  private readonly envApiKey: string | null;
  private readonly envModel: string;
  private readonly envBaseUrl: string | null;
  private readonly envDashscopeApiKey: string | null;
  private readonly envDashscopeBaseUrl: string | null;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.envApiKey = this.configService.get<string>('OPENAI_API_KEY') ?? null;
    this.envModel = this.configService.get<string>('OPENAI_MODEL') ?? 'gpt-4.1-mini';
    this.envBaseUrl = this.normalizeBaseUrl(this.configService.get<string>('OPENAI_BASE_URL') ?? null);
    this.envDashscopeApiKey =
      this.configService.get<string>('DASHSCOPE_API_KEY') ??
      this.configService.get<string>('QWEN_API_KEY') ??
      null;
    this.envDashscopeBaseUrl = this.normalizeBaseUrl(
      this.configService.get<string>('DASHSCOPE_BASE_URL') ??
        this.configService.get<string>('QWEN_BASE_URL') ??
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    this.timeoutMs = Number(this.configService.get('OPENAI_TIMEOUT_MS') ?? 120000);
  }

  isConfigured(overrideApiKey?: string, provider?: string): boolean {
    return Boolean(this.resolveApiKey(provider, overrideApiKey));
  }

  async extractJobRuleDraft(
    rawJobText: string,
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);

    const payload = {
      raw_job_text: rawJobText.slice(0, 12000),
      task:
        'Extract the job title as name, and return the remaining job description content as jd_text. Remove duplicated title lines from jd_text. Return strict JSON only. Prefer Simplified Chinese when the source text is Chinese.',
    };

    const startedAt = Date.now();
    const { content: rawOutput, usage } = await this.callCompletionApi(
      client,
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You extract structured recruitment information. Infer the job title conservatively, keep jd_text faithful to the source, and return strict JSON only matching this schema: ${JOB_RULE_SCHEMA_DESC}. If the source text is Chinese, keep the extracted name and jd_text in Simplified Chinese.`,
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        jsonMode: true,
      },
      provider,
    );

    const parsed = JSON.parse(rawOutput || '{}') as { name: string; jd_text: string };
    return {
      result: parsed,
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage,
    };
  }

  async evaluateCandidate(
    profile: CandidateProfile,
    jdText: string,
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);

    const payload = {
      candidate_profile: profile,
      raw_email_excerpt: profile.raw_text.slice(0, 5000),
      job_description: jdText,
      task:
        'Evaluate the candidate against the job description. If candidate_profile fields are empty or missing, extract them from raw_email_excerpt. Return strict JSON only. Also infer the most appropriate target job title for this candidate under this JD and place it in ai_job. Provide 6-10 concise tags and dimension scores for job_match, experience, skills, stability, location, education, and salary. Generate exactly 5 interview questions tailored to this JD and resume, and provide a concise reference answer for each one based on the candidate background and likely best response strategy. If the resume or JD is Chinese, all text fields in the JSON must be written in Simplified Chinese.',
    };

    const baseUrl = this.resolveBaseUrl(provider, overrideBaseUrl);
    this.logger.log(
      `[evaluateCandidate] model=${model} baseUrl=${baseUrl ?? 'default'} candidate="${profile.name || profile.email}"`,
    );
    this.logger.debug(`[evaluateCandidate] request_payload=${JSON.stringify(payload).slice(0, 500)}`);

    const startedAt = Date.now();
    let rawOutput: string;
    let usage: ReturnType<typeof this.extractUsage>;
    try {
      ({ content: rawOutput, usage } = await this.callCompletionApi(
        client,
        {
          model,
          messages: [
            {
              role: 'system',
              content: `You are a conservative enterprise recruiting screener. First extract any missing candidate details (name, gender, education, experience, skills, etc.) from raw_email_excerpt if candidate_profile fields are empty. Then score the candidate strictly against the provided job description. Infer ai_job conservatively from the JD and candidate profile. Produce 6-10 short tags that HR can filter by, and score dimensions for job_match, experience, skills, stability, location, education, and salary with a short reason. Also generate exactly 5 interview questions tailored to this JD and candidate, and provide a concise reference answer for each one. Return strict JSON only matching this schema: ${SCREENING_SCHEMA_DESC}. When the source material is Chinese, every text field in the JSON must be in Simplified Chinese.`,
            },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          jsonMode: true,
        },
        provider,
      ));
    } catch (err) {
      this.logger.error(`[evaluateCandidate] API call failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    this.logger.log(`[evaluateCandidate] done in ${Date.now() - startedAt}ms, raw=${rawOutput.slice(0, 200)}`);
    const parsed = JSON.parse(rawOutput || '{}') as ScreeningResult;
    return {
      result: parsed,
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput, structured_output: parsed },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage,
    };
  }

  async generateInterviewQa(
    profile: CandidateProfile,
    jdText: string,
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const payload = {
      candidate_profile: profile,
      raw_resume_excerpt: profile.raw_text.slice(0, 5000),
      job_description: jdText,
      task:
        'Generate exactly 5 interview questions tailored to the candidate and job description, and provide a concise reference answer for each question. Answers should be grounded in the candidate resume details and should stay realistic rather than overclaiming. Return strict JSON only.',
    };

    const startedAt = Date.now();
    const { content: rawOutput, usage } = await this.callCompletionApi(
      client,
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You are an enterprise recruiting interviewer assistant. Based on the JD and candidate resume, generate exactly 5 interview questions and concise reference answers. Questions should probe fit, experience, risks, and job-specific ability. Answers must be realistic, resume-grounded, and in Simplified Chinese when the source text is Chinese. Return strict JSON only matching this schema: ${INTERVIEW_QA_SCHEMA_DESC}.`,
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        jsonMode: true,
      },
      provider,
    );
    const parsed = JSON.parse(rawOutput || '{}') as { interview_qa?: InterviewQaItem[] };

    return {
      result: {
        interview_qa: Array.isArray(parsed.interview_qa) ? parsed.interview_qa : [],
      },
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput, structured_output: parsed },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage,
    };
  }

  async discussCandidate(
    profile: CandidateProfile,
    jdText: string,
    screeningContext: unknown,
    question: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const payload = {
      candidate_profile: profile,
      raw_resume_excerpt: profile.raw_text.slice(0, 6000),
      job_description: jdText.slice(0, 12000),
      screening_context: screeningContext,
      conversation_history: history.slice(-8),
      question,
      task:
        'Answer the recruiter question about this candidate. Stay grounded in the resume, JD, and screening context. If the answer creates a concrete correction or reconsideration that should update the candidate detail, include only those changed fields in profile_patch and/or screening_patch. Do not include patches for speculation or unchanged data. Return strict JSON only.',
    };

    const startedAt = Date.now();
    const { content: rawOutput, usage } = await this.callCompletionApi(
      client,
      {
        model,
        messages: [
          {
            role: 'system',
            content: `You are an enterprise recruiting copilot. Discuss one candidate with the recruiter using only the provided resume, JD, screening result, tags, dimensions, and conversation history. Be concise, practical, and explicit about uncertainty. Return strict JSON matching this schema: ${CANDIDATE_DISCUSSION_SCHEMA_DESC}. Use Simplified Chinese when the recruiter question or source material is Chinese.`,
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        jsonMode: true,
      },
      provider,
    );
    const parsed = this.parseJsonObject<{
      answer?: string;
      suggested_tags?: string[];
      recommended_action?: string;
      confidence?: 'high' | 'medium' | 'low';
      profile_patch?: Record<string, unknown>;
      screening_patch?: Record<string, unknown>;
      update_reason?: string;
    }>(rawOutput || '{}');

    return {
      result: {
        answer: parsed.answer?.trim() || '暂时无法基于当前材料给出进一步判断。',
        suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags.filter((item) => typeof item === 'string') : [],
        recommended_action: parsed.recommended_action?.trim() || '',
        confidence: parsed.confidence ?? 'medium',
        profile_patch: parsed.profile_patch && typeof parsed.profile_patch === 'object' ? parsed.profile_patch : {},
        screening_patch: parsed.screening_patch && typeof parsed.screening_patch === 'object' ? parsed.screening_patch : {},
        update_reason: parsed.update_reason?.trim() || '',
      },
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput, structured_output: parsed },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage,
    };
  }

  async iterateCandidateFilter(
    jobContext: unknown,
    candidates: CandidateFilterSnapshot[],
    instruction: string,
    history: CandidateFilterMessage[] = [],
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const payload = {
      job_context: jobContext,
      candidates,
      conversation_history: history.slice(-10),
      recruiter_instruction: instruction,
      task:
        'Analyze the recruiter instruction first. If the instruction is not specific enough to change screening criteria, set action to clarify, provide one concise clarification question in answer/clarification_question, and leave candidate_updates empty. Only when the instruction contains enough concrete filtering or scoring criteria, set action to filter and re-evaluate the full candidate list. When filtering, return one candidate_updates item for every candidate_id provided. Do not drop candidates; mark filtered-out candidates as reject with clear reasons. Keep the output grounded in the resume/JD/current screening data. Return strict JSON only.',
    };

    const startedAt = Date.now();
    const { content: rawOutput, usage } = await this.callCompletionApi(
      client,
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              `You are an enterprise recruiting list-level filtering copilot. ` +
              `You help the recruiter iteratively clean a candidate pool after an initial JD screening. ` +
              `Do not treat every user message as a filtering command. First decide whether the recruiter has provided clear, actionable filtering criteria. ` +
              `If criteria are ambiguous, incomplete, or merely express dissatisfaction, ask a clarification question and do not score candidates. ` +
              `If criteria are clear, apply the latest instruction as a new filter/scoring lens across every provided candidate. ` +
              `Return strict JSON matching this schema: ${CANDIDATE_FILTER_ITERATION_SCHEMA_DESC}. ` +
              `Use Simplified Chinese for answer, summary, tags, risks, criteria, and change_reason.`,
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        jsonMode: true,
      },
      provider,
    );

    const parsed = this.parseJsonObject<{
      action?: string;
      answer?: string;
      clarification_question?: string;
      filter_summary?: string;
      criteria?: unknown[];
      candidate_updates?: unknown[];
    }>(rawOutput || '{}');

    const candidateUpdates = Array.isArray(parsed.candidate_updates)
      ? parsed.candidate_updates.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : [];

    return {
      result: {
        action:
          parsed.action === 'filter' || (parsed.action !== 'clarify' && candidateUpdates.length)
            ? 'filter'
            : 'clarify',
        answer:
          parsed.answer?.trim() ||
          parsed.clarification_question?.trim() ||
          '请再补充本轮筛选希望关注的具体条件，例如技能、地域、薪资、经验年限或需要放宽/收紧的规则。',
        clarification_question: parsed.clarification_question?.trim() || '',
        filter_summary: parsed.filter_summary?.trim() || '',
        criteria: Array.isArray(parsed.criteria)
          ? parsed.criteria.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean).slice(0, 12)
          : [],
        candidate_updates: candidateUpdates,
      },
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput, structured_output: parsed },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage,
    };
  }

  async screenResumeFromText(
    rawText: string,
    fileName: string,
    jdText: string,
    jobRuleName: string,
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);

    const payload = {
      job_rule_name: jobRuleName,
      job_description: jdText.slice(0, 3000),
      resume_file_name: fileName,
      resume_text: rawText.slice(0, 8000),
      task:
        'First determine if this resume is relevant to the job position (is_relevant). ' +
        'If relevant, extract the candidate profile fields and perform a full evaluation. ' +
        'If not relevant, set is_relevant to false and leave evaluation fields empty. ' +
        'Return strict JSON only. When source text is Chinese, use Simplified Chinese for all text fields. ' +
        'Generate 6-10 tags, dimension scores, and exactly 5 interview questions only when is_relevant is true.',
    };

    const baseUrl = this.resolveBaseUrl(provider, overrideBaseUrl);
    this.logger.log(
      `[screenResumeFromText] model=${model} baseUrl=${baseUrl ?? 'default'} file="${fileName}" jobRule="${jobRuleName}"`,
    );

    const startedAt = Date.now();
    let rawOutput: string;
    let usage: ReturnType<typeof this.extractUsage>;
    try {
      ({ content: rawOutput, usage } = await this.callCompletionApi(
        client,
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                `You are a professional HR recruiter. Analyze the resume and determine: ` +
                `1) Is the candidate relevant for the job position "${jobRuleName}"? ` +
                `2) If relevant, extract candidate details and evaluate against the job description. ` +
                `Set is_relevant to true only if the resume clearly relates to "${jobRuleName}". ` +
                `Return strict JSON only matching this schema: ${DIRECT_FILE_SCREENING_SCHEMA_DESC}. ` +
                `When the source material is Chinese, every text field must be in Simplified Chinese.`,
            },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          jsonMode: true,
        },
        provider,
      ));
    } catch (err) {
      this.logger.error(`[screenResumeFromText] API call failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    this.logger.log(`[screenResumeFromText] done in ${Date.now() - startedAt}ms, is_relevant=${rawOutput!.slice(0, 80)}`);

    const parsed = JSON.parse(rawOutput! || '{}') as {
      is_relevant?: boolean;
      relevance_reason?: string;
      candidate_name?: string;
      candidate_gender?: string;
      candidate_birth_or_age?: string;
      candidate_education?: string;
      candidate_status?: string;
      candidate_city?: string;
      candidate_hukou?: string;
      candidate_target_job?: string;
      candidate_target_city?: string;
      candidate_salary_expectation?: string;
      candidate_recent_company?: string;
      candidate_recent_title?: string;
      candidate_years_experience?: string;
      candidate_work_summary?: string;
      candidate_email?: string;
      candidate_phone?: string;
      ai_job?: string;
      score?: number;
      decision?: string;
      tags?: string[];
      dimensions?: ScreeningResult['dimensions'];
      matched_points?: string[];
      risks?: string[];
      summary?: string;
      next_step?: boolean;
      interview_qa?: InterviewQaItem[];
    };

    const isRelevant = Boolean(parsed.is_relevant);

    const candidateProfile: CandidateProfile = {
      name: parsed.candidate_name ?? '',
      gender: parsed.candidate_gender ?? '',
      birth_or_age: parsed.candidate_birth_or_age ?? '',
      education: parsed.candidate_education ?? '',
      status: parsed.candidate_status ?? '',
      city: parsed.candidate_city ?? '',
      hukou: parsed.candidate_hukou ?? '',
      target_job: parsed.candidate_target_job ?? '',
      target_city: parsed.candidate_target_city ?? '',
      salary_expectation: parsed.candidate_salary_expectation ?? '',
      recent_company: parsed.candidate_recent_company ?? '',
      recent_title: parsed.candidate_recent_title ?? '',
      years_experience: parsed.candidate_years_experience ?? '',
      work_summary: parsed.candidate_work_summary ?? '',
      email: parsed.candidate_email ?? '',
      phone: parsed.candidate_phone ?? '',
      raw_text: rawText,
      avatar_url: '',
      language_skills: [],
    };

      const screeningResult: ScreeningResult = {
        ai_job: parsed.ai_job ?? '',
        score: typeof parsed.score === 'number' ? parsed.score : 0,
        decision: (parsed.decision as ScreeningResult['decision']) ?? 'hold',
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((item): item is string => typeof item === 'string') : [],
        dimensions:
          parsed.dimensions && typeof parsed.dimensions === 'object' && !Array.isArray(parsed.dimensions)
            ? (parsed.dimensions as ScreeningResult['dimensions'])
            : {},
        matched_points: Array.isArray(parsed.matched_points) ? parsed.matched_points : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      summary: parsed.summary ?? '',
      next_step: Boolean(parsed.next_step),
      interview_qa: Array.isArray(parsed.interview_qa) ? parsed.interview_qa : [],
    };

    return {
      is_relevant: isRelevant,
      relevance_reason: parsed.relevance_reason ?? '',
      candidate_profile: candidateProfile,
      screening_result: screeningResult,
      requestPayload: payload,
      responsePayload: { raw_output: rawOutput!, structured_output: parsed },
      modelName: model,
      durationMs: Date.now() - startedAt,
      usage: usage!,
    };
  }

  async extractCandidateProfileFromFile(
    file: { buffer: Buffer; originalname: string; mimeType?: string | null },
    jdText: string,
    jobRuleName: string,
    overrideApiKey?: string,
    overrideBaseUrl?: string,
    provider?: string,
    overrideModel?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const baseUrl = this.resolveBaseUrl(provider, overrideBaseUrl);
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const model = overrideModel?.trim() || FILE_SCREENING_DOC_MODEL;
    const startedAt = Date.now();
    let uploadedFileId: string | null = null;

    this.logger.log(
      `[extractCandidateProfileFromFile] model=${model} baseUrl=${baseUrl ?? 'default'} file="${file.originalname}" jobRule="${jobRuleName}"`,
    );

    try {
      const uploadable = await toFile(file.buffer, file.originalname, {
        type: file.mimeType?.trim() || undefined,
      });
      const uploadedFile = await client.files.create({
        file: uploadable,
        purpose: 'file-extract' as OpenAI.FilePurpose,
      });
      uploadedFileId = uploadedFile.id;

      const response = await this.runDocumentProfileExtractionCompletionWithRetry(client, uploadedFile.id, {
        fileName: file.originalname,
        jobRuleName,
        jdText,
        model,
      });

      const rawOutput = response.choices[0].message.content ?? '{}';
      this.logger.log(`[extractCandidateProfileFromFile] done in ${Date.now() - startedAt}ms, raw=${rawOutput.slice(0, 120)}`);
      const parsed = this.parseJsonObject<{
        is_relevant?: boolean;
        relevance_reason?: string;
        candidate_name?: string;
        candidate_gender?: string;
        candidate_birth_or_age?: string;
        candidate_education?: string;
        candidate_status?: string;
        candidate_city?: string;
        candidate_hukou?: string;
        candidate_target_job?: string;
        candidate_target_city?: string;
        candidate_salary_expectation?: string;
        candidate_recent_company?: string;
        candidate_recent_title?: string;
        candidate_years_experience?: string;
        candidate_work_summary?: string;
        candidate_resume_excerpt?: string;
        candidate_email?: string;
        candidate_phone?: string;
        language_skills?: string[];
      }>(rawOutput);

      const isRelevant = Boolean(parsed.is_relevant);
      const resumeExcerpt = this.buildResumeExcerpt(parsed, file.originalname);

      const candidateProfile: CandidateProfile = {
        name: parsed.candidate_name ?? '',
        gender: parsed.candidate_gender ?? '',
        birth_or_age: parsed.candidate_birth_or_age ?? '',
        education: parsed.candidate_education ?? '',
        status: parsed.candidate_status ?? '',
        city: parsed.candidate_city ?? '',
        hukou: parsed.candidate_hukou ?? '',
        target_job: parsed.candidate_target_job ?? '',
        target_city: parsed.candidate_target_city ?? '',
        salary_expectation: parsed.candidate_salary_expectation ?? '',
        recent_company: parsed.candidate_recent_company ?? '',
        recent_title: parsed.candidate_recent_title ?? '',
        years_experience: parsed.candidate_years_experience ?? '',
        work_summary: parsed.candidate_work_summary ?? '',
        email: parsed.candidate_email ?? '',
        phone: parsed.candidate_phone ?? '',
        raw_text: resumeExcerpt,
        avatar_url: '',
        language_skills: Array.isArray(parsed.language_skills) ? parsed.language_skills : [],
      };

      return {
        is_relevant: isRelevant,
        relevance_reason: parsed.relevance_reason ?? '',
        candidate_profile: candidateProfile,
        requestPayload: {
          job_rule_name: jobRuleName,
          job_description: jdText.slice(0, 3000),
          resume_file_name: file.originalname,
          uploaded_file_id: uploadedFile.id,
          task: 'Use the uploaded resume file directly to determine relevance and extract a structured candidate profile only.',
        },
        responsePayload: { raw_output: rawOutput, structured_output: parsed, uploaded_file_id: uploadedFile.id },
        modelName: model,
        durationMs: Date.now() - startedAt,
        usage: this.extractUsage(response),
      };
    } finally {
      if (uploadedFileId) {
        void client.files.delete(uploadedFileId).catch(() => undefined);
      }
    }
  }

  async testConnection(
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error(this.isQwenProvider(provider) ? 'DASHSCOPE_API_KEY is not configured.' : 'OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? this.envModel;
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const startedAt = Date.now();

    const { content, usage } = await this.callCompletionApi(
      client,
      {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
        maxTokens: 16,
      },
      provider,
    );

    return {
      modelName: model,
      baseUrl: this.resolveBaseUrl(provider, overrideBaseUrl),
      durationMs: Date.now() - startedAt,
      outputText: content,
      usage,
    };
  }

  async testImageConnection(
    overrideApiKey?: string,
    overrideModel?: string,
    overrideBaseUrl?: string,
    provider?: string,
  ) {
    const apiKey = this.resolveApiKey(provider, overrideApiKey);
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    const model = overrideModel ?? 'gpt-image-1';
    const client = this.createClient(apiKey, overrideBaseUrl, provider);
    const startedAt = Date.now();
    const response = await client.images.generate({
      model,
      prompt: 'Connection test image: a simple blue dot on a white background.',
    } as OpenAI.Images.ImageGenerateParamsNonStreaming);
    const image = response.data?.[0];
    if (!image?.b64_json && !image?.url) {
      throw new Error('Images API did not return image data.');
    }

    return {
      modelName: model,
      baseUrl: this.resolveBaseUrl(provider, overrideBaseUrl),
      durationMs: Date.now() - startedAt,
      outputText: `Images API OK (${image.b64_json ? 'base64' : 'url'})`,
      usage: this.extractUsage(response),
    };
  }

  /**
   * Unified completion call.
   * - Responses API: OpenAI models + Qwen text models (e.g. qwen3.6-plus)
   * - Chat Completions API: Qwen doc models (e.g. qwen-doc-turbo) that don't support Responses API
   */
  private async callCompletionApi(
    client: OpenAI,
    params: {
      model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      jsonMode?: boolean;
      maxTokens?: number;
    },
    provider?: string,
  ): Promise<{ content: string; usage: ReturnType<typeof this.extractUsage> }> {
    // qwen-doc-turbo and similar doc models only support Chat Completions
    if (this.isQwenProvider(provider) && this.isDocModel(params.model)) {
      const chatParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: params.model,
        messages: params.messages,
        ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(params.maxTokens ? { max_completion_tokens: params.maxTokens } : {}),
      };
      const response = await client.chat.completions.create(chatParams);
      return {
        content: response.choices[0].message.content ?? '',
        usage: this.extractUsage(response),
      };
    }

    // OpenAI + Qwen text models (qwen3.6-plus, etc.) → Responses API
    const responseParams: Record<string, unknown> = {
      model: params.model,
      input: params.messages,
      ...(params.jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
      ...(params.maxTokens ? { max_output_tokens: params.maxTokens } : {}),
      // Disable thinking mode for Qwen3 models on structured JSON tasks
      ...(this.isQwenProvider(provider) ? { enable_thinking: false } : {}),
    };
    const response = await (client.responses as unknown as {
      create: (p: Record<string, unknown>) => Promise<{ output_text: string; usage: unknown }>;
    }).create(responseParams);
    return {
      content: response.output_text ?? '',
      usage: this.extractUsage(response as Parameters<typeof this.extractUsage>[0]),
    };
  }

  private createClient(apiKey: string, overrideBaseUrl?: string, provider?: string) {
    const baseURL = this.resolveBaseUrl(provider, overrideBaseUrl);
    // 代理仅对 OpenAI 生效，Qwen/阿里云等国内服务不走代理
    const fetch = this.isQwenProvider(provider) ? undefined : this.buildProxyFetch();

    return new OpenAI({
      apiKey,
      timeout: this.timeoutMs,
      ...(baseURL ? { baseURL } : {}),
      ...(fetch ? { fetch } : {}),
    });
  }

  private resolveApiKey(provider?: string, overrideApiKey?: string) {
    if (overrideApiKey) {
      return overrideApiKey;
    }

    if (this.isQwenProvider(provider)) {
      return this.envDashscopeApiKey ?? this.envApiKey;
    }

    return this.envApiKey;
  }

  private resolveBaseUrl(provider?: string, overrideBaseUrl?: string | null) {
    const normalizedOverride = this.normalizeBaseUrl(overrideBaseUrl);
    if (normalizedOverride) {
      return normalizedOverride;
    }

    if (this.isQwenProvider(provider)) {
      return this.envDashscopeBaseUrl;
    }

    return this.envBaseUrl;
  }

  private buildProxyFetch() {
    const proxyUrl =
      this.configService.get<string>('HTTPS_PROXY') ??
      this.configService.get<string>('https_proxy') ??
      this.configService.get<string>('HTTP_PROXY') ??
      this.configService.get<string>('http_proxy') ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy;

    if (!proxyUrl?.trim()) {
      return undefined;
    }

    try {
      const undici = require('undici') as {
        ProxyAgent?: new (uri: string) => unknown;
        fetch?: (input: unknown, init?: Record<string, unknown>) => Promise<unknown>;
      };

      if (!undici.ProxyAgent || !undici.fetch) {
        return undefined;
      }

      const dispatcher = new undici.ProxyAgent(proxyUrl.trim());
      const noProxyList = (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      return ((input: unknown, init?: Record<string, unknown>) => {
        const target = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        const hostname = target ? new URL(target).hostname.toLowerCase() : '';
        const shouldBypassProxy =
          hostname &&
          noProxyList.some((item) => hostname === item || hostname.endsWith(`.${item.replace(/^\./, '')}`));

        if (shouldBypassProxy) {
          return fetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
        }

        return undici.fetch!(input, { ...(init ?? {}), dispatcher }) as Promise<Response>;
      }) as typeof fetch;
    } catch {
      return undefined;
    }
  }

  private normalizeBaseUrl(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed.replace(/\/$/, '') : null;
  }

  private isDocModel(model: string) {
    return /doc/i.test(model);
  }

  private isQwenProvider(provider?: string | null) {
    const normalized = provider?.trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    return (
      ['qwen', 'tongyi', 'dashscope', 'aliyun'].some((item) => normalized.includes(item)) ||
      normalized.includes('千问') ||
      normalized.includes('通义')
    );
  }

  private extractUsage(response: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number } }) {
    return {
      inputTokens: response.usage?.prompt_tokens ?? response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    };
  }

  private async runDocumentProfileExtractionCompletionWithRetry(
    client: OpenAI,
    uploadedFileId: string,
    input: { fileName: string; jobRuleName: string; jdText: string; model: string },
  ) {
    const maxAttempts = 6;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await client.chat.completions.create({
          model: input.model,
          messages: [
            {
              role: 'system',
              content:
                `You are a professional HR recruiter. Read the uploaded resume file directly and determine: ` +
                `1) whether the candidate is relevant to the job position "${input.jobRuleName}", ` +
                `2) if relevant, extract the candidate profile fields only. ` +
                `Do not score, rank, or decide recommend/hold/reject in this step. ` +
                `Return strict JSON only matching this schema: ${FILE_PROFILE_EXTRACTION_SCHEMA_DESC}. ` +
                `Use Simplified Chinese for all text fields when the source material is Chinese. ` +
                `The field candidate_resume_excerpt should contain a concise but information-rich resume summary for later UI display.`,
            },
            {
              role: 'system',
              content: `fileid://${uploadedFileId}`,
            },
            {
              role: 'user',
              content: JSON.stringify({
                job_rule_name: input.jobRuleName,
                job_description: input.jdText.slice(0, 3000),
                resume_file_name: input.fileName,
                task:
                  'Directly read the uploaded file. Set is_relevant to true only if the resume clearly matches the target position. If not relevant, keep extraction fields as empty strings when uncertain.',
              }),
            },
          ],
        });
      } catch (error) {
        lastError = error;
        if (!this.isDashscopeFileProcessingError(error) || attempt === maxAttempts) {
          throw error;
        }
        await this.sleep(1500 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Document screening failed.');
  }

  private buildResumeExcerpt(
    parsed: {
      candidate_resume_excerpt?: string;
      candidate_name?: string;
      candidate_target_job?: string;
      candidate_target_city?: string;
      candidate_recent_company?: string;
      candidate_recent_title?: string;
      candidate_years_experience?: string;
      candidate_work_summary?: string;
    },
    fileName: string,
  ) {
    const explicitExcerpt = parsed.candidate_resume_excerpt?.trim();
    if (explicitExcerpt) {
      return explicitExcerpt;
    }

    return [
      `文件名：${fileName}`,
      parsed.candidate_name ? `姓名：${parsed.candidate_name}` : '',
      parsed.candidate_target_job ? `目标岗位：${parsed.candidate_target_job}` : '',
      parsed.candidate_target_city ? `目标城市：${parsed.candidate_target_city}` : '',
      parsed.candidate_recent_company ? `最近公司：${parsed.candidate_recent_company}` : '',
      parsed.candidate_recent_title ? `最近职位：${parsed.candidate_recent_title}` : '',
      parsed.candidate_years_experience ? `工作年限：${parsed.candidate_years_experience}` : '',
      parsed.candidate_work_summary ? `工作概述：${parsed.candidate_work_summary}` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private parseJsonObject<T>(rawOutput: string) {
    const trimmed = rawOutput.trim();
    const normalized = trimmed
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(normalized) as T;
  }

  private isDashscopeFileProcessingError(error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : '';

    return /file.*processing|parsing in progress|尚在解析|解析中/i.test(message);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
