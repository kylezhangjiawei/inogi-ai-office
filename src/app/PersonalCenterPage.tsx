import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Button } from "./components/ui/button";
import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AtSign,
  Camera,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Gauge,
  Images,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Upload,
  User,
  UserRound,
} from "lucide-react";

import { getRoleLabel, useAuth } from "./auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import {
  HorizonEmptyState,
  HorizonMetric,
  HorizonMetricGrid,
  HorizonPageHeader,
  HorizonSectionHeader,
} from "./components/horizon/HorizonPage";
import { cn } from "./components/ui/utils";
import { authFetch, readErrorMessage } from "./lib/authSession";
import { clearStoredUserAvatar, useUserAvatar } from "./lib/userAvatar";
import { Input } from "./components/ui/input";

type AvatarPreset = { key: string; url: string };
type ProfileErrors = { englishName?: string; email?: string };
type PasswordErrors = { oldPassword?: string; password?: string; confirmPassword?: string };

function initials(name?: string | null) {
  return name?.trim().slice(0, 1) || "U";
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-700">{children}</label>;
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="text-xs font-medium text-rose-600" role="alert">{children}</p>;
}

function getPasswordStrength(password: string): { level: 0 | 1 | 2 | 3; label: string; barClass: string; textClass: string } {
  if (!password) return { level: 0, label: "", barClass: "", textClass: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { level: 1, label: "弱", barClass: "bg-rose-500", textClass: "text-rose-600" };
  if (score <= 2) return { level: 2, label: "中", barClass: "bg-amber-400", textClass: "text-amber-600" };
  return { level: 3, label: "强", barClass: "bg-emerald-500", textClass: "text-emerald-600" };
}

async function updateProfile(payload: { name: string; englishName: string; email: string }) {
  const response = await authFetch("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "个人资料保存失败"));
}

async function uploadMyAvatar(file: File): Promise<{ avatarUrl: string | null }> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await authFetch("/api/auth/me/avatar", { method: "POST", body: formData });
  if (!response.ok) throw new Error(await readErrorMessage(response, "头像上传失败"));
  return response.json() as Promise<{ avatarUrl: string | null }>;
}

async function resetMyAvatar(): Promise<void> {
  const response = await authFetch("/api/auth/me/avatar", { method: "DELETE" });
  if (!response.ok) throw new Error(await readErrorMessage(response, "头像重置失败"));
}

async function fetchAvatarPresets(): Promise<AvatarPreset[]> {
  const response = await authFetch("/api/auth/avatar-presets");
  if (!response.ok) throw new Error(await readErrorMessage(response, "默认头像加载失败"));
  return response.json() as Promise<AvatarPreset[]>;
}

async function setMyAvatarPreset(key: string): Promise<{ avatarUrl: string | null }> {
  const response = await authFetch("/api/auth/me/avatar/preset", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "头像设置失败"));
  return response.json() as Promise<{ avatarUrl: string | null }>;
}

