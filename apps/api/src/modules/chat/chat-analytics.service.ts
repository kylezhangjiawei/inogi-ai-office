import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateUsageEventDto } from './dto/create-usage-event.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const ALLOWED_DAYS = new Set([7, 30, 90]);

const FEEDBACK_REASON_LABELS: Record<string, string> = {
  inaccurate: '回答不准确',
  unresolved: '没有解决问题',
  outdated: '数据不完整或过期',
  misunderstood: '没有理解问题',
  slow: '响应太慢',
  inconvenient: '操作不方便',
  other: '其他',
};

const SCENARIOS = [
  { key: 'file', label: '文件与表格处理', pattern: /文件|附件|上传|下载|导出|excel|word|表格|图片|pdf/i },
  { key: 'writing', label: '写作与沟通', pattern: /起草|撰写|写一|邮件|回复|通知|文案|翻译|润色|措辞/i },
  { key: 'task', label: '任务与项目管理', pattern: /任务|待办|项目|进度|风险|计划|里程碑|排期|优先级|负责人/i },
  { key: 'data', label: '业务数据查询', pattern: /多少|查询|名单|状态|数据|统计|分布|有哪些|是谁|截止|当前/i },
  { key: 'document', label: '总结与文档分析', pattern: /总结|整理|摘要|提炼|归纳|报告|文档|合同|审查|模板|分析/i },
  { key: 'knowledge', label: '知识与流程问答', pattern: /什么|如何|怎么|规范|流程|制度|资料|知识库|原因|说明/i },
] as const;

const OTHER_SCENARIO = { key: 'other', label: '其他办公问答' } as const;

type EventMetadata = Record<string, string | number | boolean | null>;

type PersonProfile = {
  userId: string;
  name: string;
  department: string;
  role: string;
  position: string;
};

// 部门以用户自己配置的 User.department 为准；未配置的统一归入「其他」，
// 而不是被排除出人员名单。
const OTHER_DEPARTMENT = '其他';

