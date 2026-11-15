/**
 * Creates (or removes) a Super Admin account.
 *
 *   npm run admin:create -- <email> <password> [--no-force-change]
 *   npm run admin:create -- <email> --remove
 *
 * By default the admin must change the password at the first login. Admins are never created through the app.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

const [email, password, ...flags] = process.argv.slice(2).filter((a) => a !== "--");
const remove = password === "--remove" || flags.includes("--remove");

async function main() {
  if (!email) throw new Error("Usage: npm run admin:create -- <email> <password> [--no-force-change] | <email> --remove");
  const normalized = email.trim().toLowerCase();

  if (remove) {
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) return console.log(`No account with that email: nothing removed.`);
    if (user.role !== "SUPER_ADMIN") throw new Error("That account is not an admin: refusing to remove it here.");
    await prisma.user.delete({ where: { id: user.id } });
    return console.log(`Admin removed.`);
  }

  if (!password || password.length < 8) throw new Error("The password must be at least 8 characters.");
  if (await prisma.user.findUnique({ where: { email: normalized } })) throw new Error("An account with that email already exists.");

  await prisma.user.create({
    data: {
      name: "SupAdmin",
      email: normalized,
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      mustChangePassword: !flags.includes("--no-force-change"),
    },
  });
  console.log(`Admin created${flags.includes("--no-force-change") ? "" : " (must change the password at the first login)"}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
