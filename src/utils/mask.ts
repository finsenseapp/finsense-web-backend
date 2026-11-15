/**
 * "jane.doe@gmail.com" -> "j***@gmail.com". Used wherever a person is shown to the Super Admin or written to the
 * audit log: enough to tell accounts apart, not enough to contact or identify someone.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
