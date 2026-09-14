import { matchPath } from "react-router";
import { routePath } from "./routePaths";

/** Use the same active route snapshot as App; a page's editable URL is not its workspace identity. */
export function rdWorkspaceForPath(pathname: string): "us-collab" | "production" | null {
  // Browser locations encode non-ASCII paths; React Router decodes them before matching.
  let decodedPath: string;
  try {
    decodedPath = decodeURI(pathname);
  } catch {
    return null;
  }
  const matches = (path: string) => Boolean(matchPath({ path, end: true }, decodedPath));
  const collaborationPages = [
    routePath("page:us-collab-cockpit", "/us-collab-cockpit"),
    routePath("page:us-collab-workspace", "/us-collab-workspace"),
    routePath("page:us-collab-approval-flow", "/us-collab-approval-flow"),
    routePath("page:us-collab-ai-settings", "/us-collab-ai-settings"),
    "/us-collab-task/:taskId",
    "/us-collab-rd-discussion/:taskId",
    "/us-collab-people-management",
    "/us-collab-kb",
    "/us-collab-audit-log",
    "/us-collab-m/*",
  ];
  if (collaborationPages.some(matches)) return "us-collab";
  if (["/production-dashboard", "/production-task/:taskId", "/production-people-management", "/production-m/*"].some(matches)) {
    return "production";
  }
  return null;
}

export function currentRdWorkspace(): "us-collab" | "production" | null {
  return typeof window === "undefined" ? null : rdWorkspaceForPath(window.location.pathname);
}
