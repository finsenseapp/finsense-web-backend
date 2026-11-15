import { Router } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { accountsRouter } from "../modules/accounts/accounts.routes.js";
import { categoriesRouter } from "../modules/categories/categories.routes.js";
import { transactionsRouter } from "../modules/transactions/transactions.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { budgetsRouter } from "../modules/budgets/budgets.routes.js";
import { ratesRouter } from "../modules/rates/rates.routes.js";
import { recurringRouter } from "../modules/recurring/recurring.routes.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { goalsRouter } from "../modules/goals/goals.routes.js";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { errorsRouter } from "../modules/errors/errors.routes.js";
import { notificationsRouter } from "../modules/notifications/notifications.routes.js";
import { aiRouter } from "../modules/ai/ai.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/accounts", accountsRouter);
apiRouter.use("/categories", categoriesRouter);
apiRouter.use("/transactions", transactionsRouter);
apiRouter.use("/dashboard", dashboardRouter);
apiRouter.use("/budgets", budgetsRouter);
apiRouter.use("/ai", aiRouter);
apiRouter.use("/rates", ratesRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/recurring", recurringRouter);
apiRouter.use("/goals", goalsRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/errors", errorsRouter);
