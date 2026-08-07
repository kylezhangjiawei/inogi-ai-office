/**
 * 历史任务里曾把部门、团队或分派状态写进 `primary_owner`。
 * 这些值可以继续保留在任务数据中，但不能被驾驶舱当作可点击成员。
 */
const NON_PERSON_OWNER_NAMES = new Set([
  "",
  "待指派",
  "未分配",
  "未指派",
  "暂无",
  "已离职",
  "外部机构",
  "采购",
  "研发团队",
  "系统",
]);

export type RdMemberDirectoryEntry = {
  name?: string | null;
  user_id?: string | null;
  status?: string | null;
};

function normalizeMemberName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isNonPersonTaskOwner(value: unknown): boolean {
  return NON_PERSON_OWNER_NAMES.has(normalizeMemberName(value));
}

/**
 * 成员身份主键：有 user_id 就认 user_id，没有（存量任务）才回退姓名。
 *
 * 驾驶舱的人员负载、头像角标、人员抽屉一律按这个键索引 —— 只按姓名索引会把两位
 * 同名同事当成一个人：负载相加、任务混进同一个抽屉，下游还会拿到另一个人的 user_id。
 */
export function memberIdentityKey(name: unknown, userId?: unknown): string {
  const id = normalizeMemberName(userId);
  return id ? `id:${id}` : `name:${normalizeMemberName(name)}`;
}

/** 两个「姓名 + user_id」是否指同一个人。 */
export function isSameMember(
  a: { name?: unknown; user_id?: unknown },
  b: { name?: unknown; user_id?: unknown },
): boolean {
  return memberIdentityKey(a.name, a.user_id) === memberIdentityKey(b.name, b.user_id);
}

/**
 * 判断任务主责是否能成为驾驶舱里的“成员”。
 *
 * - 传入人员目录时，账号必须按 user_id 命中当前驾驶舱配置；
 * - 没有 user_id 的历史任务按姓名命中当前驾驶舱配置；
 * - 未传目录时仅用于旧调用兼容，但仍拒绝明确的角色/团队占位值。
 */
export function isTaskOwnerMember(
  ownerName: unknown,
  ownerUserId?: unknown,
  directory?: readonly RdMemberDirectoryEntry[],
): boolean {
  const name = normalizeMemberName(ownerName);
  if (isNonPersonTaskOwner(name)) return false;
  if (!directory) return true;
  const userId = normalizeMemberName(ownerUserId);

  return directory.some((person) => {
    if (normalizeMemberName(person.status).toLowerCase() === "resigned") return false;
    const configuredUserId = normalizeMemberName(person.user_id);
    if (userId && configuredUserId) return configuredUserId === userId;
    return normalizeMemberName(person.name) === name;
  });
}
