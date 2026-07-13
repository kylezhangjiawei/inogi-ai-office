import React, { useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import {
  AtSign,
  Camera,
  Check,
  CheckCircle2,
  Cpu,
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
  UserRound,
  User,
  X,
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
  // 注意：FormData 必须让浏览器自动设 boundary 的 Content-Type，authFetch 自动跳过 JSON 头
  const response = await authFetch("/api/auth/me/avatar", { method: "POST", body: formData });
  if (!response.ok) throw new Error(await readErrorMessage(response, "头像上传失败"));
  return response.json() as Promise<{ avatarUrl: string | null }>;
}

async function resetMyAvatar(): Promise<void> {
  const response = await authFetch("/api/auth/me/avatar", { method: "DELETE" });
  if (!response.ok) throw new Error(await readErrorMessage(response, "头像重置失败"));
}

type AvatarPreset = { key: string; url: string };

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

const pageMotion = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } };
const staggerMotion = { visible: { transition: { staggerChildren: 0.07 } } };
const itemMotion = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } };

export function PersonalCenterPage() {
  const { user, refreshUser } = useAuth();
  const avatar = useUserAvatar(user?.id);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState(user?.email ?? "");
  const [englishName, setEnglishName] = useState(user?.englishName ?? "");
  const [passwordForm, setPasswordForm] = useState({ oldPassword: "", password: "", confirmPassword: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  /** 头像上传中状态：用于禁用按钮 + 显示 spinner，让用户能感知请求进行/完成 */
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [resettingAvatar, setResettingAvatar] = useState(false);
  /** 头像选择弹窗（双 Tab：上传自定义 / 默认头像库） */
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  /** 正在设置的预置头像 key（用于在该卡片上显示 spinner） */
  const [selectingPreset, setSelectingPreset] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  const isSuperAdmin = Boolean(user?.permissions.includes("*"));
  const canEditAccountFields = Boolean(user) && !isSuperAdmin;
  const canEditEnglishName = Boolean(user);
  const roleLabel = getRoleLabel(user?.roleName);
  const permissionSummary = useMemo(() => {
    if (!user) return "0";
    if (user.permissions.includes("*")) return "全部";
    return String(user.permissions.length);
  }, [user]);
  const profileUnchanged =
    email.trim() === (user?.email ?? "") &&
    englishName.trim() === (user?.englishName ?? "");
  const saveProfileDisabled = !canEditEnglishName || savingProfile || profileUnchanged;
  const pwdStrength = getPasswordStrength(passwordForm.password);
  const pwdMismatch = Boolean(passwordForm.confirmPassword && passwordForm.password !== passwordForm.confirmPassword);

  React.useEffect(() => {
    setEmail(user?.email ?? "");
    setEnglishName(user?.englishName ?? "");
  }, [user?.email, user?.englishName]);

  async function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) { toast.error("请选择图片文件"); return; }
    if (file.size > 1024 * 1024 * 10) { toast.error("头像图片不能超过 10MB"); return; }
    if (uploadingAvatar) return; // 防止用户连点
    setUploadingAvatar(true);
    // 用 toast.promise 给用户全过程反馈：上传中 → 成功/失败
    try {
      await toast.promise(
        (async () => {
          // 上传到 OSS（后端 multer 接收 → uploadBuffer → 写 DB avatarObjectKey）
          await uploadMyAvatar(file);
          // 兼容历史 localStorage 缓存：清掉本地旧 dataURL，让 hook 走 user.avatarUrl
          clearStoredUserAvatar(user.id);
          // 重新拉 user，拿到带新 avatarUrl 的 profile（带签名 URL）
          await refreshUser();
        })(),
        {
          loading: "正在上传头像到 OSS…",
          success: "头像已更新",
          error: (err) => (err instanceof Error ? err.message : "头像上传失败"),
        },
      );
      setAvatarModalOpen(false);
    } finally {
      setUploadingAvatar(false);
    }
  }

  /** 选择某个预置头像：把当前用户 avatarObjectKey 设成该 key，再刷新 user 拿新签名 URL */
  async function handleSelectPreset(key: string) {
    if (!user || selectingPreset) return;
    setSelectingPreset(key);
    try {
      await toast.promise(
        (async () => {
          await setMyAvatarPreset(key);
          // 清掉历史本地缓存，让头像走 user.avatarUrl；并失效跨用户头像目录
          clearStoredUserAvatar(user.id);
          await refreshUser();
        })(),
        {
          loading: "正在设置头像…",
          success: "头像已更新",
          error: (err) => (err instanceof Error ? err.message : "头像设置失败"),
        },
      );
      setAvatarModalOpen(false);
    } finally {
      setSelectingPreset(null);
    }
  }

  async function handleSaveProfile() {
    if (!canEditEnglishName || !user) return;
    const nextEmail = email.trim();
    const nextEnglishName = englishName.trim();
    if (nextEnglishName.length > 80) { toast.error("英文名不能超过 80 个字符"); return; }
    if (canEditAccountFields && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      toast.error("邮箱格式不正确");
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({ name: user.name, englishName: nextEnglishName, email: user.permissions.includes("*") ? user.email : nextEmail });
      await refreshUser();
      toast.success("个人资料已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "个人资料保存失败");
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
    "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-[0_10px_22px_rgba(79,70,229,0.24)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none";

  return (
    <motion.div
      initial={shouldReduceMotion ? false : "hidden"}
      animate="visible"
      variants={pageMotion}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className="space-y-5"
    >
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-[8px] border border-border bg-[linear-gradient(135deg,var(--surface-container-lowest)_0%,var(--surface-container-low)_54%,var(--primary-container)_100%)] shadow-[0_24px_64px_rgba(79,70,229,0.1)]">
        {/* grid bg */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(79,70,229,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(79,70,229,0.04)_1px,transparent_1px)] bg-[size:42px_42px] [mask-image:linear-gradient(90deg,black,transparent_80%)]" />
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
                <div className="relative flex h-[110px] w-[110px] items-center justify-center overflow-hidden rounded-[9px] border border-white/80 bg-white/90 text-4xl font-black text-primary shadow-[0_20px_48px_rgba(79,70,229,0.16)]">
                  {avatar ? <img src={avatar} alt="当前头像" className="h-full w-full object-cover" /> : initials(user?.name)}
                  {/* 上传中遮罩：暗化头像 + 居中 spinner + 文案 */}
                  {(uploadingAvatar || resettingAvatar) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-slate-900/55 text-white backdrop-blur-[2px]">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-[10px] font-semibold tracking-wide">
                        {uploadingAvatar ? "上传中…" : "重置中…"}
                      </span>
                    </div>
                  )}
                </div>
                <motion.button
                  type="button"
                  whileTap={shouldReduceMotion || uploadingAvatar ? undefined : { scale: 0.93 }}
                  onClick={() => setAvatarModalOpen(true)}
                  disabled={uploadingAvatar || resettingAvatar}
                  className="absolute -bottom-3 -right-3 flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_24px_rgba(79,70,229,0.28)] transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="更换头像"
                  title={uploadingAvatar ? "上传中，请稍候" : "更换头像（上传或选择默认头像）"}
                >
                  {uploadingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </motion.button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFile}
                  disabled={uploadingAvatar || resettingAvatar}
                />
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
            <div className="rounded-[8px] border border-border/80 bg-white/86 p-5 shadow-[0_10px_24px_rgba(79,70,229,0.07)]">
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
                      ? "该账号可修改头像和英文名。中文姓名、邮箱和密码在个人中心保持锁定。"
                      : "中文姓名作为身份标识只读展示，你可以维护英文名、头像、邮箱和登录密码。"}
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
              英文名可由本人维护；留空保存时系统会自动生成。超级管理员的其他敏感字段仍需通过账号治理流程变更。
            </div>

            {/* reset avatar btn —— 仅当用户设过自定义头像时显示（清掉后回到自动派发的默认头像） */}
            {user?.hasCustomAvatar ? (
              <motion.button
                type="button"
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                onClick={async () => {
                  if (!user || resettingAvatar) return;
                  setResettingAvatar(true);
                  try {
                    await toast.promise(
                      (async () => {
                        await resetMyAvatar();
                        clearStoredUserAvatar(user.id);
                        await refreshUser();
                      })(),
                      {
                        loading: "正在恢复默认头像…",
                        success: "头像已恢复为默认样式",
                        error: (err) => (err instanceof Error ? err.message : "头像重置失败"),
                      },
                    );
                  } finally {
                    setResettingAvatar(false);
                  }
                }}
                disabled={resettingAvatar || uploadingAvatar}
                className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-primary/15 bg-white/80 px-3 text-sm font-bold text-primary backdrop-blur transition hover:border-primary/25 hover:bg-primary-container focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {resettingAvatar ? "恢复中…" : "恢复默认头像"}
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
          className="flex flex-col overflow-hidden rounded-[8px] border border-border bg-surface-container-lowest shadow-[0_14px_38px_rgba(79,70,229,0.065)]"
        >
          {/* header */}
          <div className="flex items-center gap-3.5 border-b border-border bg-[linear-gradient(180deg,var(--surface-container-lowest),var(--primary-container)/40%)] px-6 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.2)]">
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

            {/* editable English name */}
            <div className="space-y-1.5">
              <FieldLabel htmlFor="profile-english-name">英文名</FieldLabel>
              <input
                id="profile-english-name"
                type="text"
                className={inputClass}
                value={englishName}
                maxLength={80}
                disabled={!canEditEnglishName || savingProfile}
                onChange={(event) => setEnglishName(event.target.value)}
                placeholder="留空保存后由系统自动生成"
                autoComplete="name"
              />
              <p className="text-xs text-on-surface-variant">用于英文界面和对外资料展示，可随时修改</p>
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
                disabled={saveProfileDisabled}
                className={primaryButtonClass}
              >
                <Save className="h-4 w-4" />
                {savingProfile ? "保存中…" : "保存资料"}
              </motion.button>
            </div>
          </div>
        </motion.section>

        {/* Password card */}
        <motion.section
          initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.28 }}
          className="flex flex-col overflow-hidden rounded-[8px] border border-border bg-surface-container-lowest shadow-[0_14px_38px_rgba(79,70,229,0.065)]"
        >
          {/* header */}
          <div className="flex items-center gap-3.5 border-b border-border bg-[linear-gradient(180deg,var(--surface-container-lowest),var(--primary-container)/40%)] px-6 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.2)]">
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

      <AvatarPickerModal
        open={avatarModalOpen}
        onClose={() => setAvatarModalOpen(false)}
        uploading={uploadingAvatar}
        selectingKey={selectingPreset}
        onPickFile={() => fileInputRef.current?.click()}
        onSelectPreset={handleSelectPreset}
      />
    </motion.div>
  );
}

// ─── 头像选择弹窗 ───────────────────────────────────────────────────────────
// 双 Tab：① 上传自定义（触发父级隐藏 file input）② 默认头像库（OSS 预置缩略图网格）。
// 预置列表懒加载：仅当切到「默认头像库」Tab 时拉取一次，结果缓存在组件内（弹窗保持挂载）。

function AvatarPickerModal({
  open,
  onClose,
  uploading,
  selectingKey,
  onPickFile,
  onSelectPreset,
}: {
  open: boolean;
  onClose: () => void;
  uploading: boolean;
  selectingKey: string | null;
  onPickFile: () => void;
  onSelectPreset: (key: string) => void;
}) {
  const [tab, setTab] = useState<"upload" | "gallery">("upload");
  const [presets, setPresets] = useState<AvatarPreset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 是否已发起过加载：用 ref（不进 effect 依赖）避免「setLoading 触发 effect 重跑→清掉在飞请求」的自失效循环
  const loadedRef = React.useRef(false);

  const loadPresets = React.useCallback(() => {
    loadedRef.current = true;
    setLoading(true);
    setError(null);
    fetchAvatarPresets()
      .then((list) => setPresets(list))
      .catch((err) => {
        setError(err instanceof Error ? err.message : "默认头像加载失败");
        loadedRef.current = false; // 失败允许重试
      })
      .finally(() => setLoading(false));
  }, []);

  // 切到画廊 Tab 时懒加载一次（已加载过则跳过；弹窗保持挂载，缓存跨开关复用）
  React.useEffect(() => {
    if (open && tab === "gallery" && !loadedRef.current) loadPresets();
  }, [open, tab, loadPresets]);

  // Esc 关闭
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const retryLoad = () => loadPresets();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-[10px] border border-border bg-surface-container-lowest shadow-[0_32px_80px_rgba(15,23,42,0.28)]">
        {/* header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-[0_8px_18px_rgba(79,70,229,0.2)]">
              <Camera className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-on-surface">更换头像</h3>
              <p className="text-xs text-on-surface-variant">上传自定义图片，或从默认头像库中选择</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 border-b border-border px-4 pt-3">
          {([
            { id: "upload" as const, label: "上传自定义", icon: Upload },
            { id: "gallery" as const, label: "默认头像库", icon: Images },
          ]).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 rounded-t-[8px] px-4 py-2.5 text-sm font-bold transition ${
                  active
                    ? "border-b-2 border-primary text-primary"
                    : "border-b-2 border-transparent text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "upload" ? (
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-[12px] border border-primary/15 bg-primary-container/60 text-primary">
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <div className="text-sm font-bold text-on-surface">上传你自己的图片</div>
                <p className="mt-1.5 max-w-sm text-xs leading-[1.7] text-on-surface-variant">
                  支持 jpg / png / webp / gif 格式，单张不超过 10MB。图片将安全存储到 OSS。
                </p>
              </div>
              <button
                type="button"
                onClick={onPickFile}
                disabled={uploading}
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "上传中…" : "选择图片"}
              </button>
            </div>
          ) : (
            <div>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-on-surface-variant">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-semibold">正在加载默认头像…</span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <p className="text-xs text-destructive">{error}</p>
                  <button
                    type="button"
                    onClick={retryLoad}
                    className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[8px] border border-border bg-surface-container-low px-4 text-xs font-bold text-on-surface transition hover:border-primary/25 hover:bg-primary-container"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重新加载
                  </button>
                </div>
              ) : presets && presets.length > 0 ? (
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
                  {presets.map((preset) => {
                    const busy = selectingKey === preset.key;
                    const disabled = Boolean(selectingKey);
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => onSelectPreset(preset.key)}
                        disabled={disabled}
                        title="选择此头像"
                        className="group relative aspect-square overflow-hidden rounded-[10px] border border-border bg-surface-container-low transition hover:border-primary hover:shadow-[0_8px_20px_rgba(79,70,229,0.18)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <img src={preset.url} alt="默认头像" loading="lazy" className="h-full w-full object-cover" />
                        {busy ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/55 text-white backdrop-blur-[1px]">
                            <Loader2 className="h-5 w-5 animate-spin" />
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-primary/0 opacity-0 transition group-hover:bg-primary/15 group-hover:opacity-100">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                              <Check className="h-4 w-4" />
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-on-surface-variant">
                  <Images className="h-8 w-8 opacity-40" />
                  <span className="text-xs">暂无默认头像，请联系管理员上传</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
