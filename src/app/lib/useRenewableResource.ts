import { useCallback, useEffect, useRef, useState } from "react";
import { reportResourceFailure } from "./resourceAccess";

type ResourceOptions = {
  src?: string;
  resourceKey: string;
  refresh?: () => Promise<string>;
  refreshOnMount?: boolean;
};

/** One recovery per failed load; a successful load allows recovery of a later expiration. */
export function useRenewableResource({ src = "", resourceKey, refresh: loader, refreshOnMount = false }: ResourceOptions) {
  const identity = `${resourceKey}\n${src}`;
  const current = useRef(identity);
  current.current = identity;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mounted = useRef(false);
  const epoch = useRef(0);
  const attempted = useRef(false);
  const pending = useRef<Promise<string> | null>(null);
  const [state, setState] = useState({ identity, src, refreshing: refreshOnMount && !!loader, failed: false });

  const refresh = useCallback(() => {
    if (!mounted.current || current.current !== identity) return Promise.reject(new Error("附件已切换"));
    if (pending.current) return pending.current;
    const load = loaderRef.current;
    if (!load) return Promise.resolve(src);
    const ticket = epoch.current;
    const expectedIdentity = identity;
    setState((previous) => ({ ...previous, identity, refreshing: true, failed: false }));
    const request = Promise.resolve().then(load).then((next) => {
      if (!next) throw new Error("附件地址不可用");
      if (mounted.current && ticket === epoch.current && current.current === expectedIdentity) {
        setState({ identity, src: next, refreshing: false, failed: false });
      }
      return next;
    }).catch(() => {
      if (mounted.current && ticket === epoch.current && current.current === expectedIdentity) {
        reportResourceFailure("renew");
        setState((previous) => ({ ...previous, refreshing: false, failed: true }));
      }
      throw new Error("附件链接刷新失败");
    }).finally(() => { if (pending.current === request) pending.current = null; });
    pending.current = request;
    return request;
  }, [identity, src]);

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    attempted.current = false;
    pending.current = null;
    setState({ identity, src, refreshing: refreshOnMount && !!loaderRef.current, failed: false });
    if (refreshOnMount && loaderRef.current) {
      void refresh().catch(() => undefined);
    }
    return () => { mounted.current = false; epoch.current += 1; pending.current = null; };
  }, [identity, src, refresh, refreshOnMount]);

  const onLoad = useCallback(() => {
    if (mounted.current && current.current === identity && !pending.current) attempted.current = false;
  }, [identity]);
  const onError = useCallback(() => {
    if (!mounted.current || current.current !== identity) return;
    if (pending.current) return;
    if (!attempted.current && loaderRef.current) {
      attempted.current = true;
      void refresh().catch(() => undefined);
      return;
    }
    reportResourceFailure("load");
    setState((previous) => ({ ...previous, failed: true, refreshing: false }));
  }, [identity, refresh]);
  const visible = state.identity === identity ? state : { identity, src, refreshing: refreshOnMount && !!loader, failed: false };
  // Removing src while renewing also retries a failed image when a stable signing window returns the same URL.
  return { src: visible.refreshing ? "" : visible.src, refreshing: visible.refreshing, failed: visible.failed, onLoad, onError, refresh };
}
