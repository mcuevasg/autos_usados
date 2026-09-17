// Setup global de Vitest (QA, T-23): registra los matchers de
// `@testing-library/jest-dom` (`toHaveAttribute`, `toBeInTheDocument`, etc.)
// usados por los tests de componentes en `app/components/*.test.tsx`.
import "@testing-library/jest-dom/vitest";
