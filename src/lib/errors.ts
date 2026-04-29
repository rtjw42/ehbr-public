export const getErrorMessage = (error: unknown, fallback = "Something went wrong") => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
};
