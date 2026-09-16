/**
 * Validador de RUT chileno (dígito verificador módulo 11).
 *
 * Acepta formatos con o sin puntos y con o sin guión, por ejemplo:
 * "12.345.678-5", "12345678-5", "123456785".
 * El dígito verificador 'k'/'K' se maneja sin distinción de mayúsculas.
 */

/**
 * Limpia un RUT ingresado por el usuario, removiendo puntos, guiones y
 * espacios, y normalizando el dígito verificador a mayúscula.
 */
function limpiarRut(rut: string): string {
  return rut
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

/**
 * Calcula el dígito verificador esperado para un cuerpo de RUT (sin DV)
 * usando el algoritmo módulo 11.
 */
function calcularDigitoVerificador(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;

  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }

  const resto = 11 - (suma % 11);

  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * Valida un RUT chileno según el algoritmo de dígito verificador módulo 11.
 *
 * @param rut RUT a validar, con o sin puntos/guión (ej. "12.345.678-5",
 * "12345678-5" o "123456785").
 * @returns true si el RUT tiene un formato válido y su dígito verificador
 * corresponde al calculado; false en caso contrario.
 */
export function validarRut(rut: string): boolean {
  if (typeof rut !== "string") return false;

  const rutLimpio = limpiarRut(rut);

  // Debe tener entre 2 y 9 caracteres: 1 a 8 dígitos para el cuerpo + 1 DV.
  if (!/^[0-9]{1,8}[0-9K]$/.test(rutLimpio)) return false;

  const cuerpo = rutLimpio.slice(0, -1);
  const dv = rutLimpio.slice(-1);

  // El cuerpo no puede ser "0" ni empezar en un valor sin sentido de negocio.
  if (cuerpo.length === 0 || Number(cuerpo) <= 0) return false;

  const dvEsperado = calcularDigitoVerificador(cuerpo);

  return dv === dvEsperado;
}
