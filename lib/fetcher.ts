// Thin client-side fetch wrapper. Throws ApiError (with field details) on failure.
export class ApiError extends Error {
  details?: Record<string, string>;
  status: number;
  constructor(message: string, status: number, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const isJson = res.headers
    .get("content-type")
    ?.includes("application/json");
  const data = isJson ? await res.json() : null;
  // An expired session is not a form error. Every caller renders `err.message`
  // in a toast, so without this a lapsed cookie produced a red "Unauthorized"
  // over whatever the user was in the middle of, with no way back. Send them
  // to the sign-in page instead, and return a promise that never settles: the
  // navigation is already replacing the page, and resolving or rejecting would
  // only let the caller show the toast we are avoiding.
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/";
    return new Promise<T>(() => {});
  }
  if (!res.ok) {
    throw new ApiError(
      data?.error ?? `Request failed (${res.status})`,
      res.status,
      data?.details
    );
  }
  return data as T;
}
