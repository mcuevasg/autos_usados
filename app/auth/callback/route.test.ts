import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

// Mock de createSupabaseServerClient
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

describe("GET /app/auth/callback/route.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirige a /login?error=invalid_code cuando falta el parámetro 'code'", async () => {
    const request = new NextRequest("http://localhost:3000/auth/callback");

    const response = await GET(request);

    expect(response.status).toBe(307); // Redirect status
    expect(response.headers.get("location")).toContain("/login?error=invalid_code");
  });

  it("intercambia el código por una sesión cuando el código es válido", async () => {
    const mockExchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "user-123" } } },
      error: null,
    });

    const mockSupabaseClient = {
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    };

    (createSupabaseServerClient as any).mockResolvedValue(mockSupabaseClient);

    const validCode = "AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    const request = new NextRequest(
      `http://localhost:3000/auth/callback?code=${validCode}`
    );

    const response = await GET(request);

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(validCode);
    expect(response.status).toBe(307); // Redirect status
    expect(response.headers.get("location")).toContain("/cuenta");
  });

  it("redirige a /login?error=verification_failed cuando exchangeCodeForSession falla", async () => {
    const mockExchangeCodeForSession = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("Invalid code"),
    });

    const mockSupabaseClient = {
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    };

    (createSupabaseServerClient as any).mockResolvedValue(mockSupabaseClient);

    const validCode = "AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    const request = new NextRequest(
      `http://localhost:3000/auth/callback?code=${validCode}`
    );

    const response = await GET(request);

    expect(response.status).toBe(307); // Redirect status
    expect(response.headers.get("location")).toContain(
      "/login?error=verification_failed"
    );
  });

  it("redirige a /login?error=verification_failed cuando createSupabaseServerClient falla", async () => {
    (createSupabaseServerClient as any).mockRejectedValue(
      new Error("Failed to create client")
    );

    const validCode = "AbCdEfGhIjKlMnOpQrStUvWxYz123456";
    const request = new NextRequest(
      `http://localhost:3000/auth/callback?code=${validCode}`
    );

    const response = await GET(request);

    expect(response.status).toBe(307); // Redirect status
    expect(response.headers.get("location")).toContain(
      "/login?error=verification_failed"
    );
  });

  it("preserva el código en la URL cuando se extrae del query parameter", async () => {
    const mockExchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: {} },
    });

    const mockSupabaseClient = {
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
      },
    };

    (createSupabaseServerClient as any).mockResolvedValue(mockSupabaseClient);

    const testCode = "XyZ9abcDeFgHiJkLmNoPqRsTuVwx12345";
    const request = new NextRequest(
      `http://localhost:3000/auth/callback?code=${testCode}`
    );

    await GET(request);

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith(testCode);
  });

  it("redirige a /login?error=invalid_code cuando el código excede 128 caracteres", async () => {
    const longCode = "a".repeat(129);
    const request = new NextRequest(
      `http://localhost:3000/auth/callback?code=${longCode}`
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?error=invalid_code");
  });
});
