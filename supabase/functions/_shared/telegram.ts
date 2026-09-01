// Outbound-only Telegram Bot API helper. Best-effort by design: every call is
// bounded by a 5s timeout, retries once on 429 (honouring retry_after, capped),
// and NEVER throws — a Telegram outage must never fail a booking or approval.
// Failures log the method name and Telegram's `description` only; the bot token
// lives in the URL path, so the URL itself must never be logged.

const TIMEOUT_MS = 5000;
const MAX_RETRY_AFTER_SECONDS = 3;

export type TelegramResult = {
  ok: boolean;
  messageId?: number;
  description?: string;
};

type TelegramApiBody = {
  ok?: boolean;
  result?: { message_id?: number };
  description?: string;
  parameters?: { retry_after?: number };
};

export const callTelegram = async (
  method: string,
  payload: Record<string, unknown>,
  attempt = 0,
): Promise<TelegramResult> => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    console.warn(`telegram ${method} skipped: TELEGRAM_BOT_TOKEN not set`);
    return { ok: false, description: "not configured" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = (await response.json().catch(() => null)) as TelegramApiBody | null;
    if (body?.ok) return { ok: true, messageId: body.result?.message_id };

    if (response.status === 429 && attempt === 0) {
      const retryAfter = Math.min(
        Math.max(Number(body?.parameters?.retry_after) || 1, 1),
        MAX_RETRY_AFTER_SECONDS,
      );
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return callTelegram(method, payload, 1);
    }

    const description = body?.description ?? `HTTP ${response.status}`;
    console.error(`telegram ${method} failed:`, description);
    return { ok: false, description };
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    console.error(`telegram ${method} error:`, description);
    return { ok: false, description };
  }
};

// Plain text only — parse_mode is intentionally omitted (user-supplied titles /
// names / info would be a formatting-injection vector in Markdown/HTML modes).
// C2 board edit-in-place. The board builder emits HTML with every user field
// escaped, so it MUST be edited with parse_mode:"HTML" to match the original
// send. Telegram answers "message is not modified" with an error; callers should
// treat that description as success (the board on screen already matches).
export const editTelegramMessage = (input: {
  chatId: string;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
}) =>
  callTelegram("editMessageText", {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
  });

export const sendTelegramMessage = (input: {
  chatId: string;
  text: string;
  threadId?: string;
  parseMode?: "HTML" | "MarkdownV2";
  disableNotification?: boolean;
}) =>
  callTelegram("sendMessage", {
    chat_id: input.chatId,
    // Only included when targeting a forum topic; omitted for plain groups so a
    // stray thread id can't misroute the message.
    ...(input.threadId ? { message_thread_id: Number(input.threadId) } : {}),
    text: input.text,
    // Omitted → Telegram treats the text as plain. When set, every interpolated
    // user field in the text MUST already be entity-escaped by the builder.
    ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
    disable_web_page_preview: true,
    disable_notification: input.disableNotification ?? false,
  });
