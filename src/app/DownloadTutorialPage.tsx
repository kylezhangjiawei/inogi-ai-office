import React from "react";
import { Apple, ArrowLeft, BookOpen, Download, Laptop, MonitorDown, Smartphone } from "lucide-react";
import { Link, Navigate, useParams } from "react-router";
import { toast } from "sonner";
import { cn } from "./components/ui/utils";
import { CLASH_SUBSCRIPTION_URL } from "./lib/appConfig";

type PlatformId = "windows" | "android" | "ios" | "mac";

type TutorialAction = {
  label: string;
  tone?: "primary" | "secondary";
  src?: string;
  value?: string;
};

type TutorialStep = {
  title: string;
  body: string | string[];
  actions?: TutorialAction[];
  note?: string;
  imageSrc?: string;
  imageAlt?: string;
  imageShape?: "desktop" | "phone" | "square";
  visual?: "logo" | "download-list" | "installer" | "subscription" | "proxy" | "settings" | "phone-settings" | "phone-list" | "mac-about" | "mac-profiles" | "mac-edit" | "mac-proxy" | "mac-home";
};

type PlatformConfig = {
  id: PlatformId;
  cardName: string;
  title: string;
  version: string;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
  shadow: string;
  accent: string;
  steps: TutorialStep[];
};

