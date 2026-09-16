import { describe, expect, it } from "vitest";
import { esDestacadoVigente } from "./listings";

describe("esDestacadoVigente", () => {
  it("retorna true cuando featured_active es true y featured_expires_at está en el futuro", () => {
    const futuro = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    expect(
      esDestacadoVigente({ featured_active: true, featured_expires_at: futuro })
    ).toBe(true);
  });

  it("retorna false cuando featured_active es false, aunque featured_expires_at esté en el futuro", () => {
    const futuro = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    expect(
      esDestacadoVigente({ featured_active: false, featured_expires_at: futuro })
    ).toBe(false);
  });

  it("retorna false cuando featured_expires_at es null, aunque featured_active sea true", () => {
    expect(
      esDestacadoVigente({ featured_active: true, featured_expires_at: null })
    ).toBe(false);
  });

  it("retorna false cuando featured_active es true pero featured_expires_at ya expiró (caso sin cron, T-17/T-18)", () => {
    const pasado = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    expect(
      esDestacadoVigente({ featured_active: true, featured_expires_at: pasado })
    ).toBe(false);
  });

  it("retorna false cuando featured_active es false y featured_expires_at es null (caso más común)", () => {
    expect(
      esDestacadoVigente({ featured_active: false, featured_expires_at: null })
    ).toBe(false);
  });
});
