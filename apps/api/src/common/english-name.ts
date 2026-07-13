import { randomInt } from 'crypto';

const ENGLISH_FIRST_NAMES = [
  'Alex',
  'Andrew',
  'Chris',
  'Daniel',
  'David',
  'Eric',
  'Grace',
  'Henry',
  'Iris',
  'Jack',
  'James',
  'Jason',
  'Jenny',
  'Kevin',
  'Leo',
  'Lily',
  'Lucas',
  'Mia',
  'Nina',
  'Oliver',
  'Ryan',
  'Sarah',
  'Sophia',
  'Steven',
  'Victor',
] as const;

const ENGLISH_LAST_NAMES = [
  'Anderson',
  'Brown',
  'Campbell',
  'Clark',
  'Davis',
  'Evans',
  'Foster',
  'Green',
  'Hall',
  'Harris',
  'Jackson',
  'Johnson',
  'Lee',
  'Lewis',
  'Martin',
  'Miller',
  'Moore',
  'Parker',
  'Scott',
  'Taylor',
  'Thomas',
  'Walker',
  'White',
  'Williams',
  'Wilson',
] as const;

export function generateRandomEnglishName(): string {
  const firstName = ENGLISH_FIRST_NAMES[randomInt(ENGLISH_FIRST_NAMES.length)];
  const lastName = ENGLISH_LAST_NAMES[randomInt(ENGLISH_LAST_NAMES.length)];
  return `${firstName} ${lastName}`;
}

/** 空值表示用户希望系统代取英文名；非空值原样保留（仅去除首尾空白）。 */
export function resolveEnglishName(value?: string | null): string {
  return value?.trim() || generateRandomEnglishName();
}

