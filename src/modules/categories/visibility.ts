/** Prisma `where` fragment: system categories (userId null) plus the user's own. */
export const categoryVisibleTo = (userId: string) => ({
  OR: [{ userId: null }, { userId }],
});
