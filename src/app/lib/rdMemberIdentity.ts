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
 * 判断任务主责是否能成为驾驶舱里的“成员”。
 *
 * - 有 user_id 的主责属于真实账号，直接接受；
 * - 没有 user_id 的历史任务必须能在人员目录中按姓名命中；
 * - 未传目录时保留旧数据兼容性，但仍拒绝明确的角色/团队占位值。
 */
export function isTaskOwnerMember(
  ownerName: unknown,
  ownerUserId?: unknown,
  directory?: readonly RdMemberDirectoryEntry[],
): boolean {
  const name = normalizeMemberName(ownerName);
  if (isNonPersonTaskOwner(name)) return false;
  if (typeof ownerUserId === "string" && ownerUserId.trim()) return true;
  if (!directory) return true;

  return directory.some((person) => {
    if (normalizeMemberName(person.name) !== name) return false;
    return normalizeMemberName(person.status).toLowerCase() !== "resigned";
  });
}