async function updatePassword(oldPassword: string, newPassword: string) {
  const response = await authFetch("/api/auth/me/password", {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!response.ok) throw new Error(await readErrorMessage(response, "密码修改失败"));
}

export function PersonalCenterPage() {
  const { user, refreshUser } = useAuth();
  const avatar = useUserAvatar(user?.id);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const avatarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const englishNameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const oldPasswordRef = useRef<HTMLInputElement | null>(null);
  const newPasswordRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

  const [email, setEmail] = useState(user?.email ?? "");
  const [englishName, setEnglishName] = useState(user?.englishName ?? "");
  const [passwordForm, setPasswordForm] = useState({ oldPassword: "", password: "", confirmPassword: "" });
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [resettingAvatar, setResettingAvatar] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarActionError, setAvatarActionError] = useState("");
  const [selectingPreset, setSelectingPreset] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);

  const isSuperAdmin = Boolean(user?.permissions.includes("*"));
  const canEditAccountFields = Boolean(user) && !isSuperAdmin;
  const canEditEnglishName = Boolean(user);
  const roleLabel = getRoleLabel(user?.roleName);
  const permissionSummary = useMemo(() => {
    if (!user) return "0";
    if (user.permissions.includes("*")) return "全部";
    return String(user.permissions.length);
  }, [user]);
  const profileUnchanged = email.trim() === (user?.email ?? "") && englishName.trim() === (user?.englishName ?? "");
  const pwdStrength = getPasswordStrength(passwordForm.password);
  const livePasswordMismatch = Boolean(passwordForm.confirmPassword && passwordForm.password !== passwordForm.confirmPassword);
  const confirmPasswordError = passwordErrors.confirmPassword ?? (livePasswordMismatch ? "两次输入的新密码不一致" : "");

  React.useEffect(() => {
    setEmail(user?.email ?? "");
    setEnglishName(user?.englishName ?? "");
    setProfileErrors({});
  }, [user?.email, user?.englishName]);

  function openAvatarDialog() {
    setAvatarActionError("");
    setAvatarDialogOpen(true);
  }

  async function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user || uploadingAvatar) return;
    if (!file.type.startsWith("image/")) {
      setAvatarActionError("请选择 jpg、png、webp 或 gif 图片文件。");
      return;
    }
    if (file.size > 1024 * 1024 * 10) {
      setAvatarActionError("头像图片不能超过 10MB。");
      return;
    }
    setAvatarActionError("");
    setUploadingAvatar(true);
    try {
      await uploadMyAvatar(file);
      clearStoredUserAvatar(user.id);
      await refreshUser();
      setAvatarDialogOpen(false);
      toast.success("头像已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "头像上传失败";
      setAvatarActionError(message);
      toast.error(message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSelectPreset(key: string) {
    if (!user || selectingPreset) return;
    setAvatarActionError("");
    setSelectingPreset(key);
    try {
      await setMyAvatarPreset(key);
      clearStoredUserAvatar(user.id);
      await refreshUser();
      setAvatarDialogOpen(false);
      toast.success("头像已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "头像设置失败";
      setAvatarActionError(message);
      toast.error(message);
    } finally {
      setSelectingPreset(null);
    }
  }

  async function handleResetAvatar() {
    if (!user || resettingAvatar) return;
    setResettingAvatar(true);
    try {
      await resetMyAvatar();
      clearStoredUserAvatar(user.id);
      await refreshUser();
      toast.success("头像已恢复为默认样式");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "头像重置失败");
    } finally {
      setResettingAvatar(false);
    }
  }

  async function handleSaveProfile() {
    if (!canEditEnglishName || !user) return;
    const nextEmail = email.trim();
    const nextEnglishName = englishName.trim();
    const nextErrors: ProfileErrors = {};
    if (nextEnglishName.length > 80) nextErrors.englishName = "英文名不能超过 80 个字符。";
    if (canEditAccountFields && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) nextErrors.email = "请输入有效的邮箱地址。";
    setProfileErrors(nextErrors);
    if (nextErrors.englishName || nextErrors.email) {
      window.requestAnimationFrame(() => (nextErrors.englishName ? englishNameRef.current : emailRef.current)?.focus());
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        name: user.name,
        englishName: nextEnglishName,
        email: user.permissions.includes("*") ? user.email : nextEmail,
      });
      await refreshUser();
      toast.success("个人资料已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "个人资料保存失败");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSavePassword() {
    if (!canEditAccountFields) return;
    const nextErrors: PasswordErrors = {};
    if (!passwordForm.oldPassword.trim()) nextErrors.oldPassword = "请输入当前密码。";
    if (passwordForm.password.length < 8) nextErrors.password = "新密码至少需要 8 位。";
    if (passwordForm.password !== passwordForm.confirmPassword) nextErrors.confirmPassword = "两次输入的新密码不一致。";
    setPasswordErrors(nextErrors);
    if (nextErrors.oldPassword || nextErrors.password || nextErrors.confirmPassword) {
      window.requestAnimationFrame(() => {
        if (nextErrors.oldPassword) oldPasswordRef.current?.focus();
        else if (nextErrors.password) newPasswordRef.current?.focus();
        else confirmPasswordRef.current?.focus();
      });
      return;
    }
    setSavingPassword(true);
    try {
      await updatePassword(passwordForm.oldPassword, passwordForm.password);
      setPasswordForm({ oldPassword: "", password: "", confirmPassword: "" });
      setPasswordErrors({});
      toast.success("密码已修改");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setSavingPassword(false);
    }
  }

  const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-900 outline-none transition-colors placeholder:text-muted-foreground hover:border-slate-300 focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
  const primaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/25 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <main className="horizon-theme hz-page mx-auto flex min-h-full w-full max-w-[1600px] min-w-0 flex-col gap-4 px-3 py-4 sm:p-5 lg:p-6">
      <HorizonPageHeader
        Icon={UserRound}
        eyebrow="ACCOUNT · PERSONAL CENTER"
        title="个人中心"
        description="维护个人头像、英文名、联系邮箱与登录密码，敏感字段继续遵循账号治理策略。"
        meta={(
          <>
            <span>{user?.name ?? "未登录用户"}</span>
            <span aria-hidden="true">·</span>
            <span>{roleLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{user?.email ?? "未绑定邮箱"}</span>
          </>
        )}
      />

      <HorizonMetricGrid className="!grid-cols-2 xl:!grid-cols-4">
        <HorizonMetric Icon={User} label="登录账号" value={user?.username ?? user?.email?.split("@")[0] ?? "—"} note={user?.id ? `ID · ${user.id.slice(-8)}` : "等待账号信息"} tone="brand" />
        <HorizonMetric Icon={ShieldCheck} label="账号角色" value={user ? roleLabel : "—"} note={isSuperAdmin ? "超级管理员治理策略" : "按角色继承访问范围"} tone={isSuperAdmin ? "warning" : "success"} />
        <HorizonMetric Icon={Gauge} label="权限范围" value={user ? permissionSummary : "—"} note={isSuperAdmin ? "拥有全部系统权限" : `${user?.permissions.length ?? 0} 项已授权权限`} tone="neutral" />
        <HorizonMetric Icon={LockKeyhole} label="资料与安全" value={user ? (isSuperAdmin ? "受保护" : "可维护") : "—"} note={user?.hasCustomAvatar ? "已设置自定义头像" : "使用系统头像"} tone={isSuperAdmin ? "warning" : "success"} />
      </HorizonMetricGrid>

      {!user ? (
        <section className="hz-surface">
          <HorizonEmptyState Icon={UserRound} title="尚未读取到账号信息" description="请重新登录后再维护个人资料。" />
        </section>
      ) : (
        <>
          <section className="hz-surface overflow-hidden">
            <HorizonSectionHeader
              Icon={Fingerprint}
              title="身份概览"
              description="身份名称和角色来自组织账号，头像与允许的个人字段可在本页维护。"
              trailing={isSuperAdmin ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">敏感字段受保护</span> : null}
            />
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)] lg:items-center lg:p-6">
              <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-center">
                <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-primary shadow-sm">
                  <div className="flex size-full items-center justify-center text-3xl font-bold">
                    {avatar ? <img src={avatar} alt="当前头像" className="size-full object-cover" /> : initials(user.name)}
                  </div>
                  {(uploadingAvatar || resettingAvatar) ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-900/65 text-white" role="status">
                      <Loader2 className="size-5 animate-spin" />
                      <span className="text-xs">{uploadingAvatar ? "上传中" : "重置中"}</span>
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-balance text-2xl font-semibold text-slate-950">{user.name}</h2>
                  <p className="mt-1 truncate text-sm text-slate-500">{englishName.trim() || "暂未设置英文名"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary"><ShieldCheck className="size-3.5" />{roleLabel}</span>
                    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"><Mail className="size-3.5 shrink-0" /><span className="truncate">{user.email || "未绑定邮箱"}</span></span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                <Button variant="unstyled" ref={avatarTriggerRef} type="button" onClick={openAvatarDialog} disabled={uploadingAvatar || resettingAvatar} className={primaryButtonClass}>
                  <Camera className="size-4" />更换头像
                </Button>
                {user.hasCustomAvatar ? (
                  <Button variant="unstyled" type="button" onClick={() => void handleResetAvatar()} disabled={uploadingAvatar || resettingAvatar} className={secondaryButtonClass}>
                    {resettingAvatar ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                    恢复默认
                  </Button>
                ) : null}
              </div>
            </div>
            <div className={cn("border-t px-5 py-3 text-xs leading-5 lg:px-6", isSuperAdmin ? "border-amber-100 bg-amber-50 text-amber-800" : "border-blue-100 bg-blue-50 text-blue-800")}>
              {isSuperAdmin
                ? "超级管理员可修改头像和英文名；中文姓名、邮箱与密码需通过账号治理流程变更。"
                : "中文姓名和角色由组织账号统一管理；本人可维护头像、英文名、邮箱与登录密码。"}
            </div>
          </section>

          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            <form className="hz-surface flex min-w-0 flex-col overflow-hidden" onSubmit={(event) => { event.preventDefault(); void handleSaveProfile(); }} noValidate>
              <HorizonSectionHeader Icon={AtSign} title="个人资料" description="用于英文界面、系统通知、审批提醒和账号找回。" />
              <div className="flex flex-1 flex-col gap-5 p-5 lg:p-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-500">中文姓名</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold text-slate-900">{user.name}</span>
                    <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">只读</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="profile-english-name">英文名</FieldLabel>
                  <Input
                    ref={englishNameRef}
                    id="profile-english-name"
                    type="text"
                    className={cn(inputClass, profileErrors.englishName && "border-rose-300 focus:border-rose-400 focus:ring-rose-100")}
                    value={englishName}
                    maxLength={80}
                    disabled={!canEditEnglishName || savingProfile}
                    onChange={(event) => { setEnglishName(event.target.value); setProfileErrors((current) => ({ ...current, englishName: undefined })); }}
                    placeholder="留空保存后由系统自动生成"
                    autoComplete="name"
                    aria-invalid={Boolean(profileErrors.englishName)}
                    aria-describedby={profileErrors.englishName ? "profile-english-name-error" : "profile-english-name-help"}
                  />
                  {profileErrors.englishName ? <FieldError id="profile-english-name-error">{profileErrors.englishName}</FieldError> : <p id="profile-english-name-help" className="text-xs text-slate-500">用于英文界面和对外资料展示，可随时修改。</p>}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="profile-email">邮箱地址</FieldLabel>
                  <Input
                    ref={emailRef}
                    id="profile-email"
                    type="email"
                    className={cn(inputClass, profileErrors.email && "border-rose-300 focus:border-rose-400 focus:ring-rose-100")}
                    value={email}
                    disabled={!canEditAccountFields || savingProfile}
                    onChange={(event) => { setEmail(event.target.value); setProfileErrors((current) => ({ ...current, email: undefined })); }}
                    placeholder="请输入邮箱地址"
                    autoComplete="email"
                    aria-invalid={Boolean(profileErrors.email)}
                    aria-describedby={profileErrors.email ? "profile-email-error" : "profile-email-help"}
                  />
                  {profileErrors.email ? <FieldError id="profile-email-error">{profileErrors.email}</FieldError> : (
                    <p id="profile-email-help" className={cn("flex items-center gap-1.5 text-xs", isSuperAdmin ? "text-amber-700" : "text-slate-500")}>
                      {isSuperAdmin ? <ShieldAlert className="size-3.5 shrink-0" /> : null}
                      {isSuperAdmin ? "超级管理员邮箱已锁定。" : "保存后顶部账号信息会同步刷新。"}
                    </p>
                  )}
                </div>

                <div className="mt-auto flex justify-end pt-1">
                  <Button variant="unstyled" type="submit" disabled={!canEditEnglishName || savingProfile || profileUnchanged} className={primaryButtonClass}>
                    {savingProfile ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {savingProfile ? "保存中" : "保存资料"}
                  </Button>
                </div>
              </div>
            </form>

            <form className="hz-surface flex min-w-0 flex-col overflow-hidden" onSubmit={(event) => { event.preventDefault(); void handleSavePassword(); }} noValidate>
              <HorizonSectionHeader Icon={LockKeyhole} title="密码安全" description="新密码至少 8 位；建议组合大小写字母、数字和符号。" />
              <div className="flex flex-1 flex-col gap-5 p-5 lg:p-6">
                {isSuperAdmin ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                    超级管理员密码在个人中心保持锁定，请通过账号治理流程修改。
                  </div>
                ) : null}

                <div className="space-y-2">
                  <FieldLabel htmlFor="profile-old-password">当前密码</FieldLabel>
                  <div className="relative">
                    <Input
                      ref={oldPasswordRef}
                      id="profile-old-password"
                      type={showOldPassword ? "text" : "password"}
                      className={cn(inputClass, "pr-11", passwordErrors.oldPassword && "border-rose-300 focus:border-rose-400 focus:ring-rose-100")}
                      value={passwordForm.oldPassword}
                      disabled={!canEditAccountFields || savingPassword}
                      onChange={(event) => { setPasswordForm((current) => ({ ...current, oldPassword: event.target.value })); setPasswordErrors((current) => ({ ...current, oldPassword: undefined })); }}
                      autoComplete="current-password"
                      placeholder="请输入当前密码"
                      aria-invalid={Boolean(passwordErrors.oldPassword)}
                      aria-describedby={passwordErrors.oldPassword ? "profile-old-password-error" : undefined}
                    />
                    <Button variant="unstyled" type="button" onClick={() => setShowOldPassword((value) => !value)} disabled={!canEditAccountFields || savingPassword} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" aria-label={showOldPassword ? "隐藏当前密码" : "显示当前密码"} aria-pressed={showOldPassword}>
                      {showOldPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  {passwordErrors.oldPassword ? <FieldError id="profile-old-password-error">{passwordErrors.oldPassword}</FieldError> : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="profile-password">新密码</FieldLabel>
                  <div className="relative">
                    <Input
                      ref={newPasswordRef}
                      id="profile-password"
                      type={showPassword ? "text" : "password"}
                      className={cn(inputClass, "pr-11", passwordErrors.password && "border-rose-300 focus:border-rose-400 focus:ring-rose-100")}
                      value={passwordForm.password}
                      disabled={!canEditAccountFields || savingPassword}
                      onChange={(event) => { setPasswordForm((current) => ({ ...current, password: event.target.value })); setPasswordErrors((current) => ({ ...current, password: undefined, confirmPassword: undefined })); }}
                      autoComplete="new-password"
                      placeholder="请输入新密码"
                      aria-invalid={Boolean(passwordErrors.password)}
                      aria-describedby={passwordErrors.password ? "profile-password-error" : passwordForm.password ? "profile-password-strength" : undefined}
                    />
                    <Button variant="unstyled" type="button" onClick={() => setShowPassword((value) => !value)} disabled={!canEditAccountFields || savingPassword} className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-40" aria-label={showPassword ? "隐藏新密码" : "显示新密码"} aria-pressed={showPassword}>
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  {passwordErrors.password ? <FieldError id="profile-password-error">{passwordErrors.password}</FieldError> : null}
                  {passwordForm.password ? (
                    <div id="profile-password-strength" className="flex items-center gap-2" role="meter" aria-label={`密码强度：${pwdStrength.label}`} aria-valuemin={0} aria-valuemax={3} aria-valuenow={pwdStrength.level}>
                      <div className="flex flex-1 gap-1" aria-hidden="true">
                        {([1, 2, 3] as const).map((segment) => <span key={segment} className={cn("h-1 flex-1 rounded-full", pwdStrength.level >= segment ? pwdStrength.barClass : "bg-slate-200")} />)}
                      </div>
                      <span className={cn("text-xs font-semibold", pwdStrength.textClass)}>{pwdStrength.label}</span>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="profile-password-confirm">确认新密码</FieldLabel>
                  <Input
                    ref={confirmPasswordRef}
                    id="profile-password-confirm"
                    type={showPassword ? "text" : "password"}
                    className={cn(inputClass, confirmPasswordError && "border-rose-300 focus:border-rose-400 focus:ring-rose-100")}
                    value={passwordForm.confirmPassword}
                    disabled={!canEditAccountFields || savingPassword}
                    onChange={(event) => { setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value })); setPasswordErrors((current) => ({ ...current, confirmPassword: undefined })); }}
                    autoComplete="new-password"
                    placeholder="请再次输入新密码"
                    aria-invalid={Boolean(confirmPasswordError)}
                    aria-describedby={confirmPasswordError ? "profile-password-confirm-error" : undefined}
                  />
                  {confirmPasswordError ? <FieldError id="profile-password-confirm-error">{confirmPasswordError}</FieldError> : null}
                </div>

                <div className="mt-auto flex justify-end pt-1">
                  <Button variant="unstyled" type="submit" disabled={!canEditAccountFields || savingPassword} className={primaryButtonClass}>
                    {savingPassword ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    {savingPassword ? "修改中" : "修改密码"}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </>
      )}

      <Input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} disabled={uploadingAvatar || resettingAvatar} aria-label="上传头像文件" />

      <AvatarPickerDialog
        open={avatarDialogOpen}
        onOpenChange={(open) => { setAvatarDialogOpen(open); if (!open) setAvatarActionError(""); }}
        returnFocusRef={avatarTriggerRef}
        uploading={uploadingAvatar}
        selectingKey={selectingPreset}
        actionError={avatarActionError}
        onPickFile={() => fileInputRef.current?.click()}
        onSelectPreset={handleSelectPreset}
      />
    </main>
  );
}

function AvatarPickerDialog({
  open,
  onOpenChange,
  returnFocusRef,
  uploading,
  selectingKey,
  actionError,
  onPickFile,
  onSelectPreset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  uploading: boolean;
  selectingKey: string | null;
  actionError: string;
  onPickFile: () => void;
  onSelectPreset: (key: string) => void;
}) {
  const [tab, setTab] = useState<"upload" | "gallery">("upload");
  const [presets, setPresets] = useState<AvatarPreset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const loadedRef = useRef(false);

  const loadPresets = React.useCallback(() => {
    loadedRef.current = true;
    setLoading(true);
    setLoadError("");
    fetchAvatarPresets()
      .then((list) => setPresets(list))
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "默认头像加载失败");
        loadedRef.current = false;
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    if (open && tab === "gallery" && !loadedRef.current) loadPresets();
  }, [loadPresets, open, tab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="horizon-portal max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-slate-950"><Camera className="size-5 text-primary" />更换头像</DialogTitle>
          <DialogDescription>上传自定义图片，或从默认头像库中选择。</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as "upload" | "gallery")} className="min-h-0 gap-0">
        <TabsList aria-label="头像来源" className="h-auto w-full justify-start rounded-none border-b border-border bg-transparent px-4 pt-2">
          <TabsTrigger value="upload" className="min-h-10 flex-none"><Upload className="size-4" />上传自定义</TabsTrigger>
          <TabsTrigger value="gallery" className="min-h-10 flex-none"><Images className="size-4" />默认头像库</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {actionError ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{actionError}</div> : null}

          {tab === "upload" ? (
            <TabsContent value="upload" className="flex flex-col items-center gap-5 py-6 text-center">
              <span className="flex size-16 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-primary" aria-hidden="true"><Upload className="size-7" /></span>
              <div>
                <div className="text-sm font-semibold text-slate-900">上传你自己的图片</div>
                <p className="mt-1.5 max-w-sm text-pretty text-xs leading-5 text-slate-500">支持 jpg、png、webp、gif，单张不超过 10MB。图片将安全存储到 OSS。</p>
              </div>
              <Button type="button" onClick={onPickFile} disabled={uploading} size="lg">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {uploading ? "上传中" : "选择图片"}
              </Button>
            </TabsContent>
          ) : (
            <TabsContent value="gallery">
              {loading ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-slate-500" role="status"><Loader2 className="size-6 animate-spin text-primary" /><span className="text-sm">正在加载默认头像</span></div>
              ) : loadError ? (
                <div className="flex min-h-52 flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm text-rose-600" role="alert">{loadError}</p>
                  <Button variant="unstyled" type="button" onClick={loadPresets} className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-primary/25 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"><RotateCcw className="size-4" />重新加载</Button>
                </div>
              ) : presets?.length ? (
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6">
                  {presets.map((preset, index) => {
                    const busy = selectingKey === preset.key;
                    return (
                      <Button variant="unstyled" key={preset.key} type="button" onClick={() => onSelectPreset(preset.key)} disabled={Boolean(selectingKey)} aria-label={`选择默认头像 ${index + 1}`} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-60">
                        <img src={preset.url} alt={`默认头像 ${index + 1}`} loading="lazy" className="size-full object-cover" />
                        {busy ? <span className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-white" role="status"><Loader2 className="size-5 animate-spin" /></span> : <span className="absolute bottom-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true"><Check className="size-3.5" /></span>}
                      </Button>
                    );
                  })}
                </div>
              ) : (
                <HorizonEmptyState Icon={Images} title="暂无默认头像" description="请联系管理员上传预置头像，或改为上传自定义图片。" action={<Button variant="unstyled" type="button" onClick={() => setTab("upload")} className="text-sm font-semibold text-primary underline-offset-4 hover:underline">上传自定义图片</Button>} />
              )}
            </TabsContent>
          )}
        </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