const platformConfigs: Record<PlatformId, PlatformConfig> = {
  windows: {
    id: "windows",
    cardName: "Windows",
    title: "Windows 使用教程",
    version: "适用于 Windows 7 或更高版本",
    gradient: "from-[#3f73d8] via-[#5ea7ed] to-[#79c0f7]",
    icon: MonitorDown,
    iconClass: "text-white/28",
    shadow: "shadow-[0_14px_26px_rgba(37,99,235,0.22)]",
    accent: "text-[#3949ab]",
    steps: [
      {
        title: "前提概要",
        body:
          "Clash Verge Rev 是一个基于 Clash Meta 内核的开源 Windows 客户端，在原来的 Clash For Windows 跑路之后，是目前为数不多的还在积极更新维护的 Clash 客户端。如果您的 Clash For Windows 还可以正常使用的话，可以继续使用。但如果你未安装过任何版本的Clash，又习惯了Clash的操作逻辑，那么你应该使用 Clash Verge Rev。",
        imageAlt: "Clash Verge Rev 应用图标",
        imageShape: "square",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/6690044fee301.png'
      },
      {
        title: "下载 Clash Verge Rev 客户端",
        body: [
          "Clash Verge Rev 仅通过 GitHub Release 发布，请注意辨别。如果无法访问Github，则应该使用分流下载。",
          "应该下载哪个文件？",
          "正常版本(推荐)",
          "64位: x64-setup.exe (e.g. Clash.Verge_2.4.3_x64-setup.exe)",
          "32位: x86-setup.exe",
          "arm64架构: arm64-setup.exe",
          "如果您的系统是企业版系统或Win7等无法安装webview2的系统，应下载带有_fixed_webview2字样的且对应架构的文件 (e.g. Clash.Verge_2.4.3_x64_fixed_webview2-setup.exe)",
        ],
        actions: [
          { label: "Github下载", tone: "primary" , src: 'https://github.com/clash-verge-rev/clash-verge-rev/releases' },
          { label: "分流下载", tone: "primary", src: 'https://dl.p6p.net/clash-verge/' },
        ],
        imageAlt: "Clash Verge Rev 下载列表截图",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/669015778f853.png'
      },
      {
        title: "安装客户端",
        body: "以Windows安装x64版本为例，只需要下一步、下一步直至安装完毕：",
        imageAlt: "Clash Verge Rev 安装向导截图",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/669010307024d.png'
      },
      {
        title: "导入订阅",
        body: [
          "打开客户端后，点击这个按钮 👇👇👇",
          "点击复制Clash 订阅链接，通过菜单中的“订阅”，将机场的订阅地址复制到里面，导入即可。",
          "导入成功后，在“订阅”中选中刚刚添加的节点",
        ],
        actions: [{ label: "复制订阅", tone: "primary", value: CLASH_SUBSCRIPTION_URL }],
        imageAlt: "Clash Verge Rev 订阅导入截图",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/669012ac4e624.png'
      },
      {
        title: "选择代理节点",
        body: [
          "通过菜单中的“代理”，选择任意一个可用的节点，点击将其激活。",
          "你可以点击Proxy下的第二个按钮测速后，再按第三个按钮，选择到“按延迟排序”。",
          "请确认您的系统时间与当地标准时间相差在30s以内，且时区为当地时区，否则无法连接。确认系统时间",
        ],
        imageAlt: "Clash Verge Rev 代理节点截图",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/669013eec1194.png'
      },
      {
        title: "开启系统代理",
        body: [
          "通过菜单中的“设置 - 系统设置”，将“系统代理”激活即可。如果不想使用代理，关闭即可。",
          "建议打开“开机自启”，否则如果您在关机前未关闭代理，可能导致下次开机时后无法正常上网，此时需要打开一下Clash Verge Rev或手动关闭系统代理才能恢复。",
        ],
        imageAlt: "Clash Verge Rev 系统代理设置截图",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2024/07/12/66901510bf7be.png'
      },
    ],
  },
  android: {
    id: "android",
    cardName: "Android",
    title: "Android 使用教程",
    version: "适用于 Android 5.0 或更高版本",
    gradient: "from-[#67ad3a] via-[#8fd34f] to-[#b1ef62]",
    icon: Smartphone,
    iconClass: "text-white/30",
    shadow: "shadow-[0_14px_26px_rgba(101,163,13,0.22)]",
    accent: "text-[#3949ab]",
    steps: [
      {
        title: "下载并安装客户端",
        body:
          "Clash Meta for Android 是 Android 平台客户端，支持多种代理协议、自定义规则和智能路由。请先下载并安装 Clash Meta for Android 客户端。",
        actions: [
          { label: "分流下载1", tone: "primary", src: 'https://dl.cdn-lax2.ifnf.xyz/ppp/dl/cmfa.apk' },
          { label: "分流下载2", tone: "primary", src: 'https://dl.p6p.net/ClashMetaForAndroid/cmfa-2.11.21-meta-universal-release.apk' },
          { label: "Github下载", tone: "primary", src: 'https://github.com/MetaCubeX/ClashMetaForAndroid/releases/download/v2.11.26/cmfa-2.11.26-meta-universal-release.apk' },
        ],
        imageAlt: "Clash Meta for Android 首页截图",
        imageShape: "phone",
        imageSrc: 'https://global.cdn.mikupics.cn/2026/04/08/69d64027ce18e.jpg'
      },
      {
        title: "配置订阅",
        body: "安装后点击下面按钮，将订阅配置导入到 Clash Meta for Android。",
        actions: [{ label: "复制订阅", tone: "primary", value: CLASH_SUBSCRIPTION_URL }],
        imageAlt: "Clash Meta for Android 配置页截图",
        imageShape: "phone",
        imageSrc: 'https://global.cdn.mikupics.cn/2026/04/08/69d6400e3f170.jpg'
      },
      {
        title: "启用代理",
        body: "在配置页选中刚保存的配置，回到首页点击启动代理，然后进入代理页选择要使用的节点，完成后即可开始上网。",
        imageAlt: "Clash Meta for Android 代理页截图",
        imageShape: "phone",
        imageSrc: 'https://global.cdn.mikupics.cn/2026/04/08/69d64029392b5.jpg'
      },
    ],
  },
  ios: {
    id: "ios",
    cardName: "Apple",
    title: "iOS 使用教程",
    version: "适用于 iOS 9 或更高版本",
    gradient: "from-[#050505] via-[#151515] to-[#333333]",
    icon: Apple,
    iconClass: "text-white/18",
    shadow: "shadow-[0_14px_26px_rgba(15,23,42,0.24)]",
    accent: "text-[#2f67c8]",
    steps: [
      {
        title: "安装 Shadowrocket",
        body: [
          "目前 Shadowrocket 已经根据政府要求从中国 App Store 移除，且由于 Apple 的双重认证策略，建议您自行注册而非购买外区的AppleID（港区，美区等）。再另外绑定付款方式或在下方购买Shadowrocket兑换码来下载使用。",
          "https://shop.hyacinth.cloud",
          "购买时请仔细阅读对应的说明文字和注意事项，选择最适合自己的商品进行购买。售后请联系对应网站负责人，低价软件有风险，本站不做任何担保。",
        ],
        actions: [{ label: "打开 App Store 下载", tone: "primary", src:'https://apps.apple.com/us/app/shadowrocket/id932747118' }],
        imageAlt: "Shadowrocket 应用图标",
        imageShape: "desktop",
        imageSrc: 'https://global.cdn.mikupics.cn/2021/01/09/c730192bed4c8.png'
      },
      {
        title: "订阅配置",
        body: [
          "软件安装完成后，点击这个按钮 👇👇👇，添加订阅。",
          "随后点击软件底部“设置”，往下划至最底部，进入“订阅”子页面，打开“打开时更新”。",
          "如果订阅失败，点击下方按钮，手动添加一个节点，确定连接上之后，再点击上方按钮添加订阅。",
        ],
        actions: [{ label: "复制订阅", tone: "primary", value: CLASH_SUBSCRIPTION_URL }],
        imageAlt: "Shadowrocket 订阅设置截图",
        imageShape: "phone",
        imageSrc: 'https://global.cdn.mikupics.cn/2021/01/09/9ffc405b03231.png'
      },
      {
        title: "选择节点并启用",
        body: "点击软件底部“首页”，随意选择一个节点，打开顶部的开关即可开始使用。",
        imageAlt: "Shadowrocket 首页节点截图",
        imageShape: "phone",
        imageSrc: 'https://global.cdn.mikupics.cn/2021/01/09/2d3c73411c1d2.png'
      },
    ],
  },
  mac: {
    id: "mac",
    cardName: "Mac",
    title: "Mac 使用教程",
    version: "适用于 macOS Sierra (10.12) 或更高版本",
    gradient: "from-[#8c8c8c] via-[#b0b2b5] to-[#c2c5ca]",
    icon: Laptop,
    iconClass: "text-slate-700/18",
    shadow: "shadow-[0_14px_26px_rgba(100,116,139,0.2)]",
    accent: "text-[#5aa7f0]",
    steps: [
      {
        title: "下载 Mac 客户端",
        body:
          "Clash Verge Rev（以下简称Clash）支持 Shadowsocks、ShadowsocksR、Vmess 协议。本软件在 Windows 和 MacOS 上通用，以下教程图片均取自 Windows 环境，点击下方按钮即可下载。",
        actions: [
          { label: "(Intel芯片)下载客户端", tone: "primary", src: 'https://dl.p6p.net/clash-verge/v2.4.3/Clash.Verge_2.4.3_x64.dmg' },
          { label: "(Apple Silicon芯片)下载客户端", tone: "primary", src: 'https://dl.p6p.net/clash-verge/v2.4.3/Clash.Verge_2.4.3_aarch64.dmg' },
        ],
        imageAlt: "Clash Verge Mac 关于页面截图",
        imageShape: "desktop",
        imageSrc: 'https://33333.ifnf.xyz/seni/yes/theme/malio/img/tutorial/mac-clashverge-1.png'
      },
      {
        title: "导入配置",
        body: [
          "安装完成并打开Clash之后，从侧边栏选择 配置",
          "点击复制 Clash 订阅链接，再点击右侧的导入按钮。",
          "然后访问我们的 订阅转换服务，",
          "将你的复制到的订阅链接放进去转换，再手动订阅转换出来的新的订阅链接。",
        ],
        actions: [{ label: "复制订阅", tone: "primary", value: CLASH_SUBSCRIPTION_URL }],
        imageAlt: "Clash Verge Mac 配置页截图",
        imageShape: "desktop",
        imageSrc: 'https://33333.ifnf.xyz/seni/yes/theme/malio/img/tutorial/mac-clashverge-2.png'
      },
      {
        title: "调整更新间隔",
        body: "订阅成功导入后，右键新增的配置，点击 编辑信息，将 更新时间 改为 1440 分钟，再点击下方保存。",
        imageAlt: "Clash Verge Mac 编辑配置截图",
        imageShape: "desktop",
        imageSrc: 'https://33333.ifnf.xyz/seni/yes/theme/malio/img/tutorial/mac-clashverge-4.png'
      },
      {
        title: "选择代理节点",
        body: "完成后，点击侧边栏中的 代理，选择要使用的节点。",
        imageAlt: "Clash Verge Mac 代理节点截图",
        imageShape: "desktop",
        imageSrc: 'https://33333.ifnf.xyz/seni/yes/theme/malio/img/tutorial/mac-clashverge-3.png'
      },
      {
        title: "开启系统代理",
        body: "从侧边栏选择 主页，打开 系统代理，完成后即可上网。",
        imageAlt: "Clash Verge Mac 主页系统代理截图",
        imageShape: "desktop",
        imageSrc: 'https://33333.ifnf.xyz/seni/yes/theme/malio/img/tutorial/mac-clashverge-5.png'
      },
    ],
  },
};

