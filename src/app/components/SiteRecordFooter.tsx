import { useMatch } from "react-router";
import { cn } from "./ui/utils";

const ICP_RECORD_URL = "https://beian.miit.gov.cn/#/Integrated/index";
const PUBLIC_SECURITY_RECORD_CODE = "32011202001840";
const PUBLIC_SECURITY_RECORD_URL = `https://www.beian.gov.cn/portal/registerSystemInfo?recordcode=${PUBLIC_SECURITY_RECORD_CODE}`;

export function SiteRecordFooter({
  className,
  tone = "light",
}: {
  className?: string;
  tone?: "light" | "dark" | "horizon";
}) {
  const isLoginPage = useMatch("/login") !== null;
  const linkClassName = cn(
    "rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2",
    tone === "dark"
      ? "hover:text-blue-100 focus-visible:ring-blue-200"
      : tone === "horizon"
        ? "hover:text-[#002fa7] focus-visible:ring-[#8cb4ff]"
        : "hover:text-indigo-600 focus-visible:ring-indigo-300",
  );

  return (
    <footer
      style={{ display: isLoginPage ? "flex" : "none", background: "transparent" }}
      className={cn(
        "shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-center text-[11px] text-slate-500",
        className,
      )}
    >
      <a
        href={ICP_RECORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        苏ICP备2021046412号-3
      </a>
      <a
        href={PUBLIC_SECURITY_RECORD_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn("inline-flex items-center gap-1.5", linkClassName)}
      >
        <img src="/gongan.png" alt="公安备案图标" width={18} height={18} className="shrink-0" />
        <span>苏公网安备32011202001840号</span>
      </a>
    </footer>
  );
}
