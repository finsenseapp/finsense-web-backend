import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma.js";
import type { CategoryType } from "../src/generated/prisma/client.js";

const SYSTEM_CATEGORIES: { name: string; type: CategoryType; icon: string }[] = [
  { name: "Food & Dining", type: "EXPENSE", icon: "utensils" },
  { name: "Transport", type: "EXPENSE", icon: "car" },
  { name: "Utilities", type: "EXPENSE", icon: "zap" },
  { name: "Shopping", type: "EXPENSE", icon: "shopping-bag" },
  { name: "Entertainment", type: "EXPENSE", icon: "film" },
  { name: "Health", type: "EXPENSE", icon: "heart-pulse" },
  { name: "Other", type: "EXPENSE", icon: "circle-ellipsis" },
  { name: "Salary", type: "INCOME", icon: "wallet" },
  { name: "Other Income", type: "INCOME", icon: "plus-circle" },
];

/**
 * The developer-side Super Admin. In development the documented default password is used; in production the
 * password must be supplied in ADMIN_SEED_PASSWORD (a known default must never reach a live system). The account
 * is created only if it does not exist yet, and must change its password at the first login.
 */
async function seedAdmin() {
  const email = (process.env.ADMIN_SEED_EMAIL ?? "superadmin@finsense.com").toLowerCase();
  const production = process.env.NODE_ENV === "production";
  const password = process.env.ADMIN_SEED_PASSWORD ?? (production ? undefined : "Admin@123");
  if (!password) {
    console.warn("Admin not seeded: set ADMIN_SEED_PASSWORD (required in production).");
    return;
  }
  if (await prisma.user.findUnique({ where: { email } })) {
    console.log("Admin already exists: left unchanged.");
    return;
  }
  await prisma.user.create({
    data: {
      name: "SupAdmin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "SUPER_ADMIN",
      mustChangePassword: true,
    },
  });
  console.log("Admin created (must change the password at the first login).");
}

async function main() {
  let created = 0;
  for (const cat of SYSTEM_CATEGORIES) {
    // Postgres unique constraints ignore NULLs, so find-then-create on (userId = null, name, type).
    const existing = await prisma.category.findFirst({
      where: { userId: null, name: cat.name, type: cat.type },
    });
    if (!existing) {
      await prisma.category.create({ data: { ...cat, userId: null } });
      created++;
    }
  }
  console.log(`Seed complete: ${created} created, ${SYSTEM_CATEGORIES.length - created} already existed.`);
  await seedAdmin();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
