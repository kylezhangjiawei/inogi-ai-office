import React, { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AtSign,
  Camera,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  KeyRound,
  LockKeyhole,
  Mail,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  User,
} from "lucide-react";
import { getRoleLabel, useAuth } from "./auth";
import { authFetch, readErrorMessage } from "./lib/authSession";
import { clearStoredUserAvatar, saveStoredUserAvatar, useUserAvatar } from "./lib/userAvatar";

function initials(name?: string | null) {
  return name?.trim().slice(0, 1) || "U";
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface-variant">
      {children}
    </label>
  );
}

function getPasswordStrength(password: string): { level: 0 | 1 | 2 | 3; label: string; barClass: string; textClass: string } {
  if (!password) return { level: 0, label: "", barClass: "", textClass: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { level: 1, label: "弱", barClass: "bg-[hsl(var(--destructive))]", textClass: "text-destructive" };
  if (score <= 2) return { level: 2, label: "中", barClass: "bg-amber-400", textClass: "text-amber-600" };
  return { level: 3, label: "强", barClass: "bg-emerald-500", textClass: "text-emerald-600" };
}

async function updateProfile(payload: { name: string; email: string }) {
  const response = await authFetch("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "个人资料保存失败"));
}

async function updatePassword(oldPassword: string, newPassword: string) {
  const response = await authFetch("/api/auth/me/password", {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "密码修改失败"));
}

const pageMotion = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } };
const staggerMotion = { visible: { transition: { staggerChildren: 0.07 } } };
const itemMotion = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

