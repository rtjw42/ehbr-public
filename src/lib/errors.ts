// Best-effort extraction of a human-readable message from an unknown thrown value,
// with a safe fallback. Used at UI boundaries (toasts) where the error shape varies.
export const getErrorMessage = (error: unknown, fallback = "Something went wrong") => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};
