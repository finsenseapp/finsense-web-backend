import type { CookieOptions, Request, Response } from "express";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/errors.js";
import * as authService from "./auth.service.js";

export const COOKIE_NAME = "finsense_token";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: env.NODE_ENV === "production",
  path: "/",
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function register(req: Request, res: Response) {
  const { user, token } = await authService.register(req.body, { ip: req.ip });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
  res.status(201).json({ user });
}

export async function login(req: Request, res: Response) {
  const { user, token } = await authService.login(req.body, { ip: req.ip });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
  res.json({ user });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, cookieOptions);
  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  const user = await authService.getUserById(req.user!.id);
  if (!user) {
    // Token is valid but the user no longer exists
    res.clearCookie(COOKIE_NAME, cookieOptions);
    throw AppError.unauthorized("Authentication required");
  }
  res.json({ user });
}

export async function updateMe(req: Request, res: Response) {
  res.json({ user: await authService.updateProfile(req.user!.id, req.body) });
}

export async function changeEmail(req: Request, res: Response) {
  const { user, token } = await authService.changeEmail(req.user!.id, req.body, { ip: req.ip });
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SEVEN_DAYS_MS }); // the token carries the email
  res.json({ user });
}

export async function changePassword(req: Request, res: Response) {
  await authService.changePassword(req.user!.id, req.body, { ip: req.ip });
  res.json({ ok: true });
}

export async function deleteAccount(req: Request, res: Response) {
  await authService.deleteAccount(req.user!.id, req.body, { ip: req.ip });
  res.clearCookie(COOKIE_NAME, cookieOptions);
  res.json({ ok: true });
}
