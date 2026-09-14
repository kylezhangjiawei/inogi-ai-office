/** Applicant answers and bearer-style filling credentials never belong in operational logs. */
export const APPLICANT_FORM_LOG_OMITTED = '[applicant form payload omitted]';

type RequestPath = {
  path?: string;
  originalUrl?: string;
  url?: string;
  route?: { path?: unknown };
};

function applicantPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let path = value.split(/[?#]/, 1)[0];
  try { path = decodeURIComponent(path); } catch { /* The route template can still identify malformed requests. */ }
  path = path.replace(/^\/api(?=\/|$)/i, '');
  return /^\/(?:public\/)?applicant-forms(?:\/|$)/i.test(path) ? path : null;
}

/** Use the framework's route pattern, never a candidate-controlled path parameter or query string. */
export function applicantFormLogPath(request: RequestPath): string | null {
  const route = applicantPath(request.route?.path);
  if (route) return route;
  for (const value of [request.path, request.originalUrl, request.url]) {
    const path = applicantPath(value);
    if (path) {
      return /^\/public\//i.test(path)
        ? '/public/applicant-forms/[redacted]'
        : '/applicant-forms/[redacted]';
    }
  }
  return null;
}
