import { describe, expect, it } from "vitest";
import { validarRut } from "./rut";

describe("validarRut", () => {
  it("acepta un RUT válido conocido con puntos y guión", () => {
    expect(validarRut("12.345.678-5")).toBe(true);
  });

  it("acepta un RUT válido conocido sin puntos", () => {
    expect(validarRut("12345678-5")).toBe(true);
  });

  it("acepta un RUT válido conocido sin puntos ni guión", () => {
    expect(validarRut("123456785")).toBe(true);
  });

  it("rechaza un RUT inválido conocido (dígito verificador incorrecto)", () => {
    expect(validarRut("12.345.678-4")).toBe(false);
  });

  it("rechaza un RUT inválido conocido sin formato", () => {
    expect(validarRut("12345678-4")).toBe(false);
  });

  it("acepta un RUT válido cuyo dígito verificador es K mayúscula", () => {
    // 10.000.013-K es un RUT válido conocido (DV = K).
    expect(validarRut("10.000.013-K")).toBe(true);
  });

  it("acepta un RUT válido cuyo dígito verificador es k minúscula", () => {
    expect(validarRut("10.000.013-k")).toBe(true);
  });

  it("rechaza formatos inválidos (letras en el cuerpo)", () => {
    expect(validarRut("12A45678-5")).toBe(false);
  });

  it("rechaza strings vacíos", () => {
    expect(validarRut("")).toBe(false);
  });

  it("rechaza RUT con cuerpo demasiado largo", () => {
    expect(validarRut("123456789012-5")).toBe(false);
  });
});
