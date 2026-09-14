import { BadRequestException } from '@nestjs/common';
import { FIELD_TYPES, FormAnswers, FormField, FormSchema } from './types';

export function object(value: unknown, label = '数据'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException(`${label}格式不正确`);
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new BadRequestException(`${label}包含不支持的字段`);
}
export function text(value: unknown, label: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) throw new BadRequestException(`${label}请填写${optional ? '不超过' : '1–'}${max}个字符`);
  return value.trim();
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BadRequestException('请提供有效的 expectedRevision');
  return Number(value);
}
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !reserved.has(value);

export function validateSchema(input: unknown): FormSchema {
  const raw = object(input, '模板');
  keys(raw, ['title', 'description', 'fields'], '模板');
  const seen = new Set<string>();
  let count = 0;
  const parseFields = (inputFields: unknown, depth: number): FormField[] => {
    if (!Array.isArray(inputFields) || inputFields.length > (depth ? 15 : 80) || !inputFields.length) throw new BadRequestException('每个模板或重复组必须有字段，模板最多80项、组内最多15项');
    const fields = inputFields.map((entry): FormField => {
      if (++count > 150) throw new BadRequestException('模板总字段数不能超过150项');
      const item = object(entry, '字段');
      keys(item, ['id', 'label', 'type', 'required', 'visible', 'stage', 'section', 'placeholder', 'options', 'children', 'condition', 'minItems', 'maxItems', 'fileKind'], '字段');
      if (!validId(item.id) || seen.has(item.id)) throw new BadRequestException('字段ID必须唯一，并以字母开头，仅含字母、数字、短横线和下划线');
      seen.add(item.id);
      if (!(FIELD_TYPES as readonly unknown[]).includes(item.type)) throw new BadRequestException('不支持的字段类型');
      if (typeof item.required !== 'boolean' || typeof item.visible !== 'boolean') throw new BadRequestException('字段 required / visible 必须是布尔值');
      if (!['application', 'onboarding', 'internal'].includes(String(item.stage))) throw new BadRequestException('不支持的字段阶段');
      const field: FormField = { id: item.id, label: text(item.label, '字段名称', 120), type: item.type as FormField['type'],
        required: item.required, visible: item.visible, stage: item.stage as FormField['stage'], section: text(item.section, '分组名称', 80, true) };
      if (item.placeholder !== undefined) field.placeholder = text(item.placeholder, '填写提示', 200, true);
      if (field.type === 'select' || field.type === 'multiselect') {
        if (!Array.isArray(item.options) || !item.options.length || item.options.length > 80) throw new BadRequestException('选择字段须有1–80个选项');
        field.options = item.options.map((option) => text(option, '选项', 100));
        if (new Set(field.options).size !== field.options.length) throw new BadRequestException('选项不能重复');
      } else if (item.options !== undefined) throw new BadRequestException('只有选择字段支持 options');
      if (field.type === 'repeat') {
        if (depth) throw new BadRequestException('重复组不能嵌套重复组');
        field.children = parseFields(item.children, depth + 1);
        if ((item.minItems !== undefined && typeof item.minItems !== 'number') || (item.maxItems !== undefined && typeof item.maxItems !== 'number')) throw new BadRequestException('重复组条数必须是数字');
        field.minItems = item.minItems === undefined ? 0 : Number(item.minItems);
        field.maxItems = item.maxItems === undefined ? 10 : Number(item.maxItems);
        if (!Number.isInteger(field.minItems) || !Number.isInteger(field.maxItems) || field.minItems < 0 || field.maxItems < 1 || field.maxItems > 20 || field.minItems > field.maxItems) throw new BadRequestException('重复组条数范围必须介于0–20');
      } else if (item.children !== undefined || item.minItems !== undefined || item.maxItems !== undefined) throw new BadRequestException('只有重复组支持 children / minItems / maxItems');
      if (item.fileKind !== undefined) {
        if (field.type !== 'file' || !['photo', 'document'].includes(String(item.fileKind))) throw new BadRequestException('附件类型仅支持 photo / document');
        field.fileKind = item.fileKind as FormField['fileKind'];
      }
      if (item.condition !== undefined) {
        const condition = object(item.condition, '显示条件');
        keys(condition, ['fieldId', 'equals'], '显示条件');
        if (!validId(condition.fieldId)) throw new BadRequestException('显示条件引用的字段ID不正确');
        field.condition = { fieldId: condition.fieldId, equals: text(condition.equals, '条件值', 200, true) };
      }
      return field;
    });
    const byId = new Map(fields.map((field) => [field.id, field]));
    for (const field of fields) {
      if (!field.condition) continue;
      const dependency = byId.get(field.condition.fieldId);
      if (!dependency || ['repeat', 'file', 'multiselect'].includes(dependency.type)) throw new BadRequestException('显示条件只能引用同一层级的单值字段');
      if (field.visible && field.stage === 'application' && (!dependency.visible || dependency.stage !== 'application')) throw new BadRequestException('公开应聘字段的显示条件不能依赖隐藏、入职或内部字段');
      const visiting = new Set([field.id]);
      let cursor: FormField | undefined = dependency;
      while (cursor) {
        if (visiting.has(cursor.id)) throw new BadRequestException('字段显示条件不能循环引用');
        visiting.add(cursor.id);
        cursor = cursor.condition ? byId.get(cursor.condition.fieldId) : undefined;
      }
    }
    return fields;
  };
  return { title: text(raw.title, '模板标题', 120), description: text(raw.description, '模板说明', 2000, true), fields: parseFields(raw.fields, 0) };
}

