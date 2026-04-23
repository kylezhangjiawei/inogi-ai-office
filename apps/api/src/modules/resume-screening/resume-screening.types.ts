export interface InterviewQaItem {
  question: string;
  answer: string;
}

export interface CandidateProfile {
  name: string;
  gender: string;
  birth_or_age: string;
  education: string;
  status: string;
  city: string;
  hukou: string;
  target_job: string;
  target_city: string;
  salary_expectation: string;
  recent_company: string;
  recent_title: string;
  years_experience: string;
  work_summary: string;
  language_skills: string[];
  email: string;
  phone: string;
  raw_text: string;
  avatar_url?: string;
}

export interface ScreeningResult {
  ai_job: string;
  score: number;
  decision: 'recommend' | 'hold' | 'reject';
  matched_points: string[]; 
  risks: string[];
  summary: string;
  next_step: boolean;
  interview_qa?: InterviewQaItem[];
}

export interface IngestedMail {
  imapUid: number | null;
  messageId: string;
  uniqueKey: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  receivedAt: Date;
  contentText: string;
  contentHtml?: string;
}
