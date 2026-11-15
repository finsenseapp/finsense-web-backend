import { describe, expect, it } from "vitest";
import { changeEmailSchema, changePasswordSchema, deleteAccountSchema, updateProfileSchema } from "./auth.schemas.js";

describe("account management schemas", () => {
  it("change password: needs a different, long-enough new password", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "OldPass#1", newPassword: "NewPass#2" }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: "OldPass#1", newPassword: "OldPass#1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "OldPass#1", newPassword: "short" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "", newPassword: "NewPass#2" }).success).toBe(false);
  });

  it("change email: normalises case and requires the password", () => {
    const ok = changeEmailSchema.parse({ email: "  New@Example.COM ", currentPassword: "x" });
    expect(ok.email).toBe("new@example.com");
    expect(changeEmailSchema.safeParse({ email: "not-an-email", currentPassword: "x" }).success).toBe(false);
    expect(changeEmailSchema.safeParse({ email: "a@b.co" }).success).toBe(false);
  });

  it("delete account needs the password; profile update ignores nothing unknown", () => {
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ password: "x" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: "A", passwordHash: "x" }).success).toBe(false);
  });
});
