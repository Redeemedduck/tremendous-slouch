const API_PREFIX = "/api";
const MOUNTED_APP_PATHS = new Set(["/djdi", "/golf"]);

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;
const normalizedBase = (viteEnv?.BASE_URL ?? "/").replace(/\/+$/, "");

function runtimeAppBasePath() {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const firstSegment = `/${path.split("/").filter(Boolean)[0] ?? ""}`;
  return MOUNTED_APP_PATHS.has(firstSegment) ? firstSegment : null;
}

export const appBasePath = runtimeAppBasePath() ?? normalizedBase ?? "";
export const apiBasePath =
  appBasePath && appBasePath !== "/" ? `${appBasePath}-api` : API_PREFIX;

export function apiPath(path: string) {
  if (apiBasePath === API_PREFIX) return path;
  if (path === API_PREFIX) return apiBasePath;
  if (path.startsWith(`${API_PREFIX}/`)) {
    return `${apiBasePath}${path.slice(API_PREFIX.length)}`;
  }
  return path;
}

export function installApiBaseRewrite() {
  if (apiBasePath === API_PREFIX || typeof window === "undefined") return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      return nativeFetch(apiPath(input), init);
    }
    if (input instanceof URL && input.origin === window.location.origin) {
      const next = new URL(input);
      next.pathname = apiPath(next.pathname);
      return nativeFetch(next, init);
    }
    if (input instanceof Request) {
      const url = new URL(input.url);
      if (url.origin === window.location.origin) {
        url.pathname = apiPath(url.pathname);
        return nativeFetch(new Request(url, input), init);
      }
    }
    return nativeFetch(input, init);
  };
}
