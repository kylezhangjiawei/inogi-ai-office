-- 「接收审核通知」独立权限码 rd-review:notify。
--
-- 背景：审核通知的收件人原先按 (rd-task:edit 或 rd-task:reassign) + 任一 page:rd-* 判定。
-- rd-task:edit 是默认「研发人员」角色就持有的操作码，于是任何被授予研发权限的岗位
-- ——包括本职是采购、只是兼有研发权限的主管——都会收到研发的审核通知。
--
-- 这条迁移只做「平移」：把新码按**完全相同的旧口径**灌给现有角色，
-- 切换当天收件人一个不多一个不少；之后在角色管理页取消勾选即可精确收敛。
-- 不这么做的话，上线瞬间没有任何角色持有新码，审核通知会整体静默中断。
--
-- 超管（permissions 含 '*'）在服务层短路放行，不需要也不写入此码。

UPDATE "Role"
SET permissions = permissions || '["rd-review:notify"]'::jsonb
WHERE
  -- 尚未持有（可重复执行）
  NOT (permissions @> '["rd-review:notify"]'::jsonb)
  -- 超管无需此码
  AND NOT (permissions @> '["*"]'::jsonb)
  -- 旧口径条件一：任一审核相关操作码
  AND permissions ?| array['rd-task:edit', 'rd-task:reassign']
  -- 旧口径条件二：任一工作区的页面码。
  -- 必须三个池都覆盖：notifyAdminsOfPendingReview 在哪个工作区执行就按哪个池的页面码捞人，
  -- 只灌研发页面码会让中美协同池和生产池的审核人从此收不到任何审核通知。
  -- 逐项列出而不是 LIKE 'page:rd-%'：后者既漏掉 page:us-collab-*，
  -- 又会把 page:rd-director-dashboard（属 production 池）混进研发池的判定里。
  AND permissions ?| array[
    -- WORKSPACE_PAGE_CODES.rd
    'page:rd-task-management',
    'page:rd-my-workspace',
    'page:rd-approval-flow',
    'page:rd-audit-log',
    'page:rd-ai-settings',
    'page:rd-sheet',
    'page:rd-knowledge-base',
    -- WORKSPACE_PAGE_CODES['us-collab']
    'page:us-collab-cockpit',
    'page:us-collab-workspace',
    'page:us-collab-approval-flow',
    'page:us-collab-audit-log',
    'page:us-collab-ai-settings',
    -- WORKSPACE_PAGE_CODES.production
    'page:rd-director-dashboard'
  ];

DO $$
DECLARE granted bigint;
BEGIN
  SELECT count(*) INTO granted FROM "Role" WHERE permissions @> '["rd-review:notify"]'::jsonb;
  RAISE NOTICE '[rd-review:notify] 已持有该码的角色数：%（含本次平移授予）', granted;
END $$;
