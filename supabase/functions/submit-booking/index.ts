import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TurnstileResponse = {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const verifyTurnstile = async (token: string, remoteIp: string | null) => {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    throw new Error("Turnstile is not configured");
  }

  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  formData.append("idempotency_key", crypto.randomUUID());
  if (remoteIp) formData.append("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Could not verify anti-bot challenge");
  }

  const result = (await response.json()) as TurnstileResponse;
  if (!result.success) {
    console.warn("Turnstile verification failed", result["error-codes"] ?? []);
    throw new Error("Verification failed. Please refresh and try again.");
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase function environment is not configured");
    }

    const body = await req.json();
    const turnstileToken = typeof body?.turnstileToken === "string" ? body.turnstileToken : "";
    const booking = body?.booking;

    if (!turnstileToken) {
      return json({ error: "Please complete the verification challenge." }, 400);
    }

    if (!booking || typeof booking !== "object") {
      return json({ error: "Invalid booking request." }, 400);
    }

    await verifyTurnstile(
      turnstileToken,
      req.headers.get("CF-Connecting-IP") ?? req.headers.get("X-Forwarded-For"),
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.rpc("submit_booking_request", { payload: booking });
    if (error) {
      console.error("submit_booking_request failed", error);
      return json({ error: error.message || "Could not submit booking request." }, 400);
    }

    return json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit booking request.";
    console.error("submit-booking error", message);
    return json({ error: message }, 400);
  }
});
