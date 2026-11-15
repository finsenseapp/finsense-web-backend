import { z } from "zod";
import { isSupportedCurrency } from "../../utils/currencies.js";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email,
  // bcrypt only uses the first 72 bytes, so cap the length
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be at most 72 characters"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required").max(72),
});

// Currency is a display setting (amounts are not converted). Codes are normalised to upper case.
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isSupportedCurrency, "Choose a valid currency code (ISO 4217), for example LKR, USD or EUR");

// Only these two fields can be changed. The email and password have their own flows.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100).optional(),
    currency: currency.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide a name or a currency to update" });

const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters");

const currentPassword = z.string().min(1, "Enter your current password").max(72);

export const changeEmailSchema = z.object({ email, currentPassword }).strict();

export const changePasswordSchema = z
  .object({ currentPassword, newPassword })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "Choose a password different from your current one",
  });

export const deleteAccountSchema = z.object({ password: currentPassword }).strict();

export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