@Injectable()
export class ChatAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  classifyQuestion(content: string, hasAttachments: boolean) {
    return this.classifyScenario(content, hasAttachments);
  }

  async recordClientEvent(userId: string, dto: CreateUsageEventDto) {
    const metadata = this.sanitizeMetadata(dto.metadata);
    if (dto.eventType === 'chat_open') {
      const event = await this.prisma.chatUsageEvent.create({
        data: {
          userId,
          eventType: dto.eventType,
          metadata: metadata as Prisma.InputJsonValue,
        },
        select: { id: true, createdAt: true },
      });
      return { ok: true, ...event };
    }

    if (!dto.messageId) throw new BadRequestException('该操作缺少消息标识');
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: dto.messageId },
      select: {
        id: true,
        role: true,
        conversationId: true,
        model: true,
        conversation: { select: { userId: true } },
      },
    });
    if (!message || message.role !== 'assistant' || message.conversation.userId !== userId) {
      throw new NotFoundException('可操作的 AI 回答不存在');
    }

    const event = await this.prisma.chatUsageEvent.create({
      data: {
        userId,
        eventType: dto.eventType,
        // Never trust identifiers/model labels supplied by the browser. The
        // authoritative values come from the owned assistant message.
        conversationId: message.conversationId,
        messageId: message.id,
        model: message.model,
        metadata: metadata as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });
    return { ok: true, ...event };
  }

  recordSystemEvent(input: {
    userId: string;
    eventType: 'answer_completed' | 'answer_failed';
    conversationId: string;
    messageId?: string;
    model?: string;
    metadata?: EventMetadata;
  }) {
    return this.prisma.chatUsageEvent.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        conversationId: input.conversationId,
        messageId: input.messageId,
        model: input.model,
        metadata: this.sanitizeMetadata(input.metadata) as Prisma.InputJsonValue,
      },
    });
  }

  async updateFeedbackStatus(id: string, dto: UpdateFeedbackStatusDto) {
    const existing = await this.prisma.chatFeedback.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('反馈记录不存在');
    if (existing.reaction === 'like' && dto.status !== 'resolved') {
      throw new BadRequestException('点赞是正向质量信号，不进入问题处理流程');
    }
    const resolved = dto.status === 'resolved' || dto.status === 'ignored';
    const resolutionNote = dto.resolutionNote?.trim() ?? existing.resolutionNote;
    if (resolved && !resolutionNote) {
      throw new BadRequestException('解决或忽略反馈时必须填写处理结论');
    }
    return this.prisma.chatFeedback.update({
      where: { id },
      data: {
        status: dto.status,
        resolutionNote,
        resolvedAt: resolved ? new Date() : null,
      },
      select: { id: true, status: true, resolutionNote: true, resolvedAt: true, updatedAt: true },
    });
  }

  async getDashboard(daysInput?: number) {
    const days = Number.isFinite(daysInput) && ALLOWED_DAYS.has(Number(daysInput)) ? Number(daysInput) : 30;
    const start = this.chinaDayStart(days);
    const previousStart = new Date(start.getTime() - days * DAY_MS);

    const [
      messages,
      events,
      eligibleDirectoryUsers,
      previousMessages,
      previousQuestionEvents,
      trackingRange,
      feedbackStatusGroups,
      answerTrackingRange,
      questionTrackingRange,
    ] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: {
          role: { in: ['user', 'assistant'] },
          OR: [
            { createdAt: { gte: start } },
            {
              role: 'assistant',
              feedback: { isNot: null },
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          conversationId: true,
          role: true,
          content: true,
          model: true,
          reaction: true,
          attachments: true,
          createdAt: true,
          feedback: {
            select: {
              id: true,
              reaction: true,
              reasons: true,
              comment: true,
              status: true,
              resolutionNote: true,
              submittedAt: true,
              resolvedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          conversation: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  department: true,
                  role: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.chatUsageEvent.findMany({
        where: { createdAt: { gte: start } },
        orderBy: { createdAt: 'asc' },
        select: {
          eventType: true,
          userId: true,
          conversationId: true,
          messageId: true,
          model: true,
          metadata: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              department: true,
              role: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          department: true,
          role: { select: { name: true, permissions: true } },
        },
      }),
      this.prisma.chatMessage.findMany({
        where: {
          role: 'user',
          createdAt: { gte: previousStart, lt: start },
        },
        select: {
          id: true,
          conversationId: true,
          createdAt: true,
          conversation: {
            select: {
              userId: true,
              user: {
                select: {
                  name: true,
                  department: true,
                  role: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.chatUsageEvent.findMany({
        where: {
          eventType: 'question_submitted',
          createdAt: { gte: previousStart, lt: start },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          conversationId: true,
          messageId: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              department: true,
              role: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.chatUsageEvent.aggregate({ _min: { createdAt: true }, _max: { createdAt: true } }),
      this.prisma.chatFeedback.groupBy({
        by: ['status'],
        where: { reaction: 'dislike' },
        _count: { _all: true },
      }),
      this.prisma.chatUsageEvent.aggregate({
        where: { eventType: 'answer_completed' },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.prisma.chatUsageEvent.aggregate({
        where: { eventType: 'question_submitted' },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
    ]);

    const periodMessages = messages.filter((message) => message.createdAt >= start);
    const userMessages = periodMessages.filter((message) => message.role === 'user');
    const assistantMessages = periodMessages.filter((message) => message.role === 'assistant');
    const feedbackMessages = messages.filter(
      (message) => message.role === 'assistant' && message.feedback && message.feedback.submittedAt >= start,
    );
    const managementFeedbackMessages = messages.filter(
      (message) => message.role === 'assistant' && message.feedback,
    );
    const answeredFeedbackMessages = assistantMessages.filter((message) => message.feedback);
    const positiveFeedback = feedbackMessages.filter((message) => message.feedback?.reaction === 'like').length;
    const negativeFeedback = feedbackMessages.filter((message) => message.feedback?.reaction === 'dislike').length;

    // New questions have an immutable server event written in the same
    // transaction as ChatMessage. For the pre-instrumentation window (or a rare
    // missing event), fall back to the live message. This avoids double counting
    // while keeping aggregate adoption metrics stable after a user deletes chat content.
    const userMessageById = new Map(userMessages.map((message) => [message.id, message]));
    const questionEventByMessageId = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (event.eventType !== 'question_submitted' || !event.messageId) continue;
      if (!questionEventByMessageId.has(event.messageId)) questionEventByMessageId.set(event.messageId, event);
    }
    const questionObservations = [
      ...[...questionEventByMessageId.values()].map((event) => {
        const liveMessage = event.messageId ? userMessageById.get(event.messageId) : undefined;
        const hasAttachments = liveMessage
          ? liveMessage.attachments != null
          : this.booleanFromMetadata(event.metadata, 'hadAttachments');
        const classified = liveMessage
          ? this.classifyScenario(liveMessage.content, hasAttachments)
          : {
              key: this.stringFromMetadata(event.metadata, 'scenarioKey') ?? OTHER_SCENARIO.key,
              label: this.stringFromMetadata(event.metadata, 'scenarioLabel') ?? OTHER_SCENARIO.label,
            };
        return {
          id: event.messageId ?? event.createdAt.toISOString(),
          conversationId: event.conversationId ?? '',
          userId: event.userId,
          user: event.user,
          content: liveMessage?.content ?? '',
          hasAttachments,
          scenario: classified,
          createdAt: event.createdAt,
        };
      }),
      ...userMessages
        .filter((message) => !questionEventByMessageId.has(message.id))
        .map((message) => ({
          id: message.id,
          conversationId: message.conversationId,
          userId: message.conversation.userId,
          user: message.conversation.user,
          content: message.content,
          hasAttachments: message.attachments != null,
          scenario: this.classifyScenario(message.content, message.attachments != null),
          createdAt: message.createdAt,
        })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Management views must use the organization directory, rather than a
    // nullable department snapshot attached to an old chat message. rd.people
    // is the most specific source for bound employees; User is the company-wide
    // fallback for everyone else.
    const previousEventMessageIds = new Set(
      previousQuestionEvents.map((event) => event.messageId).filter((id): id is string => Boolean(id)),
    );
    const previousQuestionObservations = [
      ...previousQuestionEvents.map((event) => {
        return {
          userId: event.userId,
          user: event.user,
          createdAt: event.createdAt,
        };
      }),
      ...previousMessages
        .filter((message) => !previousEventMessageIds.has(message.id))
        .map((message) => ({
          userId: message.conversation.userId,
          user: message.conversation.user,
          createdAt: message.createdAt,
        })),
    ];

    const personDirectory = await this.loadPersonDirectory([
      ...new Set([
        ...eligibleDirectoryUsers.map((user) => user.id),
        ...questionObservations.map((observation) => observation.userId),
        ...previousQuestionObservations.map((observation) => observation.userId),
        ...messages.map((message) => message.conversation.userId),
        ...events.map((event) => event.userId),
      ]),
    ]);
    const resolvePerson = (
      userId: string,
      fallback: { name: string; department: string | null; role: { name: string } | null },
    ) => personDirectory.get(userId) ?? this.fallbackPersonProfile(userId, fallback);
    // 所有在用账号都纳入名单；部门取自 User.department 配置，未配置者归「其他」。
    const eligiblePeople = eligibleDirectoryUsers
      .map((user) => ({
        user,
        profile: personDirectory.get(user.id) ?? this.fallbackPersonProfile(user.id, user),
      }));
    const eligibleUserIds = new Set(eligiblePeople.map(({ user }) => user.id));

    const activeUserIds = new Set(questionObservations.map((observation) => observation.userId));
    const reportingActiveUserIds = new Set([...activeUserIds].filter((userId) => eligibleUserIds.has(userId)));
    const activeConversationIds = new Set(
      questionObservations.map((observation) => observation.conversationId).filter(Boolean),
    );
    const userDays = new Map<string, Set<string>>();
    for (const observation of questionObservations) {
      const userId = observation.userId;
      const set = userDays.get(userId) ?? new Set<string>();
      set.add(this.dateKey(observation.createdAt));
      userDays.set(userId, set);
    }
    const repeatUsers = [...userDays.entries()]
      .filter(([userId, dates]) => eligibleUserIds.has(userId) && dates.size >= 2)
      .length;
    const previousUserDays = new Map<string, Set<string>>();
    for (const observation of previousQuestionObservations) {
      const dates = previousUserDays.get(observation.userId) ?? new Set<string>();
      dates.add(this.dateKey(observation.createdAt));
      previousUserDays.set(observation.userId, dates);
    }
    const previousActiveUserIds = new Set(previousQuestionObservations.map((row) => row.userId));
    const reportingPreviousActiveUserIds = new Set(
      [...previousActiveUserIds].filter((userId) => eligibleUserIds.has(userId)),
    );
    const previousRepeatUsers = [...previousUserDays.entries()]
      .filter(([userId, dates]) => eligibleUserIds.has(userId) && dates.size >= 2)
      .length;

    const firstUseConversations = activeUserIds.size > 0
      ? await this.prisma.chatConversation.findMany({
          where: {
            userId: { in: [...activeUserIds] },
            messages: { some: { role: 'user' } },
          },
          select: {
            userId: true,
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        })
      : [];
    const firstUseByUser = new Map<string, Date>();
    for (const conversation of firstUseConversations) {
      const createdAt = conversation.messages[0]?.createdAt;
      if (!createdAt) continue;
      const existing = firstUseByUser.get(conversation.userId);
      if (!existing || createdAt < existing) firstUseByUser.set(conversation.userId, createdAt);
    }

    const completedEvents = events.filter((event) => event.eventType === 'answer_completed');
    const failedEvents = events.filter((event) => event.eventType === 'answer_failed');
    const latencies = completedEvents
      .map((event) => this.numberFromMetadata(event.metadata, 'latencyMs'))
      .filter((value): value is number => value !== null && value >= 0);
    const avgResponseMs = latencies.length > 0
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null;
    const p50ResponseMs = this.percentile(latencies, 50);
    const p95ResponseMs = this.percentile(latencies, 95);

    const actionCount = (type: string) => events.filter((event) => event.eventType === type).length;
    const rate = (numerator: number, denominator: number) =>
      denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
    const openUserIds = new Set(
      events.filter((event) => event.eventType === 'chat_open').map((event) => event.userId),
    );
    const openedAndAskedUsers = [...openUserIds].filter((userId) => activeUserIds.has(userId)).length;

    const trendMap = new Map<string, {
      date: string;
      activeUsers: Set<string>;
      questions: number;
      answers: number;
      feedback: number;
    }>();
    for (let index = 0; index < days; index += 1) {
      const date = new Date(start.getTime() + index * DAY_MS);
      const key = this.dateKey(date);
      trendMap.set(key, { date: key, activeUsers: new Set(), questions: 0, answers: 0, feedback: 0 });
    }
    for (const observation of questionObservations) {
      const row = trendMap.get(this.dateKey(observation.createdAt));
      if (!row) continue;
      row.questions += 1;
      row.activeUsers.add(observation.userId);
    }
    for (const message of assistantMessages) {
      const row = trendMap.get(this.dateKey(message.createdAt));
      if (row) row.answers += 1;
    }
    for (const message of feedbackMessages) {
      const submittedAt = message.feedback?.submittedAt;
      if (!submittedAt) continue;
      const row = trendMap.get(this.dateKey(submittedAt));
      if (row) row.feedback += 1;
    }

    const departmentMap = new Map<string, {
      department: string;
      activeUsers: Set<string>;
      conversations: Set<string>;
      questions: number;
      positive: number;
      negative: number;
    }>();
    for (const observation of questionObservations) {
      const department = resolvePerson(observation.userId, observation.user).department;
      const row = departmentMap.get(department) ?? {
        department,
        activeUsers: new Set<string>(),
        conversations: new Set<string>(),
        questions: 0,
        positive: 0,
        negative: 0,
      };
      row.questions += 1;
      row.activeUsers.add(observation.userId);
      if (observation.conversationId) row.conversations.add(observation.conversationId);
      departmentMap.set(department, row);
    }
    const eligibleDepartmentCounts = new Map<string, number>();
    for (const { profile } of eligiblePeople) {
      eligibleDepartmentCounts.set(profile.department, (eligibleDepartmentCounts.get(profile.department) ?? 0) + 1);
      if (!departmentMap.has(profile.department)) {
        departmentMap.set(profile.department, {
          department: profile.department,
          activeUsers: new Set<string>(),
          conversations: new Set<string>(),
          questions: 0,
          positive: 0,
          negative: 0,
        });
      }
    }
    const previousDepartmentUsers = new Map<string, Set<string>>();
    for (const observation of previousQuestionObservations) {
      const department = resolvePerson(observation.userId, observation.user).department;
      const users = previousDepartmentUsers.get(department) ?? new Set<string>();
      users.add(observation.userId);
      previousDepartmentUsers.set(department, users);
    }
    for (const message of feedbackMessages) {
      const department = resolvePerson(message.conversation.userId, message.conversation.user).department;
      const row = departmentMap.get(department) ?? {
        department,
        activeUsers: new Set<string>(),
        conversations: new Set<string>(),
        questions: 0,
        positive: 0,
        negative: 0,
      };
      if (message.feedback?.reaction === 'like') row.positive += 1;
      if (message.feedback?.reaction === 'dislike') row.negative += 1;
      departmentMap.set(department, row);
    }

    const reasonMap = new Map<string, number>();
    for (const message of feedbackMessages) {
      for (const reason of message.feedback?.reasons ?? []) {
        reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
      }
    }

    const scenarioMap = new Map<string, {
      key: string;
      label: string;
      questions: number;
      users: Set<string>;
      examples: string[];
    }>();
    for (const observation of questionObservations) {
      const scenario = observation.scenario;
      const row = scenarioMap.get(scenario.key) ?? {
        ...scenario,
        questions: 0,
        users: new Set<string>(),
        examples: [],
      };
      row.questions += 1;
      row.users.add(observation.userId);
      const example = this.excerpt(observation.content, 90);
      if (example && row.examples.length < 3 && !row.examples.includes(example)) row.examples.push(example);
      scenarioMap.set(scenario.key, row);
    }

    const userMap = new Map<string, {
      userId: string;
      name: string;
      department: string;
      role: string;
      questions: number;
      conversations: Set<string>;
      activeDays: Set<string>;
      lastActiveAt: Date;
      feedbackCount: number;
      positive: number;
      negative: number;
      scenarioCounts: Map<string, number>;
    }>();
    for (const observation of questionObservations) {
      const userId = observation.userId;
      const person = resolvePerson(userId, observation.user);
      const row = userMap.get(userId) ?? {
        userId,
        name: person.name,
        department: person.department,
        role: person.position || person.role,
        questions: 0,
        conversations: new Set<string>(),
        activeDays: new Set<string>(),
        lastActiveAt: observation.createdAt,
        feedbackCount: 0,
        positive: 0,
        negative: 0,
        scenarioCounts: new Map<string, number>(),
      };
      row.questions += 1;
      if (observation.conversationId) row.conversations.add(observation.conversationId);
      row.activeDays.add(this.dateKey(observation.createdAt));
      if (observation.createdAt > row.lastActiveAt) row.lastActiveAt = observation.createdAt;
      const scenario = observation.scenario;
      row.scenarioCounts.set(scenario.label, (row.scenarioCounts.get(scenario.label) ?? 0) + 1);
      userMap.set(userId, row);
    }
    for (const message of feedbackMessages) {
      if (!message.feedback) continue;
      const row = userMap.get(message.conversation.userId);
      if (!row) continue;
      row.feedbackCount += 1;
      if (message.feedback.reaction === 'like') row.positive += 1;
      if (message.feedback.reaction === 'dislike') row.negative += 1;
    }
    const activeUserAdoption = [...userMap.values()]
      .filter((row) => eligibleUserIds.has(row.userId))
      .map((row) => {
        const primaryScenario = [...row.scenarioCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
        const firstUsedAt = firstUseByUser.get(row.userId) ?? row.lastActiveAt;
        return {
          userId: row.userId,
          name: row.name,
          department: row.department,
          role: row.role,
          questions: row.questions,
          conversations: row.conversations.size,
          activeDays: row.activeDays.size,
          lastActiveAt: row.lastActiveAt,
          firstUsedAt,
          isNew: firstUsedAt >= start,
          usageLevel: row.questions >= 5 ? 'frequent' : row.questions >= 2 ? 'light' : 'one_time',
          primaryScenario,
          feedbackCount: row.feedbackCount,
          helpfulRate: rate(row.positive, row.positive + row.negative),
        };
      });
    const activeAdoptionByUserId = new Map(activeUserAdoption.map((row) => [row.userId, row]));
    const inactiveUserAdoption = eligiblePeople
      .filter(({ user }) => !activeAdoptionByUserId.has(user.id))
      .map(({ user, profile }) => {
        return {
          userId: user.id,
          name: profile.name,
          department: profile.department,
          role: profile.position || profile.role,
          questions: 0,
          conversations: 0,
          activeDays: 0,
          lastActiveAt: null,
          firstUsedAt: null,
          isNew: false,
          usageLevel: 'not_used' as const,
          primaryScenario: '尚未使用',
          feedbackCount: 0,
          helpfulRate: 0,
        };
      });
    const userAdoption = [...activeUserAdoption, ...inactiveUserAdoption]
      .sort((a, b) => b.questions - a.questions ||
        (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0));

    const adoptionSegments = [
      { key: 'not_used', label: '尚未使用', users: userAdoption.filter((row) => row.usageLevel === 'not_used').length },
      { key: 'one_time', label: '仅使用 1 次', users: userAdoption.filter((row) => row.usageLevel === 'one_time').length },
      { key: 'light', label: '轻度使用（2–4 问）', users: userAdoption.filter((row) => row.usageLevel === 'light').length },
      { key: 'frequent', label: '高频使用（≥5 问）', users: userAdoption.filter((row) => row.usageLevel === 'frequent').length },
    ];

    const modelMap = new Map<string, {
      model: string;
      answers: number;
      positive: number;
      negative: number;
      completed: number;
      failed: number;
      latencies: number[];
    }>();
    for (const message of assistantMessages) {
      const model = message.model || '未记录模型';
      const row = modelMap.get(model) ?? { model, answers: 0, positive: 0, negative: 0, completed: 0, failed: 0, latencies: [] };
      row.answers += 1;
      modelMap.set(model, row);
    }
    for (const message of feedbackMessages) {
      const model = message.model || '未记录模型';
      const row = modelMap.get(model) ?? { model, answers: 0, positive: 0, negative: 0, completed: 0, failed: 0, latencies: [] };
      if (message.feedback?.reaction === 'like') row.positive += 1;
      if (message.feedback?.reaction === 'dislike') row.negative += 1;
      modelMap.set(model, row);
    }
    for (const event of [...completedEvents, ...failedEvents]) {
      const model = event.model || '未记录模型';
      const row = modelMap.get(model) ?? { model, answers: 0, positive: 0, negative: 0, completed: 0, failed: 0, latencies: [] };
      if (event.eventType === 'answer_completed') {
        row.completed += 1;
        const latency = this.numberFromMetadata(event.metadata, 'latencyMs');
        if (latency !== null && latency >= 0) row.latencies.push(latency);
      } else {
        row.failed += 1;
      }
      modelMap.set(model, row);
    }
    const modelPerformance = [...modelMap.values()]
      .map((row) => ({
        model: row.model,
        answers: row.answers,
        trackedAnswers: row.completed + row.failed,
        successRate: row.completed + row.failed > 0 ? rate(row.completed, row.completed + row.failed) : null,
        avgResponseMs: row.latencies.length > 0
          ? Math.round(row.latencies.reduce((sum, value) => sum + value, 0) / row.latencies.length)
          : null,
        feedbackCount: row.positive + row.negative,
        helpfulRate: row.positive + row.negative > 0 ? rate(row.positive, row.positive + row.negative) : null,
      }))
      .sort((a, b) => b.answers - a.answers);

    const sourceMap = new Map<string, number>();
    for (const event of completedEvents) {
      const ragHits = this.numberFromMetadata(event.metadata, 'ragHits') ?? 0;
      const version = this.numberFromMetadata(event.metadata, 'sourceSchemaVersion') ?? 1;
      const sources: string[] = [];
      if (version >= 2) {
        if (this.booleanFromMetadata(event.metadata, 'fromDb')) sources.push('业务系统数据');
        if (this.booleanFromMetadata(event.metadata, 'fromRag')) sources.push('内部知识库');
      } else if (ragHits > 0) {
        sources.push('内部知识库');
      } else if (this.booleanFromMetadata(event.metadata, 'fromDb')) {
        sources.push('业务系统数据');
      }
      if (this.booleanFromMetadata(event.metadata, 'fromWeb')) sources.push('联网检索');
      if (
        this.booleanFromMetadata(event.metadata, 'fromAttachment') ||
        this.booleanFromMetadata(event.metadata, 'hadAttachments')
      ) {
        sources.push('用户附件');
      }
      if (sources.length === 0) sources.push('模型通用知识');
      for (const source of sources) {
        sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
      }
    }

    const feedbackStatus = ['open', 'in_progress', 'resolved', 'ignored'].map((status) => ({
      status,
      count: feedbackStatusGroups.find((row) => row.status === status)?._count._all ?? 0,
    }));

    const recentManagementFeedbackMessages = [...managementFeedbackMessages]
      .sort((a, b) => (b.feedback?.submittedAt.getTime() ?? 0) - (a.feedback?.submittedAt.getTime() ?? 0))
      .slice(0, 100);
    const feedbackConversationIds = [...new Set(recentManagementFeedbackMessages.map((message) => message.conversationId))];
    const feedbackQuestions = feedbackConversationIds.length > 0
      ? await this.prisma.chatMessage.findMany({
          where: { conversationId: { in: feedbackConversationIds }, role: 'user' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, conversationId: true, content: true, createdAt: true },
        })
      : [];
    const conversationQuestions = new Map<string, typeof feedbackQuestions>();
    for (const message of feedbackQuestions) {
      const list = conversationQuestions.get(message.conversationId) ?? [];
      list.push(message);
      conversationQuestions.set(message.conversationId, list);
    }
    const recentFeedback = recentManagementFeedbackMessages
      .map((message) => {
        const questions = conversationQuestions.get(message.conversationId) ?? [];
        const previousQuestion = [...questions]
          .reverse()
          .find((question) => question.createdAt.getTime() <= message.createdAt.getTime());
        const person = resolvePerson(message.conversation.userId, message.conversation.user);
        return {
          id: message.feedback!.id,
          messageId: message.id,
          reaction: message.feedback!.reaction,
          reasons: message.feedback!.reasons,
          reasonLabels: message.feedback!.reasons.map((reason) => FEEDBACK_REASON_LABELS[reason] ?? reason),
          comment: message.feedback!.comment,
          status: message.feedback!.status,
          resolutionNote: message.feedback!.resolutionNote,
          submittedAt: message.feedback!.submittedAt,
          createdAt: message.feedback!.createdAt,
          updatedAt: message.feedback!.updatedAt,
          userId: message.conversation.userId,
          user: person.name,
          department: person.department,
          role: person.position || person.role,
          model: message.model,
          question: this.excerpt(previousQuestion?.content ?? ''),
          answer: this.excerpt(message.content),
        };
      });

    const completedMessageIds = new Set(
      completedEvents.map((event) => event.messageId).filter((id): id is string => Boolean(id)),
    );
    const answerTrackingStartedAt = answerTrackingRange._min.createdAt;
    const trackableAnswers = answerTrackingStartedAt
      ? assistantMessages.filter((message) => message.createdAt >= answerTrackingStartedAt)
      : [];
    const matchedTrackedAnswers = trackableAnswers.filter((message) => completedMessageIds.has(message.id)).length;
    const answerTrackingCoverage = trackableAnswers.length > 0
      ? rate(matchedTrackedAnswers, trackableAnswers.length)
      : null;
    const questionTrackingStartedAt = questionTrackingRange._min.createdAt;
    const trackableQuestions = questionTrackingStartedAt
      ? userMessages.filter((message) => message.createdAt >= questionTrackingStartedAt)
      : [];
    const matchedTrackedQuestions = trackableQuestions.filter((message) => questionEventByMessageId.has(message.id)).length;
    const questionTrackingCoverage = trackableQuestions.length > 0
      ? rate(matchedTrackedQuestions, trackableQuestions.length)
      : null;
    const feedbackMismatchCount = periodMessages.filter((message) => {
      if (message.role !== 'assistant') return false;
      return (message.reaction ?? null) !== (message.feedback?.reaction ?? null);
    }).length;
    const sourceV2Events = completedEvents.filter(
      (event) => (this.numberFromMetadata(event.metadata, 'sourceSchemaVersion') ?? 0) >= 2,
    ).length;
    const sourceTraceability = completedEvents.length > 0 ? rate(sourceV2Events, completedEvents.length) : null;
    const dataQualityStatus = feedbackMismatchCount > 0 ||
      (answerTrackingCoverage !== null && answerTrackingCoverage < 98) ||
      (questionTrackingCoverage !== null && questionTrackingCoverage < 98)
      ? 'attention'
      : answerTrackingCoverage === null ||
          questionTrackingCoverage === null ||
          sourceTraceability === null ||
          sourceTraceability < 100
        ? 'partial'
        : 'healthy';

    return {
      range: { days, start, end: new Date() },
      definitions: {
        activeUser: '统计周期内至少提交 1 条问题的用户；回答失败的提问仍计入使用尝试',
        repeatUser: '统计周期内在至少 2 个不同日期使用过的用户',
        helpfulRate: '点赞数 ÷（点赞数 + 点踩数）',
        feedbackCoverage: '有反馈的回答数 ÷ AI 回答数',
        feedbackWindow: '反馈量与有帮助率按用户最近提交评价的时间统计；待处理数量为当前全量存量',
        scenario: '根据已存储提问中的关键词做规则归类，仅用于趋势观察',
        qualityWindow: '成功率、完整回答耗时和来源仅统计埋点上线后的回答',
        source: '单条回答可以同时使用业务数据、知识库、联网和附件，因此来源占比合计可能超过 100%',
        retention: '提问与采用汇总由不可变事件兜底；用户删除对话后正文明细会消失，但已发生的提问不会从汇总中倒扣',
      },
      dataFreshness: {
        generatedAt: new Date(),
        lastQuestionAt: questionObservations[questionObservations.length - 1]?.createdAt ?? null,
        trackingStartedAt: trackingRange._min.createdAt,
        lastTrackedAt: trackingRange._max.createdAt,
      },
      dataQuality: {
        status: dataQualityStatus,
        answerTrackingStartedAt,
        checks: [
          {
            key: 'question_tracking',
            label: '提问埋点覆盖',
            status: questionTrackingCoverage === null ? 'partial' : questionTrackingCoverage >= 98 ? 'healthy' : 'attention',
            value: questionTrackingCoverage === null ? '待积累' : `${questionTrackingCoverage}%`,
            detail: `${matchedTrackedQuestions}/${trackableQuestions.length} 条上线后提问具备不可变使用事件`,
          },
          {
            key: 'feedback_sync',
            label: '点赞/点踩双写一致性',
            status: feedbackMismatchCount === 0 ? 'healthy' : 'attention',
            value: feedbackMismatchCount === 0 ? '一致' : `${feedbackMismatchCount} 条异常`,
            detail: 'ChatMessage.reaction 与结构化 ChatFeedback 实时核对',
          },
          {
            key: 'answer_tracking',
            label: '回答埋点覆盖',
            status: answerTrackingCoverage === null ? 'partial' : answerTrackingCoverage >= 98 ? 'healthy' : 'attention',
            value: answerTrackingCoverage === null ? '待积累' : `${answerTrackingCoverage}%`,
            detail: `${matchedTrackedAnswers}/${trackableAnswers.length} 条上线后回答具备完成事件`,
          },
          {
            key: 'source_traceability',
            label: '来源精确追溯',
            status: sourceTraceability === null ? 'partial' : sourceTraceability === 100 ? 'healthy' : 'partial',
            value: sourceTraceability === null ? '待积累' : `${sourceTraceability}%`,
            detail: '新版回答支持业务数据、知识库、联网、附件多来源并列记录',
          },
          {
            key: 'client_validation',
            label: '前端行为防伪',
            status: 'healthy',
            value: '服务端校验',
            detail: '复制/分享仅接受当前用户拥有的真实 AI 消息，模型与会话由服务端回填',
          },
        ],
        lineage: [
          { action: '提问', capture: 'ChatMessage 与 question_submitted 在同一事务落库', dashboard: '消息形成活跃、问题量、部门与用户采用；事件用于完整性核查' },
          { action: '回答', capture: '回答与 answer_completed 在同一事务落库', dashboard: '成功率、耗时、模型与来源' },
          { action: '点赞/点踩', capture: '评价、消息 reaction 与 feedback_submitted 在同一事务落库', dashboard: '有帮助率、反馈原因与问题明细' },
          { action: '复制/分享', capture: '验证消息归属后记录，分享区分系统分享与复制兜底', dashboard: '正向行为信号' },
          { action: '重新回答', capture: '服务端校验最新回答并替换，不重复创建用户问题', dashboard: '重新回答次数与质量风险信号' },
        ],
      },
      summary: {
        activeUsers: reportingActiveUserIds.size,
        eligibleUsers: eligiblePeople.length,
        coverageRate: rate(reportingActiveUserIds.size, eligiblePeople.length),
        repeatUsers,
        repeatRate: rate(repeatUsers, reportingActiveUserIds.size),
        conversations: activeConversationIds.size,
        questions: questionObservations.length,
        answers: assistantMessages.length,
        feedbackCount: feedbackMessages.length,
        positiveFeedback,
        negativeFeedback,
        helpfulRate: rate(positiveFeedback, positiveFeedback + negativeFeedback),
        feedbackCoverage: rate(answeredFeedbackMessages.length, assistantMessages.length),
        avgResponseMs,
        p50ResponseMs,
        p95ResponseMs,
        successRate: completedEvents.length + failedEvents.length > 0
          ? rate(completedEvents.length, completedEvents.length + failedEvents.length)
          : null,
        trackedAnswers: completedEvents.length + failedEvents.length,
        failedAnswers: failedEvents.length,
        copyCount: actionCount('copy'),
        shareCount: actionCount('share'),
        regenerateCount: actionCount('regenerate'),
        chatOpenCount: actionCount('chat_open'),
        openUsers: openUserIds.size,
        openToQuestionRate: rate(openedAndAskedUsers, openUserIds.size),
        newUsers: userAdoption.filter((row) => row.isNew).length,
        returningUsers: userAdoption.filter((row) => row.questions > 0 && !row.isNew).length,
        openFeedback: feedbackStatus
          .filter((row) => row.status === 'open' || row.status === 'in_progress')
          .reduce((sum, row) => sum + row.count, 0),
      },
      comparison: {
        range: { start: previousStart, end: start },
        activeUsers: reportingPreviousActiveUserIds.size,
        coverageRate: rate(reportingPreviousActiveUserIds.size, eligiblePeople.length),
        repeatUsers: previousRepeatUsers,
        repeatRate: rate(previousRepeatUsers, reportingPreviousActiveUserIds.size),
        questions: previousQuestionObservations.length,
      },
      trend: [...trendMap.values()].map((row) => ({
        date: row.date,
        activeUsers: row.activeUsers.size,
        questions: row.questions,
        answers: row.answers,
        feedback: row.feedback,
      })),
      departments: [...departmentMap.values()]
        .filter((row) => eligibleDepartmentCounts.has(row.department))
        .map((row) => ({
          department: row.department,
          activeUsers: row.activeUsers.size,
          eligibleUsers: eligibleDepartmentCounts.get(row.department) ?? row.activeUsers.size,
          adoptionRate: rate(row.activeUsers.size, eligibleDepartmentCounts.get(row.department) ?? row.activeUsers.size),
          previousActiveUsers: previousDepartmentUsers.get(row.department)?.size ?? 0,
          previousAdoptionRate: rate(
            previousDepartmentUsers.get(row.department)?.size ?? 0,
            eligibleDepartmentCounts.get(row.department) ?? row.activeUsers.size,
          ),
          conversations: row.conversations.size,
          questions: row.questions,
          questionsPerUser: row.activeUsers.size > 0 ? Number((row.questions / row.activeUsers.size).toFixed(1)) : 0,
          helpfulRate: rate(row.positive, row.positive + row.negative),
          feedbackCount: row.positive + row.negative,
        }))
        .sort((a, b) => b.questions - a.questions),
      feedbackReasons: [...reasonMap.entries()]
        .map(([reason, count]) => ({ reason, label: FEEDBACK_REASON_LABELS[reason] ?? reason, count }))
        .sort((a, b) => b.count - a.count),
      scenarios: [...scenarioMap.values()]
        .map((row) => ({
          key: row.key,
          label: row.label,
          questions: row.questions,
          users: row.users.size,
          share: rate(row.questions, questionObservations.length),
          examples: row.examples,
        }))
        .sort((a, b) => b.questions - a.questions),
      adoptionSegments,
      userAdoption,
      modelPerformance,
      sourceDistribution: [...sourceMap.entries()]
        .map(([source, answers]) => ({ source, answers, share: rate(answers, completedEvents.length) }))
        .sort((a, b) => b.answers - a.answers),
      feedbackStatus,
      recentQuestions: [...userMessages]
        .reverse()
        .slice(0, 50)
        .map((message) => {
          const scenario = this.classifyScenario(message.content, message.attachments != null);
          const person = resolvePerson(message.conversation.userId, message.conversation.user);
          return {
            id: message.id,
            conversationId: message.conversationId,
            user: person.name,
            department: person.department,
            role: person.position || person.role,
            scenario: scenario.label,
            question: this.excerpt(message.content, 180) || '仅上传附件',
            hasAttachments: message.attachments != null,
            createdAt: message.createdAt,
          };
        }),
      recentFeedback,
    };
  }

  async getUserDetail(userId: string, daysInput?: number) {
    const days = Number.isFinite(daysInput) && ALLOWED_DAYS.has(Number(daysInput)) ? Number(daysInput) : 30;
    const start = this.chinaDayStart(days);
    const [personDirectory, messages, events, firstQuestion] = await Promise.all([
      this.loadPersonDirectory([userId]),
      this.prisma.chatMessage.findMany({
        where: {
          conversation: { userId },
          role: { in: ['user', 'assistant'] },
          OR: [
            { createdAt: { gte: start } },
            { role: 'assistant', feedback: { isNot: null } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          conversationId: true,
          role: true,
          content: true,
          model: true,
          attachments: true,
          createdAt: true,
          feedback: {
            select: {
              id: true,
              reaction: true,
              reasons: true,
              comment: true,
              status: true,
              resolutionNote: true,
              submittedAt: true,
            },
          },
        },
      }),
      this.prisma.chatUsageEvent.findMany({
        where: { userId, createdAt: { gte: start } },
        orderBy: { createdAt: 'asc' },
        select: {
          eventType: true,
          conversationId: true,
          messageId: true,
          model: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.chatMessage.findFirst({
        where: { role: 'user', conversation: { userId } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    const person = personDirectory.get(userId);
    if (!person) throw new NotFoundException('人员档案不存在');

    const periodMessages = messages.filter((message) => message.createdAt >= start);
    const userMessages = periodMessages.filter((message) => message.role === 'user');
    const assistantMessages = periodMessages.filter((message) => message.role === 'assistant');
    const feedbackMessages = messages.filter(
      (message) => message.role === 'assistant' && message.feedback && message.feedback.submittedAt >= start,
    );
    const userMessageById = new Map(userMessages.map((message) => [message.id, message]));
    const questionEvents = events.filter((event) => event.eventType === 'question_submitted');
    const questionEventMessageIds = new Set(
      questionEvents.map((event) => event.messageId).filter((id): id is string => Boolean(id)),
    );
    const questionObservations = [
      ...questionEvents.map((event) => {
        const message = event.messageId ? userMessageById.get(event.messageId) : undefined;
        const hasAttachments = message
          ? message.attachments != null
          : this.booleanFromMetadata(event.metadata, 'hadAttachments');
        const scenario = message
          ? this.classifyScenario(message.content, hasAttachments)
          : {
              key: this.stringFromMetadata(event.metadata, 'scenarioKey') ?? OTHER_SCENARIO.key,
              label: this.stringFromMetadata(event.metadata, 'scenarioLabel') ?? OTHER_SCENARIO.label,
            };
        return {
          id: event.messageId ?? event.createdAt.toISOString(),
          conversationId: event.conversationId ?? '',
          content: message?.content ?? '',
          hasAttachments,
          scenario,
          createdAt: event.createdAt,
        };
      }),
      ...userMessages
        .filter((message) => !questionEventMessageIds.has(message.id))
        .map((message) => ({
          id: message.id,
          conversationId: message.conversationId,
          content: message.content,
          hasAttachments: message.attachments != null,
          scenario: this.classifyScenario(message.content, message.attachments != null),
          createdAt: message.createdAt,
        })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const rate = (numerator: number, denominator: number) =>
      denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
    const completedEvents = events.filter((event) => event.eventType === 'answer_completed');
    const failedEvents = events.filter((event) => event.eventType === 'answer_failed');
    const latencies = completedEvents
      .map((event) => this.numberFromMetadata(event.metadata, 'latencyMs'))
      .filter((value): value is number => value !== null && value >= 0);
    const positiveFeedback = feedbackMessages.filter((message) => message.feedback?.reaction === 'like').length;
    const negativeFeedback = feedbackMessages.filter((message) => message.feedback?.reaction === 'dislike').length;
    const conversations = new Set(questionObservations.map((row) => row.conversationId).filter(Boolean));
    const activeDays = new Set(questionObservations.map((row) => this.dateKey(row.createdAt)));

    const trendMap = new Map<string, { date: string; questions: number; answers: number }>();
    for (let index = 0; index < days; index += 1) {
      const key = this.dateKey(new Date(start.getTime() + index * DAY_MS));
      trendMap.set(key, { date: key, questions: 0, answers: 0 });
    }
    for (const row of questionObservations) {
      const day = trendMap.get(this.dateKey(row.createdAt));
      if (day) day.questions += 1;
    }
    for (const message of assistantMessages) {
      const day = trendMap.get(this.dateKey(message.createdAt));
      if (day) day.answers += 1;
    }

    const scenarioMap = new Map<string, { key: string; label: string; questions: number }>();
    for (const row of questionObservations) {
      const scenario = scenarioMap.get(row.scenario.key) ?? { ...row.scenario, questions: 0 };
      scenario.questions += 1;
      scenarioMap.set(row.scenario.key, scenario);
    }

    const modelMap = new Map<string, number>();
    for (const message of assistantMessages) {
      const model = message.model || '未记录模型';
      modelMap.set(model, (modelMap.get(model) ?? 0) + 1);
    }

    const sourceMap = new Map<string, number>();
    for (const event of completedEvents) {
      for (const source of this.sourcesFromEvent(event.metadata)) {
        sourceMap.set(source, (sourceMap.get(source) ?? 0) + 1);
      }
    }

    const assistantByConversation = new Map<string, typeof assistantMessages>();
    for (const message of assistantMessages) {
      const rows = assistantByConversation.get(message.conversationId) ?? [];
      rows.push(message);
      assistantByConversation.set(message.conversationId, rows);
    }
    const recentActivity = [...userMessages]
      .reverse()
      .slice(0, 20)
      .map((message) => {
        const answer = (assistantByConversation.get(message.conversationId) ?? [])
          .find((candidate) => candidate.createdAt >= message.createdAt);
        const scenario = this.classifyScenario(message.content, message.attachments != null);
        return {
          id: message.id,
          conversationId: message.conversationId,
          question: this.excerpt(message.content, 220) || '仅上传附件',
          scenario: scenario.label,
          hasAttachments: message.attachments != null,
          createdAt: message.createdAt,
          answer: answer ? this.excerpt(answer.content, 180) : '',
          model: answer?.model ?? null,
          reaction: answer?.feedback?.reaction ?? null,
        };
      });

    const eventCount = (type: string) => events.filter((event) => event.eventType === type).length;
    const lastActiveAt = questionObservations[questionObservations.length - 1]?.createdAt ?? null;
    return {
      range: { days, start, end: new Date() },
      person,
      summary: {
        questions: questionObservations.length,
        conversations: conversations.size,
        answers: assistantMessages.length,
        activeDays: activeDays.size,
        firstUsedAt: firstQuestion?.createdAt ?? null,
        lastActiveAt,
        feedbackCount: positiveFeedback + negativeFeedback,
        positiveFeedback,
        negativeFeedback,
        helpfulRate: rate(positiveFeedback, positiveFeedback + negativeFeedback),
        avgResponseMs: latencies.length > 0
          ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
          : null,
        successRate: completedEvents.length + failedEvents.length > 0
          ? rate(completedEvents.length, completedEvents.length + failedEvents.length)
          : null,
        copyCount: eventCount('copy'),
        shareCount: eventCount('share'),
        regenerateCount: eventCount('regenerate'),
      },
      trend: [...trendMap.values()],
      scenarios: [...scenarioMap.values()]
        .map((row) => ({ ...row, share: rate(row.questions, questionObservations.length) }))
        .sort((a, b) => b.questions - a.questions),
      models: [...modelMap.entries()]
        .map(([model, answers]) => ({ model, answers, share: rate(answers, assistantMessages.length) }))
        .sort((a, b) => b.answers - a.answers),
      sources: [...sourceMap.entries()]
        .map(([source, answers]) => ({ source, answers, share: rate(answers, completedEvents.length) }))
        .sort((a, b) => b.answers - a.answers),
      recentActivity,
      feedback: [...feedbackMessages]
        .reverse()
        .slice(0, 20)
        .map((message) => ({
          id: message.feedback!.id,
          reaction: message.feedback!.reaction,
          reasonLabels: message.feedback!.reasons.map((reason) => FEEDBACK_REASON_LABELS[reason] ?? reason),
          comment: message.feedback!.comment,
          status: message.feedback!.status,
          resolutionNote: message.feedback!.resolutionNote,
          submittedAt: message.feedback!.submittedAt,
          answer: this.excerpt(message.content, 180),
          model: message.model,
        })),
    };
  }

  private chinaDayStart(days: number) {
    const shifted = new Date(Date.now() + CHINA_OFFSET_MS);
    shifted.setUTCHours(0, 0, 0, 0);
    return new Date(shifted.getTime() - CHINA_OFFSET_MS - (days - 1) * DAY_MS);
  }

  private dateKey(date: Date) {
    return new Date(date.getTime() + CHINA_OFFSET_MS).toISOString().slice(0, 10);
  }

  private excerpt(value: string, max = 160) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
  }

  private numberFromMetadata(metadata: Prisma.JsonValue, key: string) {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
    const value = (metadata as Prisma.JsonObject)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private booleanFromMetadata(metadata: Prisma.JsonValue, key: string) {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return false;
    return (metadata as Prisma.JsonObject)[key] === true;
  }

  private stringFromMetadata(metadata: Prisma.JsonValue, key: string) {
    if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
    const value = (metadata as Prisma.JsonObject)[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async loadPersonDirectory(userIds: string[]) {
    if (userIds.length === 0) return new Map<string, PersonProfile>();
    const [users, setting] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          department: true,
          role: { select: { name: true, permissions: true } },
        },
      }),
      this.prisma.systemSetting.findUnique({
        where: { key: 'rd.people' },
        select: { value: true },
      }),
    ]);
    const rdPeople = Array.isArray(setting?.value) ? setting.value : [];
    const rdByUserId = new Map<string, Prisma.JsonObject>();
    for (const item of rdPeople) {
      if (!item || Array.isArray(item) || typeof item !== 'object') continue;
      const userId = (item as Prisma.JsonObject).user_id;
      if (typeof userId === 'string' && userId) rdByUserId.set(userId, item as Prisma.JsonObject);
    }
    return new Map(users.map((user) => {
      const rdPerson = rdByUserId.get(user.id);
      const rdName = typeof rdPerson?.name === 'string' ? rdPerson.name.trim() : '';
      const rdPosition = typeof rdPerson?.position === 'string' ? rdPerson.position.trim() : '';
      const role = user.role?.name?.trim() ?? '';
      const profile: PersonProfile = {
        userId: user.id,
        name: rdName || user.name.trim(),
        // 部门以用户配置为准，不再用 rd.people 覆盖；未配置归「其他」。
        department: user.department?.trim() || OTHER_DEPARTMENT,
        role,
        position: rdPosition || role,
      };
      return [user.id, profile];
    }));
  }

  private fallbackPersonProfile(
    userId: string,
    user: { name: string; department: string | null; role: { name: string } | null },
  ): PersonProfile {
    const role = user.role?.name?.trim() ?? '';
    return {
      userId,
      name: user.name.trim(),
      department: user.department?.trim() || OTHER_DEPARTMENT,
      role,
      position: role,
    };
  }

  private sourcesFromEvent(metadata: Prisma.JsonValue) {
    const ragHits = this.numberFromMetadata(metadata, 'ragHits') ?? 0;
    const version = this.numberFromMetadata(metadata, 'sourceSchemaVersion') ?? 1;
    const sources: string[] = [];
    if (version >= 2) {
      if (this.booleanFromMetadata(metadata, 'fromDb')) sources.push('业务系统数据');
      if (this.booleanFromMetadata(metadata, 'fromRag')) sources.push('内部知识库');
    } else if (ragHits > 0) {
      sources.push('内部知识库');
    } else if (this.booleanFromMetadata(metadata, 'fromDb')) {
      sources.push('业务系统数据');
    }
    if (this.booleanFromMetadata(metadata, 'fromWeb')) sources.push('联网检索');
    if (this.booleanFromMetadata(metadata, 'fromAttachment') || this.booleanFromMetadata(metadata, 'hadAttachments')) {
      sources.push('用户附件');
    }
    if (sources.length === 0) sources.push('模型通用知识');
    return sources;
  }

  private percentile(values: number[], percentile: number) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
    return Math.round(sorted[index]);
  }

  private classifyScenario(content: string, hasAttachments: boolean): { key: string; label: string } {
    if (hasAttachments) return { key: 'file', label: '文件与表格处理' };
    const normalized = content.trim();
    const matched = SCENARIOS.find((scenario) => scenario.pattern.test(normalized));
    return matched ? { key: matched.key, label: matched.label } : OTHER_SCENARIO;
  }

  private sanitizeMetadata(input?: EventMetadata | Record<string, unknown>): EventMetadata {
    if (!input) return {};
    const result: EventMetadata = {};
    for (const [key, value] of Object.entries(input).slice(0, 20)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
      if (value === null || typeof value === 'boolean') result[key] = value;
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      if (typeof value === 'string') result[key] = value.slice(0, 200);
    }
    if (JSON.stringify(result).length > 2048) throw new BadRequestException('埋点附加信息过大');
    return result;
  }
}
