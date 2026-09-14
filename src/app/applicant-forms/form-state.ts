import type { FormAnswers, FormField, FormSchema } from '../lib/applicantFormsApi';

export function publicFields(fields: FormField[]): FormField[] {
  return fields.filter((field) => field.visible && field.stage === 'application').map((field) => ({
    ...field, ...(field.children ? { children: publicFields(field.children) } : {}),
  })).filter((field) => field.type !== 'repeat' || Boolean(field.children?.length));
}

export function fieldIsVisible(field: FormField, answers: FormAnswers, siblings: FormField[] = [field], visiting = new Set<string>()): boolean {
  if (!field.visible || field.stage !== 'application' || visiting.has(field.id)) return false;
  if (field.type === 'repeat' && !publicFields(field.children ?? []).length) return false;
  if (!field.condition) return true;
  const source = siblings.find((item) => item.id === field.condition!.fieldId);
  if (!source) return false;
  const next = new Set(visiting); next.add(field.id);
  return fieldIsVisible(source, answers, siblings, next)
    && String(answers[source.id] ?? '') === field.condition.equals;
}

export function pruneFormAnswers(fields: FormField[], answers: FormAnswers): FormAnswers {
  const result: FormAnswers = {};
  for (const field of fields) {
    if (!fieldIsVisible(field, answers, fields)) continue;
    const value = answers[field.id];
    if (value === undefined || value === '') continue;
    if (field.type === 'repeat') {
      result[field.id] = Array.isArray(value)
        ? (value as FormAnswers[]).map((row) => pruneFormAnswers(field.children ?? [], row)) : [];
    } else result[field.id] = value;
  }
  return result;
}

export function validateFormAnswers(fields: FormField[], answers: FormAnswers, prefix = '', visibilityFields = fields): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!fieldIsVisible(field, answers, visibilityFields)) continue;
    const value = answers[field.id];
    const path = `${prefix}${field.id}`;
    const missing = value === undefined || value === null || (typeof value === 'string' && !value.trim())
      || (Array.isArray(value) && value.length === 0) || (field.type === 'checkbox' && value !== true);
    if (field.required && missing) { errors[path] = `请${field.type === 'checkbox' ? '确认' : '填写'}${field.label}`; continue; }
    // Optional unchecked confirmations remain false; an untouched optional group has no minimum until used.
    if (missing && field.type !== 'checkbox') continue;
    if (field.type === 'repeat') {
      if (!Array.isArray(value)) { errors[path] = '请添加有效的记录'; continue; }
      const rows = Array.isArray(value) ? value as FormAnswers[] : [];
      const minimum = Math.max(field.required ? 1 : 0, field.minItems ?? 0);
      if (rows.length < minimum) errors[path] = `${field.label}至少填写 ${minimum} 条`;
      if (rows.length > (field.maxItems ?? 20)) errors[path] = `${field.label}最多填写 ${field.maxItems ?? 20} 条`;
      rows.forEach((row, index) => Object.assign(errors, validateFormAnswers(field.children ?? [], row, `${path}.${index}.`)));
    } else {
      const text = typeof value === 'string' ? value.trim() : '';
      if (field.type === 'checkbox' && value !== undefined && value !== null && value !== '' && typeof value !== 'boolean') errors[path] = '请确认此选项';
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[path] = '请输入有效的电子邮箱';
      if (field.type === 'phone' && !/^[+\d][\d\s()-]{5,24}$/.test(text)) errors[path] = '请输入有效的联系电话';
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12)) errors[path] = '请输入有效数字';
      if (field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text)) errors[path] = '请选择有效日期';
      if (field.type === 'select' && !field.options?.includes(text)) errors[path] = '请从可选项目中选择';
      if (field.type === 'multiselect' && (!Array.isArray(value) || (value as string[]).some((item) => !field.options?.includes(item)) || new Set(value as string[]).size !== (value as string[]).length)) errors[path] = '请选择有效选项';
      if (field.type === 'file' && (typeof value !== 'object' || !value || Array.isArray(value) || !('fileId' in value) || typeof value.fileId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.fileId))) errors[path] = '请重新上传附件';
      if (['text', 'textarea', 'email', 'phone', 'date', 'select'].includes(field.type) && (typeof value !== 'string' || text.length > (field.type === 'textarea' ? 5000 : 1000))) errors[path] = `请填写不超过 ${field.type === 'textarea' ? 5000 : 1000} 字的内容`;
    }
  }
  return errors;
}

export function formSections(schema: FormSchema) {
  const fields = publicFields(schema.fields);
  const names = [...new Set(fields.map((field) => field.section || '基本信息'))];
  return names.map((name) => ({ name, fields: fields.filter((field) => (field.section || '基本信息') === name) }));
}
