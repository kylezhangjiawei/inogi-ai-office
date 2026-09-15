import { useRef, useState, type AnchorHTMLAttributes } from "react";
import { toast } from "sonner";
import { downloadResource } from "../lib/resourceAccess";
import { t } from "../lib/i18n";

export function ResourceDownloadLink({ refresh, href = "", download, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  refresh?: () => Promise<string>;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  return <a {...props} href={href} download={download} aria-disabled={pending} onClick={(event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    void downloadResource(href, typeof download === "string" ? download : "attachment", refresh)
      .catch(() => toast.error(t("附件下载失败，请稍后重试")))
      .finally(() => { busy.current = false; setPending(false); });
  }}>{children}</a>;
}
