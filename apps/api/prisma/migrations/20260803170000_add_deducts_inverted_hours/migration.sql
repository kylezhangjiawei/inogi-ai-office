-- AlterTable: 是否参与倒挂抵扣（生产没任务时工资照发，扣除工时累计成欠账，后续加班冲抵）
ALTER TABLE "EmployeeArchive" ADD COLUMN     "deductsInvertedHours" BOOLEAN NOT NULL DEFAULT false;

-- 初始名单由 HR 提供，原先写死在 inverted-hours-employees.constants.ts，改存库后在此回填一次。
-- 后续人员变动在「人员考勤 → 月度结余」弹窗里勾选，不再需要改代码。
UPDATE "EmployeeArchive"
SET "deductsInvertedHours" = true
WHERE "name" IN ('王宁', '徐坚珩', '张明星', '刘巧玲', '任韩', '李娜', '王守芹', '叶晓娟', '徐中红', '王炳毅');
