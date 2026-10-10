import type { HrProps } from '../../mocks/hrPreview';
import { Archives, Accounts, Attendance, Approvals } from './PeopleRecords';
import { Learning, Probations } from './LearningViews';
import { Performance } from './PerformanceViews';
import { Conversation } from './ConversationViews';

export { Learning, Performance, Conversation };
export function PeopleViews({ p }: { p: HrProps }) {
  switch (p.module.id) {
    case 'archive': return <Archives p={p}/>;
    case 'account': return <Accounts p={p}/>;
    case 'attendance': return <Attendance p={p}/>;
    case 'approval': return <Approvals p={p}/>;
    case 'learning': return <Learning p={p}/>;
    case 'probation': return <Probations p={p}/>;
    case 'performance': return <Performance p={p}/>;
    case 'assistant': case 'coach': return <Conversation p={p}/>;
    default: return null;
  }
}
