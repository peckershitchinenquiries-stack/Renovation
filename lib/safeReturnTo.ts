// Validates a redirect target that arrived over an untrusted channel (a query
// string) before it is ever handed to router.push(). Only a same-origin
// relative path is accepted — anything else (an absolute URL, a
// protocol-relative "//evil.com", a backslash trick some browsers normalise
// to "//") is rejected outright rather than sanitised, because a redirect
// target is exactly the kind of thing that should fail closed.
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  return value;
}
