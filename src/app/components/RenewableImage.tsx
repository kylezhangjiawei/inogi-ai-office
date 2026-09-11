import type { ImgHTMLAttributes } from "react";
import { useRenewableResource } from "../lib/useRenewableResource";

export function RenewableImage({ resourceKey, refresh, src, onLoad, onError, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
  resourceKey: string;
  refresh?: () => Promise<string>;
}) {
  const resource = useRenewableResource({ src, resourceKey, refresh });
  return <img {...props} src={resource.src || undefined} onLoad={(event) => { resource.onLoad(); onLoad?.(event); }} onError={(event) => { resource.onError(); onError?.(event); }} />;
}
