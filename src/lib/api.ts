export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, extractError(body, res.status));
  }
  return body as T;
}

/** Pull a human message out of an error body, including Zod-validator errors
 *  (`{error: {issues: [{message}]}}`) — never surface a raw "[object Object]". */
function extractError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const e = (body as Record<string, unknown>).error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const obj = e as { message?: unknown; issues?: Array<{ message?: string }> };
      // Zod v4 serializes a ZodError to { name, message } where message is the
      // JSON-encoded issues array; older shapes expose `issues` directly.
      if (typeof obj.message === "string") {
        try {
          const parsed = JSON.parse(obj.message);
          if (Array.isArray(parsed) && typeof parsed[0]?.message === "string") {
            return parsed[0].message;
          }
        } catch {
          /* message isn't JSON — use it verbatim */
        }
        return obj.message;
      }
      if (Array.isArray(obj.issues) && typeof obj.issues[0]?.message === "string") {
        return obj.issues[0].message;
      }
    }
  }
  return `Request failed (${status})`;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
};
