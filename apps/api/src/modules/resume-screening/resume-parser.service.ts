import { Injectable } from '@nestjs/common';

import { CandidateProfile } from './resume-screening.types';

type CandidateExtractionContext = {
  senderEmail?: string;
  senderName?: string;
  subject?: string;
  html?: string | null;
};

const SECTION_HEADINGS = [
  '求职意向',
  '教育经历',
  '工作经历',
  '自我评价',
  '语言能力',
  '所获证书',
  '项目经历',
  '培训经历',
];

@Injectable()
export class ResumeParserService {
  private cleanText(text: string) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&gt;/gi, '>')
      .replace(/&lt;/gi, '<')
      .replace(/&amp;/gi, '&')
      .replace(/\u00a0|\u3000/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private toLines(text: string) {
    return this.cleanText(text)
      .split('\n')
      .map((line) => this.cleanText(line))
      .filter(Boolean);
  }

  private search(patterns: string[], text: string) {
    for (const pattern of patterns) {
      const match = text.match(new RegExp(pattern, 'i'));
      if (match?.[1]) {
        return this.cleanText(match[1]);
      }
    }
    return '';
  }

  private extractSectionLines(lines: string[], sectionName: string) {
    const startIndex = lines.findIndex((line) => line === sectionName || line.includes(sectionName));
    if (startIndex < 0) {
      return [] as string[];
    }

    const sectionLines: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (SECTION_HEADINGS.some((heading) => line === heading || line.includes(heading))) {
        break;
      }
      sectionLines.push(line);
    }
    return sectionLines;
  }

  private extractAvatarUrl(html?: string | null) {
    if (!html?.trim()) {
      return '';
    }

    const imageUrls = [...html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
      .map((match) => this.cleanText(match[1] ?? '').replace(/&amp;/g, '&'))
      .filter((url) => Boolean(url) && !url.startsWith('data:'));

    if (!imageUrls.length) {
      return '';
    }

    const preferred =
      imageUrls.find((url) => /mypics\.zhaopin\.cn\/avatar|\/avatar\//i.test(url)) ??
      imageUrls.find((url) => /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(url)) ??
      '';

    return preferred;
  }

  private extractName(lines: string[], context: CandidateExtractionContext) {
    const fromSubject = this.cleanText(context.subject ?? '')
      .split('-')
      .pop();
    if (fromSubject && /^[\u4e00-\u9fa5]{1,6}(?:女士|先生|同学|小姐)?$/.test(fromSubject)) {
      return fromSubject;
    }

    const senderMatch = this.cleanText(context.senderName ?? '').match(/([\u4e00-\u9fa5]{1,6}(?:女士|先生|同学|小姐)?)$/);
    if (senderMatch?.[1]) {
      return senderMatch[1];
    }

    const standaloneLine = lines.find((line) => /^[\u4e00-\u9fa5]{1,6}(?:女士|先生|同学|小姐)?$/.test(line));
    if (standaloneLine) {
      return standaloneLine;
    }

    const labelMatch = lines
      .slice(0, 12)
      .join('\n')
      .match(/(?:姓名|候选人|应聘人)[:：]\s*([^\n|]{2,20})/);
    if (labelMatch?.[1]) {
      return this.cleanText(labelMatch[1]);
    }

    return '';
  }

  private extractBasicFacts(lines: string[]) {
    const primaryInfoLine = lines.find((line) => /^(男|女)\s*\|/.test(line)) ?? '';
    const secondaryInfoLine =
      lines.find((line) => line.startsWith('现居住于') || line.startsWith('现居于') || line.includes('户口')) ?? '';

    const primaryParts = primaryInfoLine
      .split('|')
      .map((part) => this.cleanText(part))
      .filter(Boolean);
    const secondaryParts = secondaryInfoLine
      .split('|')
      .map((part) => this.cleanText(part))
      .filter(Boolean);

    const cityPart = secondaryParts.find((part) => /现居住于|现居于|现居地|居住于|所在地/.test(part)) ?? '';
    const hukouPart = secondaryParts.find((part) => /户口|户籍/.test(part)) ?? '';

    return {
      gender: primaryParts[0] ?? '',
      birthOrAge: primaryParts[1] ?? '',
      education: primaryParts[2] ?? '',
      status: primaryParts[3] ?? '',
      city: cityPart.replace(/^(现居住于|现居于|现居地|居住于|所在地)\s*/u, ''),
      hukou: hukouPart,
    };
  }

  private extractTargetIntent(lines: string[], fallbackSubject: string) {
    const intentLines = this.extractSectionLines(lines, '求职意向');
    const firstIntentLine = intentLines.find(
      (line) =>
        !/^\d/.test(line) &&
        !/元\/月|面议|全职|兼职|实习|临时/u.test(line) &&
        line !== '求职意向',
    );
    const salaryLine = intentLines.find((line) => /元\/月|面议/u.test(line)) ?? '';

    let targetJob = '';
    let targetCity = '';

    if (firstIntentLine) {
      const parts = firstIntentLine.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        targetCity = parts[parts.length - 1] ?? '';
        targetJob = parts.slice(0, -1).join(' ');
      } else {
        targetJob = firstIntentLine;
      }
    }

    const subjectMatch = this.cleanText(fallbackSubject).match(/智联招聘-([^-]+?)(?:\(([^)]+)\))?-[\u4e00-\u9fa5]{1,6}(?:女士|先生|同学|小姐)?$/);
    if (!targetJob && subjectMatch?.[1]) {
      targetJob = this.cleanText(subjectMatch[1]);
    }
    if (!targetCity && subjectMatch?.[2]) {
      targetCity = this.cleanText(subjectMatch[2]);
    }

    return {
      targetJob,
      targetCity,
      salaryExpectation: salaryLine ? this.cleanText(salaryLine.split('|')[0] ?? '') : '',
    };
  }

  private extractWorkExperience(lines: string[]) {
    const workLines = this.extractSectionLines(lines, '工作经历');
    const meaningfulLines = workLines.filter(
      (line) => !/^工作描述$/u.test(line) && !/^(去回复|本邮件由系统发送勿回复)/u.test(line),
    );

    let recentCompany = '';
    let recentTitle = '';
    const headerLine = meaningfulLines.find(
      (line) => !/^\d{4}[./-]\d{2}\s*-\s*(?:至今|\d{4}[./-]\d{2})/u.test(line),
    );
    if (headerLine) {
      const headerParts = headerLine.split(/\s+/).filter(Boolean);
      if (headerParts.length >= 2) {
        recentTitle = headerParts.pop() ?? '';
        recentCompany = headerParts.join(' ');
      }
    }

    const summary = meaningfulLines.slice(0, 10).join('\n').slice(0, 320).trim();

    const yearMatch = meaningfulLines
      .join('\n')
      .match(/(\d{1,2}(?:\.\d+)?)年(?:工作)?经验/u);
    if (yearMatch?.[1]) {
      return {
        recentCompany,
        recentTitle,
        yearsExperience: `${yearMatch[1]}年`,
        workSummary: summary,
      };
    }

    const dateRanges = [...meaningfulLines.join('\n').matchAll(/(\d{4})[./-](\d{2})\s*-\s*(至今|(\d{4})[./-](\d{2}))/gu)];
    if (!dateRanges.length) {
      return {
        recentCompany,
        recentTitle,
        yearsExperience: '',
        workSummary: summary,
      };
    }

    const startMonths = dateRanges.map((match) => Number(match[1]) * 12 + Number(match[2]));
    const endMonths = dateRanges.map((match) =>
      match[3] === '至今'
        ? new Date().getFullYear() * 12 + (new Date().getMonth() + 1)
        : Number(match[4]) * 12 + Number(match[5]),
    );
    const earliest = Math.min(...startMonths);
    const latest = Math.max(...endMonths);
    const totalMonths = Math.max(0, latest - earliest);
    const roundedYears = Math.max(1, Math.round((totalMonths / 12) * 10) / 10);

    return {
      recentCompany,
      recentTitle,
      yearsExperience: `${Number.isInteger(roundedYears) ? roundedYears : roundedYears.toFixed(1)}年`,
      workSummary: summary,
    };
  }

  private extractFallbackTargetIntent(text: string) {
    return {
      targetJob: this.search(
        [
          '(?:求职意向|意向岗位|目标岗位|期望岗位)[:：]\\s*([^\\n|]{2,40})',
          '(?:应聘岗位|应聘职位|求职岗位)[:：]\\s*([^\\n|]{2,40})',
        ],
        text,
      ),
      targetCity: this.search(
        [
          '(?:目标城市|意向城市|期望城市|工作地点)[:：]\\s*([^\\n|]{2,20})',
          '(?:现居住于|现居|居住地|所在城市)[:：]?\\s*([^\\n|]{2,20})',
        ],
        text,
      ),
      salaryExpectation: this.search(
        [
          '(?:期望薪资|薪资期望|期望月薪|薪资)[:：]\\s*([^\\n|]{2,30})',
          '((?:\\d{3,5}|面议)[^\\n|]{0,20}(?:元/月|万元/年|面议))',
        ],
        text,
      ),
    };
  }

  private extractFallbackExperience(text: string, lines: string[]) {
    let recentCompany = this.search(
      [
        '(?:最近公司|现任公司|所在公司)[:：]\\s*([^\\n]{2,50})',
        '([^\\n]{2,50}(?:公司|集团|科技|信息|商贸|物流|制造|医院|学校|事务所|协会))\\s+[^\\n]{2,30}',
      ],
      text,
    );
    let recentTitle = this.search(
      [
        '(?:最近职位|现任职位|职位名称)[:：]\\s*([^\\n]{2,30})',
        '(?:公司|集团|科技|信息|商贸|物流|制造|医院|学校|事务所|协会)\\s+([^\\n]{2,30})',
      ],
      text,
    );

    if (!recentCompany || !recentTitle) {
      const workHeaderIndex = lines.findIndex((line) => line.includes('工作经历'));
      if (workHeaderIndex >= 0) {
        const candidateLine = lines.slice(workHeaderIndex + 1, workHeaderIndex + 8).find((line) => !/^\d{4}[./-]\d{2}/.test(line));
        if (candidateLine) {
          const match = candidateLine.match(/^(.+?(?:公司|集团|科技|信息|商贸|物流|制造|医院|学校|事务所|协会))\s+(.+)$/);
          if (match?.[1] && !recentCompany) recentCompany = this.cleanText(match[1]);
          if (match?.[2] && !recentTitle) recentTitle = this.cleanText(match[2]);
        }
      }
    }

    return {
      recentCompany,
      recentTitle,
      yearsExperience:
        this.search(['((?:\\d{1,2}(?:\\.\\d+)?)年(?:以上)?(?:工作)?经验)'], text) ||
        this.search(['((?:\\d{1,2}(?:\\.\\d+)?)年(?:工作)?经历)'], text),
      workSummary: lines.slice(0, 12).join('\n').slice(0, 320).trim(),
    };
  }

  extractCandidateProfile(text: string, context: CandidateExtractionContext = {}): CandidateProfile {
    const normalized = this.cleanText(text);
    const lines = this.toLines(normalized);
    const basicFacts = this.extractBasicFacts(lines);
    const intent = this.extractTargetIntent(lines, context.subject ?? '');
    const experience = this.extractWorkExperience(lines);
    const fallbackIntent = this.extractFallbackTargetIntent(normalized);
    const fallbackExperience = this.extractFallbackExperience(normalized, lines);
    const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const phoneMatch = normalized.match(/(1[3-9]\d{9})/);
    const languages = [...normalized.matchAll(/(英语|日语|韩语|德语|法语|西班牙语|俄语|粤语)/g)].map(
      (item) => item[1],
    );

    return {
      name: this.extractName(lines, context),
      gender: basicFacts.gender || this.search(['(?:性别)[:：]\\s*(男|女)'], normalized),
      birth_or_age: basicFacts.birthOrAge || this.search(['((?:19|20)\\d{2}年\\d{1,2}月)', '(\\d{1,2}岁)'], normalized),
      education:
        basicFacts.education ||
        this.search(
          [
            '(?:学历|最高学历|教育背景)[:：]\\s*([^\\n|]{2,30})',
            '(博士|硕士|本科|大专|中专|高中)',
          ],
          normalized,
        ),
      status:
        basicFacts.status ||
        this.search(['(离职-正在找工作|在职-考虑机会|在职-月内到岗|在职-暂不考虑|应届毕业生|学生)'], normalized),
      city:
        basicFacts.city ||
        this.search(['(?:现居住于|现居|居住地|所在城市)[:：]?\\s*([^\\n|]{2,20})'], normalized) ||
        fallbackIntent.targetCity,
      hukou: basicFacts.hukou || this.search(['(?:户口|户籍)[:：]?\\s*([^\\n|]{2,20})'], normalized),
      target_job: intent.targetJob || fallbackIntent.targetJob,
      target_city: intent.targetCity || fallbackIntent.targetCity,
      salary_expectation: intent.salaryExpectation || fallbackIntent.salaryExpectation,
      recent_company: experience.recentCompany || fallbackExperience.recentCompany,
      recent_title: experience.recentTitle || fallbackExperience.recentTitle,
      years_experience: experience.yearsExperience || fallbackExperience.yearsExperience,
      work_summary: experience.workSummary || fallbackExperience.workSummary,
      language_skills: [...new Set(languages)],
      email: emailMatch?.[0] ?? context.senderEmail ?? '',
      phone: phoneMatch?.[1] ?? '',
      raw_text: normalized,
      avatar_url: this.extractAvatarUrl(context.html),
    };
  }

  shouldAttemptScreening(profile: CandidateProfile) {
    if (!profile.raw_text || profile.raw_text.length < 40) {
      return { allowed: false, reason: '邮件正文过短，暂时无法提取候选人信息。' };
    }
    if (!profile.name && !profile.target_job && !profile.email) {
      return { allowed: false, reason: '未提取到候选人姓名、目标岗位或邮箱，暂不执行筛选。' };
    }
    return { allowed: true, reason: null };
  }
}