/** Public schema excludes hidden and post-application fields, including nested groups. */
export function publicSchema(schema: FormSchema): FormSchema {
  const project = (fields: FormField[]): FormField[] => fields.filter((field) => field.stage === 'application' && field.visible)
    .map((field) => ({ ...field, ...(field.children ? { children: project(field.children) } : {}) }))
    .filter((field) => field.type !== 'repeat' || Boolean(field.children?.length));
  return { title: schema.title, description: schema.description, fields: project(schema.fields) };
}

export function shown(field: FormField, answers: Record<string, unknown>, fields: FormField[]): boolean {
  if (!field.visible || field.stage !== 'application') return false;
  if (!field.condition) return true;
  const source = fields.find((item) => item.id === field.condition!.fieldId);
  return Boolean(source && shown(source, answers, fields) && String(answers[source.id] ?? '') === field.condition.equals);
}
export function flattenFields(schema: FormSchema): FormField[] { return schema.fields.flatMap((field) => [field, ...(field.children ?? [])]); }

export function validateAnswers(schema: FormSchema, input: unknown): { answers: FormAnswers; files: Array<{ id: string; fieldId: string }> } {
  if (Buffer.byteLength(JSON.stringify(input ?? null)) > 128 * 1024) throw new BadRequestException('填写内容过长');
  const files: Array<{ id: string; fieldId: string }> = [];
  const parse = (rawInput: unknown, fields: FormField[]): FormAnswers => {
    const raw = object(rawInput, '填写内容');
    const result: FormAnswers = {};
    for (const id of Object.keys(raw)) {
      const field = fields.find((item) => item.id === id);
      if (!field || !shown(field, raw, fields)) throw new BadRequestException('填写内容包含未知、隐藏或非应聘阶段字段');
    }
    for (const field of fields) {
      if (!shown(field, raw, fields)) continue;
      const value = raw[field.id];
      const absent = value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
      if (absent) { if (field.required) throw new BadRequestException(`请填写「${field.label}」`); continue; }
      if (field.type === 'repeat') {
        if (!Array.isArray(value) || value.length < (field.minItems ?? 0) || value.length > (field.maxItems ?? 10)) throw new BadRequestException(`「${field.label}」条数不符合要求`);
        result[field.id] = value.map((row) => parse(row, field.children ?? []));
      } else if (field.type === 'file') {
        const file = object(value, '附件');
        keys(file, ['fileId'], '附件');
        if (typeof file.fileId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(file.fileId)) throw new BadRequestException(`请重新上传「${field.label}」`);
        files.push({ id: file.fileId, fieldId: field.id });
        result[field.id] = { fileId: file.fileId };
      } else if (field.type === 'checkbox') {
        if (typeof value !== 'boolean' || (field.required && value !== true)) throw new BadRequestException(`请确认「${field.label}」`);
        result[field.id] = value;
      } else if (field.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new BadRequestException(`「${field.label}」须为有效数字`);
        result[field.id] = value;
      } else if (field.type === 'multiselect') {
        if (!Array.isArray(value) || value.length > (field.options?.length ?? 0) || value.some((item) => typeof item !== 'string' || !field.options?.includes(item)) || new Set(value).size !== value.length) throw new BadRequestException(`「${field.label}」包含无效选项`);
        result[field.id] = value as string[];
      } else {
        const answer = text(value, field.label, field.type === 'textarea' ? 5000 : 1000, !field.required);
        if (field.type === 'select' && !field.options?.includes(answer)) throw new BadRequestException(`「${field.label}」选项无效`);
        if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer)) throw new BadRequestException(`「${field.label}」邮箱格式不正确`);
        if (field.type === 'phone' && !/^[+\d][\d\s()-]{5,24}$/.test(answer)) throw new BadRequestException(`「${field.label}」号码格式不正确`);
        if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(answer) || Number.isNaN(Date.parse(answer)) || new Date(answer).toISOString().slice(0, 10) !== answer)) throw new BadRequestException(`「${field.label}」日期格式不正确`);
        result[field.id] = answer;
      }
    }
    return result;
  };
  return { answers: parse(input, publicSchema(schema).fields), files };
}

export function changeSummary(before: FormSchema, after: FormSchema): string[] {
  const old = new Map(flattenFields(before).map((field) => [field.id, field]));
  const next = new Map(flattenFields(after).map((field) => [field.id, field]));
  const changes: string[] = [];
  if (before.title !== after.title || before.description !== after.description) changes.push('调整表单标题或说明');
  for (const [id, field] of next) {
    if (!old.has(id)) changes.push(`新增「${field.label}」`);
    else if (JSON.stringify(field) !== JSON.stringify(old.get(id))) changes.push(`调整「${field.label}」`);
  }
  for (const [id, field] of old) if (!next.has(id)) changes.push(`移除「${field.label}」`);
  return changes.length ? changes : ['模板内容未发生变化'];
}
