import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { audit } from "../../lib/audit.js";
import { AppError } from "../../utils/errors.js";
import { maskEmail } from "../../utils/mask.js";
import { purgeUser } from "./purge.js";
import type {
  ChangeEmailInput,
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from "./auth.schemas.js";

const BCRYPT_COST = 12;

// Used to keep login timing similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  currency: true,
  createdAt: true,
  role: true,
  mustChangePassword: true,
} as const;

/** Who is asking, for the audit log. */
export interface RequestContext {
  ip?: string | undefined;
}

export function signToken(user: { id: string; email: string }): string {
  return jwt.sign({ email: user.email }, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });
}

export async function register(input: RegisterInput, ctx: RequestContext = {}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw AppError.conflict("An account with this email already exists");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  try {
    const user = await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUserSelect,
    });
    void audit({ action: "USER_REGISTERED", actorId: user.id, actorLabel: maskEmail(user.email), targetId: user.id, targetLabel: maskEmail(user.email), ip: ctx.ip });
    return { user, token: signToken(user) };
  } catch (err) {
    // Two simultaneous registrations with the same email: the unique index wins.
    if ((err as { code?: string }).code === "P2002") {
      throw AppError.conflict("An account with this email already exists");
    }
    throw err;
  }
}

export async function login(input: LoginInput, ctx: RequestContext = {}) {
  const record = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await bcrypt.compare(input.password, record?.passwordHash ?? DUMMY_HASH);

  if (!record || !ok) {
    void audit({ action: "LOGIN_FAILED", targetLabel: maskEmail(input.email), ip: ctx.ip });
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  // Only after the password is right, so this message cannot be used to find out who has an account.
  if (record.status === "SUSPENDED") {
    void audit({ action: "LOGIN_BLOCKED_SUSPENDED", targetId: record.id, targetLabel: maskEmail(record.email), ip: ctx.ip });
    throw new AppError(403, "ACCOUNT_SUSPENDED", "This account has been suspended.");
  }

  await prisma.user.update({ where: { id: record.id }, data: { lastLoginAt: new Date() } });
  void audit({ action: "LOGIN_SUCCESS", actorId: record.id, actorLabel: maskEmail(record.email), ip: ctx.ip });

  const publicUser = {
    id: record.id,
    name: record.name,
    email: record.email,
    currency: record.currency,
    createdAt: record.createdAt,
    role: record.role,
    mustChangePassword: record.mustChangePassword,
  };
  return { user: publicUser, token: signToken(publicUser) };
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: publicUserSelect });
}

export async function updateProfile(id: string, input: UpdateProfileInput) {
  return prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
    select: publicUserSelect,
  });
}

/** Re-checks the password of the logged-in user. Wrong password: 403 (not 401, so the app does not log the user out). */
async function verifyCurrentPassword(userId: string, password: string) {
  const record = await prisma.user.findUnique({ where: { id: userId } });
  if (!record) throw AppError.unauthorized("Authentication required");
  const ok = await bcrypt.compare(password, record.passwordHash);
  if (!ok) throw new AppError(403, "WRONG_PASSWORD", "That password is not correct");
  return record;
}

export async function changeEmail(userId: string, input: ChangeEmailInput, ctx: RequestContext = {}) {
  const record = await verifyCurrentPassword(userId, input.currentPassword);
  if (record.email === input.email) throw AppError.badRequest("That is already your email address");

  const taken = await prisma.user.findUnique({ where: { email: input.email } });
  if (taken) throw AppError.conflict("An account with this email already exists");

  try {
    const user = await prisma.user.update({ where: { id: userId }, data: { email: input.email }, select: publicUserSelect });
    void audit({ action: "EMAIL_CHANGED", actorId: userId, actorLabel: maskEmail(user.email), targetId: userId, ip: ctx.ip, metadata: { from: maskEmail(record.email) } });
    return { user, token: signToken(user) };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw AppError.conflict("An account with this email already exists");
    }
    throw err;
  }
}

export async function changePassword(userId: string, input: ChangePasswordInput, ctx: RequestContext = {}) {
  const record = await verifyCurrentPassword(userId, input.currentPassword);
  const passwordHash = await bcrypt.hash(input.newPassword, BCRYPT_COST);
  // A password the user chose themselves also clears the "must change" flag of the seeded admin.
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
  void audit({ action: "PASSWORD_CHANGED", actorId: userId, actorLabel: maskEmail(record.email), targetId: userId, ip: ctx.ip });
}

/** Permanently deletes the user and all their data. Transactions go first because accounts and categories are RESTRICTed. */
export async function deleteAccount(userId: string, input: DeleteAccountInput, ctx: RequestContext = {}) {
  const record = await verifyCurrentPassword(userId, input.password);
  if (record.role === "SUPER_ADMIN") throw AppError.forbidden("The administrator account cannot be deleted");
  await purgeUser(userId);
  void audit({ action: "ACCOUNT_DELETED_BY_USER", actorLabel: maskEmail(record.email), targetLabel: maskEmail(record.email), ip: ctx.ip });
}