export function PersonalCenterPage() {
  const { user, refreshUser } = useAuth();
  const avatar = useUserAvatar(user?.id);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState(user?.email ?? "");
  const [passwordForm, setPasswordForm] = useState({ oldPassword: "", password: "", confirmPassword: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const isSuperAdmin = Boolean(user?.permissions.includes("*"));
  const canEditAccountFields = Boolean(user) && !isSuperAdmin;
  const roleLabel = getRoleLabel(user?.roleName);
  const permissionSummary = useMemo(() => {
    if (!user) return "0";
    if (user.permissions.includes("*")) return "全部";
    return String(user.permissions.length);
  }, [user]);
  const saveEmailDisabled = !canEditAccountFields || savingProfile || email.trim() === (user?.email ?? "");
  const pwdStrength = getPasswordStrength(passwordForm.password);
  const pwdMismatch = Boolean(passwordForm.confirmPassword && passwordForm.password !== passwordForm.confirmPassword);

  React.useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  async function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    if (file.size > 1024 * 1024 * 2) { toast.error("头像图片不能超过 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (dataUrl) { saveStoredUserAvatar(user.id, dataUrl); toast.success("头像已更新"); }
    };
    reader.onerror = () => toast.error("头像读取失败");
    reader.readAsDataURL(file);
  }

  async function handleSaveProfile() {
    if (!canEditAccountFields || !user) { toast.error("超级管理员只允许修改头像"); return; }
    const nextEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) { toast.error("邮箱格式不正确"); return; }
    setSavingProfile(true);
    try {
      await updateProfile({ name: user.name, email: nextEmail });
      await refreshUser();
      toast.success("邮箱已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "邮箱保存失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSavePassword() {
    if (!canEditAccountFields) { toast.error("超级管理员只允许修改头像"); return; }
    if (!passwordForm.oldPassword.trim()) { toast.error("请输入当前密码"); return; }
    if (passwordForm.password.length < 8) { toast.error("新密码至少需要 8 位"); return; }
    if (passwordForm.password !== passwordForm.confirmPassword) { toast.error("两次输入的新密码不一致"); return; }
    setSavingPassword(true);
    try {
      await updatePassword(passwordForm.oldPassword, passwordForm.password);
      setPasswordForm({ oldPassword: "", password: "", confirmPassword: "" });
      toast.success("密码已修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setSavingPassword(false);
    }
  }

  const statusTiles = [
    { label: "登录账号", value: user?.username ?? user?.email?.split("@")[0] ?? "-", icon: User },
    { label: "权限范围", value: permissionSummary, icon: Gauge },
    { label: "账号 ID", value: user?.id?.slice(-8) ?? "-", icon: Fingerprint },
  ];

  const inputClass =
    "h-12 w-full rounded-[8px] border border-border bg-surface-container-lowest px-3.5 text-sm font-semibold text-on-surface outline-none transition placeholder:text-on-surface-variant/70 hover:border-primary/25 focus:border-primary/40 focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant/60 disabled:hover:border-border";

  const primaryButtonClass =
    "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-blue-800 hover:shadow-[0_10px_22px_rgba(30,64,175,0.24)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none";

  return (
    <motion.div
      initial={shouldReduceMotion ? false : "hidden"}
      animate="visible"
      variants={pageMotion}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="space-y-5"
    >
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[8px] border border-border bg-[linear-gradient(135deg,var(--surface-container-lowest)_0%,var(--surface-container-low)_54%,var(--primary-container)_100%)] shadow-[0_24px_64px_rgba(30,64,175,0.1)]">
        {/* grid bg */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(30,64,175,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(30,64,175,0.04)_1px,transparent_1px)] bg-[size:42px_42px] [mask-image:linear-gradient(90deg,black,transparent_80%)]" />
        {/* shimmer */}
        <motion.div
          aria-hidden="true"
          animate={shouldReduceMotion ? undefined : { x: ["-20%", "120%"] }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          className="absolute inset-y-0 left-0 w-1/4 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--primary)_11%,transparent),transparent)]"
        />
        {/* top accent line */}
        <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--primary),var(--chart-2),var(--chart-4),transparent)]" />

        <div className="relative grid xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* left: identity */}
          <div className="flex flex-col gap-7 p-7 md:p-9">
            {/* badge */}
            <div className="inline-flex w-fit items-center gap-2 rounded-[8px] border border-primary/15 bg-primary-container/60 px-3 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-on-primary-container backdrop-blur-xl">
              <Cpu className="h-3.5 w-3.5" />
              Identity Console
            </div>

            {/* avatar + name */}
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
              {/* avatar */}
              <motion.div
                whileHover={shouldReduceMotion ? undefined : { y: -4, scale: 1.015 }}
                transition={{ type: "spring", stiffness: 270, damping: 20 }}
                className="relative w-fit shrink-0"
              >
                <div className="absolute -inset-1 rounded-[10px] bg-[linear-gradient(135deg,var(--primary),var(--chart-2),var(--chart-4))] opacity-65 blur-[2px]" />
                <div className="relative flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[9px] border border-white/80 bg-white/90 text-4xl font-black text-primary shadow-[0_20px_48px_rgba(30,64,175,0.16)]">
                  {avatar ? <img src={avatar} alt="当前头像" className="h-full w-full object-cover" /> : initials(user?.name)}
                </div>
                <motion.button
                  type="button"
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.93 }}
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-3 -right-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(30,64,175,0.28)] transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
                  aria-label="上传头像"
                >
                  <Camera className="h-4 w-4" />
                </motion.button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
              </motion.div>

              {/* name + role + email badges */}
              <div className="min-w-0 pb-1">
                <div className="inline-flex items-center gap-1.5 rounded-[6px] border border-primary/12 bg-white/60 px-2.5 py-1 text-xs font-bold text-on-surface-variant backdrop-blur">
                  <UserRound className="h-3.5 w-3.5" />
                  只读身份名称
                </div>
                <h2 className="mt-2 max-w-[600px] truncate text-[2rem] font-black leading-tight tracking-tight text-on-surface md:text-4xl">
                  {user?.name ?? "未登录用户"}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-primary/15 bg-primary-container/70 px-2.5 py-1.5 text-sm font-semibold text-on-primary-container backdrop-blur">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    {roleLabel}
                  </span>
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] border border-border/80 bg-white/75 px-2.5 py-1.5 text-sm font-semibold text-on-surface backdrop-blur">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-chart-4" />
                    <span className="truncate">{user?.email ?? "未绑定邮箱"}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* stat tiles */}
            <motion.div variants={staggerMotion} className="grid max-w-2xl gap-3 sm:grid-cols-3">
              {statusTiles.map((item) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.label}
                    variants={itemMotion}
                    whileHover={shouldReduceMotion ? undefined : { y: -3 }}
                    className="rounded-[8px] border border-border/80 bg-white/70 px-4 py-3.5 shadow-sm backdrop-blur-xl transition hover:border-primary/20 hover:bg-white/88"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-on-surface-variant">{item.label}</span>
                      <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    </div>
                    <div className="mt-2 truncate text-xl font-black text-on-surface">{item.value}</div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>

          {/* right: policy */}
          <aside className="flex flex-col gap-3 border-t border-border bg-white/48 p-6 backdrop-blur-2xl xl:border-l xl:border-t-0">
            {/* policy card */}
            <div className="rounded-[8px] border border-border/80 bg-white/86 p-5 shadow-[0_10px_24px_rgba(30,64,175,0.07),inset_0_1px_0_rgba(255,255,255,0.8)]">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border ${
                    isSuperAdmin
                      ? "border-orange/25 bg-orange/10 text-orange"
                      : "border-primary/20 bg-primary-container text-primary"
                  }`}
                >
                  {isSuperAdmin ? <ShieldAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-black text-on-surface">
                    {isSuperAdmin ? "超级管理员锁定策略" : "资料可维护"}
                  </div>
                  <p className="mt-1.5 text-xs leading-[1.6] text-on-surface-variant">
                    {isSuperAdmin
                      ? "该账号仅允许修改头像。邮箱和密码在个人中心保持锁定，名称作为身份标识只读展示。"
                      : "名称作为身份标识只读展示，你可以维护头像、邮箱和登录密码。"}
                  </p>
                </div>
              </div>
              {/* progress */}
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-container-high">
                <motion.div
                  className={`h-full rounded-full ${isSuperAdmin ? "bg-[linear-gradient(90deg,var(--orange),var(--chart-2))]" : "bg-[linear-gradient(90deg,var(--primary),var(--chart-2),var(--chart-4))]"}`}
                  initial={{ width: 0 }}
                  animate={{ width: isSuperAdmin ? "38%" : "76%" }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.72, ease: "easeOut" }}
                />
              </div>
            </div>

            {/* note */}
            <div className="rounded-[8px] border border-primary/13 bg-primary-container/52 px-4 py-3 text-xs leading-[1.6] text-on-primary-container">
              个人中心只处理个人资料；超级管理员敏感字段需通过账号治理流程变更。
            </div>

            {/* reset avatar btn */}
            {avatar ? (
              <motion.button
                type="button"
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                onClick={() => { if (!user) return; clearStoredUserAvatar(user.id); toast.success("头像已恢复为默认样式"); }}
                className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-primary/15 bg-white/80 px-3 text-sm font-bold text-primary backdrop-blur transition hover:border-primary/25 hover:bg-primary-container focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
              >
                <RotateCcw className="h-4 w-4" />
                恢复默认头像
              </motion.button>
            ) : null}
          </aside>
        </div>
      </section>

      {/* ── Form Cards ──────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Contact info card */}
        <motion.section
          initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.28 }}
          className="flex flex-col overflow-hidden rounded-[8px] border border-border bg-surface-container-lowest shadow-[0_14px_38px_rgba(30,64,175,0.065)]"
        >
          {/* header */}
          <div className="flex items-center gap-3.5 border-b border-border bg-[linear-gradient(180deg,var(--surface-container-lowest),var(--primary-container)/40%)] px-6 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(30,64,175,0.2)]">
              <AtSign className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-on-surface">联系方式</h3>
              <p className="text-xs text-on-surface-variant">用于系统通知、审批提醒和账号找回</p>
            </div>
          </div>

          {/* body */}
          <div className="flex flex-1 flex-col gap-4 p-6">
            {/* name read-only */}
            <div className="flex items-center gap-3 rounded-[8px] border border-border bg-surface-container-low px-4 py-3">
              <UserRound className="h-4 w-4 shrink-0 text-on-surface-variant" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-on-surface-variant">姓名</div>
                <div className="mt-0.5 truncate text-sm font-bold text-on-surface">{user?.name ?? "-"}</div>
              </div>
              <span className="rounded-[5px] border border-border bg-surface-container px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-on-surface-variant">
                只读
              </span>
            </div>

            {/* email */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="profile-email">邮箱地址</FieldLabel>
              <input
                id="profile-email"
                type="email"
                className={inputClass}
                value={email}
                disabled={!canEditAccountFields || savingProfile}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="请输入邮箱地址"
              />
              {isSuperAdmin ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-600">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  超级管理员邮箱已锁定，只可修改头像
                </p>
              ) : (
                <p className="text-xs text-on-surface-variant">保存后页面顶部用户信息会同步刷新</p>
              )}
            </div>

            {/* save btn */}
            <div className="mt-auto flex justify-end pt-1">
              <motion.button
                type="button"
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                onClick={() => void handleSaveProfile()}
                disabled={saveEmailDisabled}
                className={primaryButtonClass}
              >
                <Save className="h-4 w-4" />
                {savingProfile ? "保存中…" : "保存邮箱"}
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* Password card */}
        <motion.section
          initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.28 }}
          className="flex flex-col overflow-hidden rounded-[8px] border border-border bg-surface-container-lowest shadow-[0_14px_38px_rgba(30,64,175,0.065)]"
        >
          {/* header */}
          <div className="flex items-center gap-3.5 border-b border-border bg-[linear-gradient(180deg,var(--surface-container-lowest),var(--primary-container)/40%)] px-6 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(30,64,175,0.2)]">
              <LockKeyhole className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-on-surface">密码安全</h3>
              <p className="text-xs text-on-surface-variant">新密码至少 8 位，两次输入需一致</p>
            </div>
          </div>

          {/* body */}
          <div className="flex flex-1 flex-col gap-4 p-6">
            {/* current password */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="profile-old-password">当前密码</FieldLabel>
              <div className="relative">
                <input
                  id="profile-old-password"
                  type={showOldPassword ? "text" : "password"}
                  className={`${inputClass} pr-11`}
                  value={passwordForm.oldPassword}
                  disabled={!canEditAccountFields || savingPassword}
                  onChange={(event) => setPasswordForm((cur) => ({ ...cur, oldPassword: event.target.value }))}
                  autoComplete="current-password"
                  placeholder="请输入当前密码"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[8px] text-on-surface-variant transition hover:bg-primary-container hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
                  aria-label={showOldPassword ? "隐藏密码" : "显示密码"}
                >
                  {showOldPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* new password */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="profile-password">新密码</FieldLabel>
              <div className="relative">
                <input
                  id="profile-password"
                  type={showPassword ? "text" : "password"}
                  className={`${inputClass} pr-11`}
                  value={passwordForm.password}
                  disabled={!canEditAccountFields || savingPassword}
                  onChange={(event) => setPasswordForm((cur) => ({ ...cur, password: event.target.value }))}
                  autoComplete="new-password"
                  placeholder="请输入新密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[8px] text-on-surface-variant transition hover:bg-primary-container hover:text-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* strength meter */}
              {passwordForm.password && (
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="flex flex-1 gap-1">
                    {([1, 2, 3] as const).map((seg) => (
                      <div
                        key={seg}
                        className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                          pwdStrength.level >= seg ? pwdStrength.barClass : "bg-surface-container-high"
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`text-xs font-bold ${pwdStrength.textClass}`}>{pwdStrength.label}</span>
                </div>
              )}
            </div>

            {/* confirm password */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="profile-password-confirm">确认新密码</FieldLabel>
              <input
                id="profile-password-confirm"
                type={showPassword ? "text" : "password"}
                className={`${inputClass} ${pwdMismatch ? "border-destructive/60 focus:border-destructive/70 focus:ring-destructive/10" : ""}`}
                value={passwordForm.confirmPassword}
                disabled={!canEditAccountFields || savingPassword}
                onChange={(event) => setPasswordForm((cur) => ({ ...cur, confirmPassword: event.target.value }))}
                autoComplete="new-password"
                placeholder="请再次输入新密码"
              />
              {pwdMismatch && (
                <p className="text-xs text-destructive">两次密码不一致</p>
              )}
            </div>

            {/* submit btn */}
            <div className="mt-auto flex justify-end pt-1">
              <motion.button
                type="button"
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                onClick={() => void handleSavePassword()}
                disabled={!canEditAccountFields || savingPassword}
                className={primaryButtonClass}
              >
                <KeyRound className="h-4 w-4" />
                {savingPassword ? "修改中…" : "修改密码"}
              </motion.button>
            </div>
          </div>
        </motion.section>
      </div>
    </motion.div>
  );
}