const platforms = Object.values(platformConfigs);

function TutorialImageSlot({ step }: { step: TutorialStep }) {
  const shape = step.imageShape ?? "desktop";
  const shapeClass =
    shape === "phone"
      ? "aspect-[9/19] max-w-[300px]"
      : shape === "square"
        ? "aspect-square max-w-[360px]"
        : "aspect-[16/10] max-w-[430px]";

  return (
    <div className="flex justify-center lg:justify-end">
      <div className={cn("w-full overflow-hidden rounded-sm border border-slate-100 bg-slate-50 shadow-sm", shapeClass)}>
        {step.imageSrc ? (
          <img src={step.imageSrc} alt={step.imageAlt ?? step.title} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center border border-dashed border-slate-200 bg-white text-sm font-medium text-slate-300">
            图片预留位置
          </div>
        )}
      </div>
    </div>
  );
}

function TutorialVisual({ step, platform }: { step: TutorialStep; platform: PlatformConfig }) {
  const { type } = step;

  if (step.imageSrc || step.imageShape) return <TutorialImageSlot step={step} />;

  if (!type) return <div className="hidden lg:block" />;

  if (type === "logo") {
    const Icon = platform.icon;
    return (
      <div className="flex justify-center lg:justify-end">
        <div className="flex h-64 w-64 items-center justify-center rounded-full bg-[linear-gradient(135deg,#ec62b9_0%,#8a6cf6_100%)] shadow-[0_18px_34px_rgba(99,102,241,0.22)]">
          <Icon className="h-28 w-28 text-white" strokeWidth={1.5} />
        </div>
      </div>
    );
  }

  if (type === "download-list") {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-4 text-xs text-blue-700 shadow-sm">
          {["Clash.Verge_1.7.3_x64-setup.exe", "Clash.Verge_1.7.3_x64.dmg", "Clash.Verge_1.7.3_arm64.dmg", "Clash.Verge_1.7.3_portable.zip"].map((item) => (
            <div key={item} className="break-all border-b border-slate-100 py-2 underline">
              {item}
            </div>
          ))}
        </div>
        <div className="rounded border border-slate-200 bg-white p-4 font-serif text-sm text-slate-800 shadow-sm">
          <div className="mb-3 text-xl font-bold">Index of /clash-verge/1.7.2</div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 text-xs">
            {["Clash Verge 1.7.2 arm64.dmg", "Clash Verge 1.7.2 x64-setup.exe", "Clash Verge 1.7.2 x64.dmg"].map((item) => (
              <React.Fragment key={item}>
                <span className="min-w-0 truncate text-blue-700 underline">{item}</span>
                <span>2024-07-03</span>
                <span>35M</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const dark = ["phone-settings", "phone-list", "mac-about", "mac-profiles", "mac-edit", "mac-proxy", "mac-home"].includes(type);

  return (
    <div className="flex justify-center lg:justify-end">
      <div
        className={cn(
          "w-full max-w-[360px] rounded border p-5 shadow-[0_18px_28px_rgba(15,23,42,0.12)]",
          dark ? "border-slate-800 bg-[#171923] text-slate-100" : "border-slate-200 bg-white text-slate-800",
          type.startsWith("phone") ? "max-w-[280px]" : "",
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
          </div>
          <span className="text-xs opacity-60">Clash Verge</span>
        </div>
        {type === "installer" ? (
          <div className="grid grid-cols-[86px_1fr] gap-4">
            <div className="h-36 rounded bg-[#1c1688]" />
            <div className="space-y-3">
              <div className="h-4 rounded bg-slate-300" />
              <div className="h-3 rounded bg-slate-200" />
              <div className="h-3 rounded bg-slate-200" />
              <div className="mt-10 flex justify-end gap-2">
                <div className="h-7 w-20 rounded border border-slate-300" />
                <div className="h-7 w-16 rounded border border-slate-300" />
              </div>
            </div>
          </div>
        ) : type === "subscription" || type === "mac-profiles" ? (
          <div className="grid grid-cols-[64px_1fr] gap-4">
            <div className={cn("space-y-3 border-r pr-3", dark ? "border-slate-700" : "border-slate-200")}>
              {["Home", "Proxy", "Profiles", "Rules"].map((item) => (
                <div key={item} className={cn("rounded px-2 py-2 text-xs", item === "Profiles" ? "bg-blue-500 text-white" : "opacity-70")}>
                  {item}
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div className="h-8 rounded border border-blue-300 bg-blue-50/10" />
              <div className="grid grid-cols-2 gap-3">
                <div className={cn("h-24 rounded", dark ? "bg-slate-800" : "bg-slate-100")} />
                <div className={cn("h-24 rounded", dark ? "bg-slate-800" : "bg-slate-100")} />
              </div>
            </div>
          </div>
        ) : type === "proxy" || type === "mac-proxy" || type === "phone-list" ? (
          <div className="space-y-2">
            {["香港 HK 节点", "日本 JP 节点", "新加坡 SG 节点", "美国 US 节点", "台湾 TW 节点"].map((item, index) => (
              <div key={item} className={cn("flex items-center justify-between rounded px-3 py-2 text-xs", dark ? "bg-slate-800" : "bg-slate-100")}>
                <span>{item}</span>
                <span className={index === 0 ? "text-emerald-400" : "opacity-50"}>{index === 0 ? "已选" : `${48 + index * 21}ms`}</span>
              </div>
            ))}
          </div>
        ) : type === "settings" || type === "phone-settings" || type === "mac-edit" || type === "mac-home" ? (
          <div className="space-y-4">
            {["系统代理", "开机自启", "Tun 模式", "自动更新"].map((item, index) => (
              <div key={item} className={cn("flex items-center justify-between rounded px-3 py-3 text-xs", dark ? "bg-slate-800" : "bg-slate-100")}>
                <span>{item}</span>
                <span className={cn("h-5 w-9 rounded-full", index < 2 ? "bg-blue-500" : dark ? "bg-slate-600" : "bg-slate-300")}>
                  <span className={cn("block h-5 w-5 rounded-full bg-white shadow", index < 2 ? "ml-4" : "ml-0")} />
                </span>
              </div>
            ))}
          </div>
        ) : type === "mac-about" ? (
          <div className="flex items-center gap-5 rounded bg-black p-5 text-white">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-[linear-gradient(135deg,#ec62b9,#8a6cf6)]">
              <Laptop className="h-12 w-12" />
            </div>
            <div>
              <div className="text-lg font-bold">Clash Verge</div>
              <div className="mt-2 text-xs text-white/60">Version 2.2.3</div>
              <div className="mt-1 text-xs text-white/60">Universal Build</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TutorialActionButton({ action }: { action: TutorialAction }) {
  const handleClick = async () => {
    if (action.src) {
      window.open(action.src)
      return;
    }

    if (action.value) {
      try {
        await navigator.clipboard.writeText(action.value);
        toast.success("已复制到剪贴板");
      } catch {
        toast.error("复制失败，请手动复制");
      }
      return;
    }

    toast.success(`${action.label} 已触发`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-[0_10px_18px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 cursor-pointer",
        action.tone === "secondary" ? "bg-white text-slate-700" : "bg-[#183564] text-white",
      )}
    >
      <Download className="h-4 w-4" />
      {action.label}
    </button>
  );
}

function TutorialBody({ body }: { body: TutorialStep["body"] }) {
  const paragraphs = Array.isArray(body) ? body : [body];

  return (
    <div className="mt-5 space-y-3 text-base leading-8 text-slate-600">
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}

export function DownloadTutorialPage() {
  return (
    <div className="mx-auto max-w-[1680px] space-y-5 sm:space-y-7">
      <section className="rounded-sm border border-blue-100 bg-white px-4 py-4 shadow-[0_10px_22px_rgba(15,23,42,0.06)] sm:px-5 sm:py-5">
        <h2 className="text-xl font-bold tracking-tight text-[#222a52]">下载和教程</h2>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:gap-6">
        {platforms.map((platform) => {
          const Icon = platform.icon;

          return (
            <Link
              key={platform.id}
              to={`/downloads/${platform.id}`}
              className={cn(
                "group relative min-h-[170px] overflow-hidden rounded-[4px] bg-gradient-to-r px-5 py-6 text-white transition duration-200 hover:-translate-y-0.5 sm:min-h-[190px] sm:px-9 sm:py-9",
                platform.gradient,
                platform.shadow,
              )}
            >
              <div className="relative z-10">
                <h3 className="text-3xl font-bold leading-none tracking-normal text-white sm:text-[2.75rem]">{platform.cardName}</h3>
                <p className="mt-4 text-base font-semibold text-white/95">{platform.version}</p>
                <div className="mt-7 inline-flex items-center gap-2 rounded border border-white/25 bg-white/12 px-4 py-2 text-sm font-semibold text-white/85 backdrop-blur transition group-hover:bg-white/22 group-hover:text-white">
                  <BookOpen className="h-4 w-4" />
                  查看教程
                </div>
              </div>

              <Icon className={cn("pointer-events-none absolute right-3 top-4 h-24 w-24 opacity-45 sm:-right-2 sm:-top-2 sm:h-40 sm:w-40 sm:opacity-80", platform.iconClass)} strokeWidth={1.35} />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.08),rgba(255,255,255,0.08))]" />
            </Link>
          );
        })}
      </section>
    </div>
  );
}

export function PlatformTutorialPage() {
  const { platformId } = useParams();
  const platform = platformConfigs[platformId as PlatformId];

  if (!platform) return <Navigate to="/downloads" replace />;

  return (
    <div className="mx-auto max-w-[1680px] overflow-hidden rounded-sm bg-white shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-slate-100 bg-white px-4 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link to="/downloads" className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-600 transition hover:bg-indigo-50">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h2 className="min-w-0 truncate text-xl font-bold tracking-tight text-[#20264f] sm:text-2xl">{platform.title}</h2>
        </div>
        <Link to="/downloads" className="inline-flex justify-center rounded bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_8px_14px_rgba(79,70,229,0.28)] transition hover:bg-indigo-600">
          其他客户端
        </Link>
      </div>

      <div className="divide-y divide-slate-100">
        {platform.steps.map((step, index) => (
          <section key={`${platform.id}-${step.title}`} className="grid min-h-[240px] gap-6 px-4 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(280px,430px)] lg:items-start lg:gap-8 lg:px-7 lg:py-9">
            <div className="min-w-0 max-w-4xl">
              <div className={cn("text-4xl font-bold leading-none", platform.accent)}>{index + (platform.id === "windows" ? 0 : 1)}.</div>
              <h3 className="mt-3 text-base font-semibold leading-7 text-slate-600">{step.title}</h3>
              <TutorialBody body={step.body} />

              {step.actions?.length ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {step.actions.map((action) => (
                    <TutorialActionButton key={action.label} action={action} />
                  ))}
                </div>
              ) : null}

              {step.note ? <p className="mt-5 text-sm leading-7 text-slate-500">{step.note}</p> : null}
            </div>

            <TutorialVisual step={step} platform={platform} />
          </section>
        ))}
      </div>
    </div>
  );
}
