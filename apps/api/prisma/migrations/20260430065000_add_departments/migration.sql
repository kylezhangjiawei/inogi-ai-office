-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "manager" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- Seed departments from the current office system modules.
INSERT INTO "Department" ("id", "code", "name", "category", "manager", "description", "sortOrder", "enabled", "updatedAt")
VALUES
    ('dept-general-office', 'GENERAL_OFFICE', '总经办', '治理支持', '总经理', '负责经营看板、跨部门协调与系统首页指标归口。', 10, true, CURRENT_TIMESTAMP),
    ('dept-after-sales', 'AFTER_SALES', '售后服务部', '业务协同', '售后负责人', '负责售后 Case 处理、客户反馈闭环与问题分流。', 20, true, CURRENT_TIMESTAMP),
    ('dept-rd-registration', 'RD_REGISTRATION', '研发注册部', '研发注册', '研发注册负责人', '负责研发问题分流、注册项目里程碑、BOM 确认与设计变更。', 30, true, CURRENT_TIMESTAMP),
    ('dept-regulatory-quality', 'REGULATORY_QUALITY', '法规质量部', '法规质量', '质量负责人', '负责法规知识库、质量文件 DMS、全链路追溯、检验放行与电子批记录。', 40, true, CURRENT_TIMESTAMP),
    ('dept-customs-documents', 'CUSTOMS_DOCUMENTS', '关务单证部', '文件知识', '关务负责人', '负责报关单证 AI、报关资料处理和对外资料版本管理。', 50, true, CURRENT_TIMESTAMP),
    ('dept-sales-marketing', 'SALES_MARKETING', '销售市场部', '沟通协同', '销售负责人', '负责多渠道询盘、客户沟通、邮件 AI 写作与汇报材料。', 60, true, CURRENT_TIMESTAMP),
    ('dept-hr-admin', 'HR_ADMIN', '人事行政部', '人事行政', '人事行政负责人', '负责简历筛选、员工入职归档、随手记任务分流和费用统计。', 70, true, CURRENT_TIMESTAMP),
    ('dept-production', 'PRODUCTION', '生产运营部', '质量生产', '生产负责人', '负责生产执行、电子批记录协同、异常日志和现场放行配合。', 80, true, CURRENT_TIMESTAMP),
    ('dept-legal-contract', 'LEGAL_CONTRACT', '法务合同部', '法务系统', '法务负责人', '负责合同 AI 审查、法务风险提示与合同知识沉淀。', 90, true, CURRENT_TIMESTAMP),
    ('dept-it-system', 'IT_SYSTEM', '信息系统部', '法务系统', '系统管理员', '负责账号、角色权限、邮箱、AI 模型、字典、下载教程与系统配置。', 100, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
