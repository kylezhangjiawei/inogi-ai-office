import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";

const initialUsers = [
  { name: "林云舟", email: "admin@inogi.local", role: "系统管理员", department: "信息管理中心", status: "启用" },
  { name: "周知言", email: "manager@inogi.local", role: "部门主管", department: "运营管理部", status: "启用" },
  { name: "陈思远", email: "specialist@inogi.local", role: "业务专员", department: "业务协同组", status: "启用" },
  { name: "韩青", email: "ra@inogi.local", role: "注册专员", department: "注册事务部", status: "待分配" },
  { name: "吴清", email: "service@inogi.local", role: "售后专员", department: "客户成功部", status: "停用" },
  { name: "王宁", email: "rd@inogi.local", role: "研发工程师", department: "研发中心", status: "启用" },
];

const pageSize = 3;

type DialogMode = "create" | "import" | "export" | "detail" | null;

export function UserManagement() {
  const [users, setUsers] = useState(initialUsers);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [departmentFilter, setDepartmentFilter] = useState("全部部门");
  const [page, setPage] = useState(1);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedEmail, setSelectedEmail] = useState(initialUsers[0].email);

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        const matchesKeyword = !keyword || `${user.name} ${user.email} ${user.role} ${user.department}`.toLowerCase().includes(keyword.toLowerCase());
        const matchesStatus = statusFilter === "全部状态" || user.status === statusFilter;
        const matchesDepartment = departmentFilter === "全部部门" || user.department === departmentFilter;
        return matchesKeyword && matchesStatus && matchesDepartment;
      }),
    [departmentFilter, keyword, statusFilter, users],
  );

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter, departmentFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const pagedUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);
  const selectedUser = users.find((user) => user.email === selectedEmail) ?? users[0];

  function toggleStatus(email: string) {
    setUsers((prev) =>
      prev.map((user) =>
        user.email === email
          ? {
              ...user,
              status: user.status === "启用" ? "停用" : "启用",
            }
          : user,
      ),
    );
    toast.success("用户状态已更新");
  }

  const closeDialog = () => setDialogMode(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="material-card p-6 md:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="material-chip bg-blue-50 text-blue-700">User Management</span>
            <h2 className="mt-3 text-[2rem] font-bold tracking-tight text-slate-900">用户管理</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">补齐用户检索、状态筛选、部门过滤、分页和详情弹窗，便于直接演示基础后台管理流程。</p>
          </div>
          <button className="material-button-primary w-fit" onClick={() => setDialogMode("create")}>
            <Plus className="h-4 w-4" />
            新建用户
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="material-card p-6">
          <div className="mb-5 flex flex-col gap-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative w-full max-w-sm">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="material-input pl-11"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索姓名、邮箱、角色、部门..."
                />
              </div>
              <div className="flex gap-3">
                <button className="material-button-secondary" onClick={() => setDialogMode("import")}>
                  批量导入
                </button>
                <button className="material-button-secondary" onClick={() => setDialogMode("export")}>
                  导出名单
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-3 md:flex-row">
              <select className="material-input min-w-[140px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {["全部状态", "启用", "待分配", "停用"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <select className="material-input min-w-[180px]" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                {["全部部门", "信息管理中心", "运营管理部", "业务协同组", "注册事务部", "客户成功部", "研发中心"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50">
                <tr>
                  {["姓名", "邮箱", "角色", "部门", "状态", "操作"].map((title) => (
                    <th key={title} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedUsers.map((user) => (
                  <tr key={user.email} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      <button
                        type="button"
                        className="text-left hover:text-primary"
                        onClick={() => {
                          setSelectedEmail(user.email);
                          setDialogMode("detail");
                        }}
                      >
                        {user.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{user.email}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{user.role}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{user.department}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={cn("material-chip", user.status === "启用" ? "bg-emerald-50 text-emerald-700" : user.status === "停用" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700")}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex gap-2">
                        <button className="material-button-secondary !px-3 !py-2" onClick={() => toggleStatus(user.email)}>
                          {user.status === "启用" ? "停用" : "启用"}
                        </button>
                        <button
                          className="material-button-secondary !px-3 !py-2"
                          onClick={() => {
                            setSelectedEmail(user.email);
                            setDialogMode("detail");
                          }}
                        >
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
            <div className="text-sm text-slate-500">
              共 {filteredUsers.length} 条，当前第 {page} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page === 1}>
                上一页
              </button>
              <button className="material-button-secondary !px-3 !py-2" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page === totalPages}>
                下一页
              </button>
            </div>
          </div>
        </div>

        <aside className="material-card p-6">
          <h3 className="text-slate-900">当前聚焦用户</h3>
          <div className="mt-4 rounded-[24px] bg-[linear-gradient(135deg,#edf5ff_0%,#ffffff_58%,#eef9f7_100%)] p-5">
            <div className="text-lg font-semibold text-slate-900">{selectedUser.name}</div>
            <div className="mt-3 space-y-2 text-sm text-slate-600">
              <div>邮箱：{selectedUser.email}</div>
              <div>角色：{selectedUser.role}</div>
              <div>部门：{selectedUser.department}</div>
              <div>状态：{selectedUser.status}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["最近登录", "2026-04-16 09:28"],
              ["权限模板", selectedUser.role],
              ["待办数量", "4 项"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-2 text-sm text-slate-700">{value}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <Dialog open={dialogMode === "create"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>新建用户</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-3 text-sm text-slate-600">
            <div>默认账号：new.user@inogi.local</div>
            <div>默认角色：业务专员</div>
            <div>默认部门：业务协同组</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("新建用户表单已生成");
            }}
          >
            创建
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "import"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>批量导入</DialogTitle>
        <DialogContent dividers>
          <p className="text-sm leading-7 text-slate-600">这里先模拟导入流程，确认后会按模板读取 12 条账号记录并进入待校验列表。</p>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("批量导入任务已触发");
            }}
          >
            开始导入
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "export"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>导出名单</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-2 text-sm text-slate-600">
            <div>导出范围：当前筛选结果</div>
            <div>记录数量：{filteredUsers.length} 条</div>
            <div>格式：Excel + CSV</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            取消
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success("名单已导出");
            }}
          >
            确认导出
          </button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogMode === "detail"} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle>用户详情</DialogTitle>
        <DialogContent dividers>
          <div className="space-y-3 text-sm text-slate-600">
            <div>姓名：{selectedUser.name}</div>
            <div>邮箱：{selectedUser.email}</div>
            <div>角色：{selectedUser.role}</div>
            <div>部门：{selectedUser.department}</div>
            <div>当前状态：{selectedUser.status}</div>
            <div>关联模块：售后工单、首页工作台、用户管理</div>
          </div>
        </DialogContent>
        <DialogActions>
          <button type="button" className="material-button-secondary" onClick={closeDialog}>
            关闭
          </button>
          <button
            type="button"
            className="material-button-primary"
            onClick={() => {
              closeDialog();
              toast.success(`${selectedUser.name} 的权限同步任务已创建`);
            }}
          >
            同步权限
          </button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
