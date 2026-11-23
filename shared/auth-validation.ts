export type AuthField = "name" | "email" | "password";
export type FieldErrors = Partial<Record<AuthField, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateName(name: string) {
  const v = name.trim();
  if (!v) return "Enter your name";
  if (v.length > 80) return "Name is too long";
  return undefined;
}

export function validateEmail(email: string) {
  const v = email.trim();
  if (!v) return "Enter your email";
  if (v.length > 254 || !EMAIL_RE.test(v)) return "Enter a valid email address";
  return undefined;
}

export function validatePassword(password: string, mode: "sign-in" | "sign-up") {
  if (!password) return "Enter your password";
  if (mode === "sign-up") {
    if (password.length < 8) return "Use at least 8 characters";
    if (password.length > 128) return "Use at most 128 characters";
  }
  return undefined;
}

export function validateCredentials(
  mode: "sign-in" | "sign-up",
  input: { name?: string; email: string; password: string }
): FieldErrors {
  const errors: FieldErrors = {
    email: validateEmail(input.email),
    password: validatePassword(input.password, mode),
  };
  if (mode === "sign-up") errors.name = validateName(input.name ?? "");
  for (const key of Object.keys(errors) as AuthField[]) {
    if (!errors[key]) delete errors[key];
  }
  return errors;
}
