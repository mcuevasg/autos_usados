import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-zinc-50 px-6 py-16 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      </div>
      <LoginForm />
    </div>
  );
}
