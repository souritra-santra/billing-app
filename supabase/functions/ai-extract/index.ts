import { createClient } from "npm:@supabase/supabase-js@2";
import {
  extractProducts,
  geminiHealth,
  validateRequest,
} from "../_shared/gemini.ts";

const MAX_BODY_BYTES = 16 * 1024 * 1024;
const DEFAULT_DAILY_LIMIT = 30;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorResponse(error: unknown): Response {
  const status = Number((error as any)?.status) || 500;
  const code = String((error as any)?.code || "api_error");
  const message =
    status >= 500
      ? String((error as any)?.message || "AI extraction failed")
      : String((error as any)?.message || "Request failed");

  // Never log image data or secrets.
  console.error(`[ai-extract] ${status} ${code}: ${message}`);
  return json(status, { code, message });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === "GET") {
    return json(200, geminiHealth());
  }

  if (req.method !== "POST") {
    return json(404, { code: "not_found", message: "Not found" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      throw Object.assign(
        new Error("Supabase Edge Function environment is incomplete"),
        { status: 503, code: "not_configured" },
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      throw Object.assign(new Error("Sign in is required"), {
        status: 401,
        code: "unauthorized",
      });
    }
    const accessToken = authHeader.slice("Bearer ".length).trim();

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser(
      accessToken,
    );
    if (userError || !userData.user) {
      throw Object.assign(new Error("Session expired. Sign in again."), {
        status: 401,
        code: "unauthorized",
      });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), {
        status: 413,
        code: "invalid_request",
      });
    }

    let body: any;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw Object.assign(new Error("Invalid JSON request body"), {
        status: 400,
        code: "invalid_request",
      });
    }

    const shopId = typeof body?.shopId === "string" ? body.shopId.trim() : "";
    if (!shopId) {
      throw Object.assign(new Error("shopId is required"), {
        status: 400,
        code: "invalid_request",
      });
    }

    // Reject malformed/unsupported images before spending the daily quota.
    validateRequest(body);

    const { data: membership, error: membershipError } = await supabase
      .from("shop_members")
      .select("shop_id")
      .eq("shop_id", shopId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (membershipError) {
      throw Object.assign(new Error(membershipError.message), {
        status: 403,
        code: "forbidden",
      });
    }
    if (!membership) {
      throw Object.assign(new Error("You are not a member of this shop"), {
        status: 403,
        code: "forbidden",
      });
    }

    const dailyLimit = Math.max(
      1,
      Number(Deno.env.get("AI_DAILY_LIMIT") || DEFAULT_DAILY_LIMIT) ||
        DEFAULT_DAILY_LIMIT,
    );
    const { data: quota, error: quotaError } = await supabase.rpc(
      "consume_ai_quota",
      { p_shop_id: shopId, p_limit: dailyLimit },
    );

    if (quotaError) {
      throw Object.assign(new Error(quotaError.message), {
        status: 403,
        code: "forbidden",
      });
    }
    if (quota && quota.allowed === false) {
      throw Object.assign(
        new Error(
          `Daily AI limit reached (${quota.used}/${quota.limit}). Try again tomorrow.`,
        ),
        { status: 429, code: "api_error" },
      );
    }

    const result = await extractProducts(body);
    return json(200, { ...result, quota: quota || null });
  } catch (error) {
    return errorResponse(error);
  }
});
