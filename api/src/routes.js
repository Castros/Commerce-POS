import { Router } from "express";

import { cashDrawersRouter } from "./modules/cashDrawers/cashDrawers.routes.js";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { demoRouter } from "./modules/demo/demo.routes.js";
import { studentAppRouter } from "./modules/integrations/studentApp.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { organizationsRouter } from "./modules/organizations/organizations.routes.js";
import { ordersRouter } from "./modules/orders/orders.routes.js";
import { productsRouter } from "./modules/products/products.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { storesRouter } from "./modules/stores/stores.routes.js";
import { walletsRouter } from "./modules/wallets/wallets.routes.js";
import { authenticateRequest } from "./shared/auth/auth.js";

export const apiRouter = Router();

apiRouter.use(authenticateRequest);

apiRouter.use("/organizations", organizationsRouter);
apiRouter.use("/cash-drawers", cashDrawersRouter);
apiRouter.use("/stores", storesRouter);
apiRouter.use("/products", productsRouter);
apiRouter.use("/customers", customersRouter);
apiRouter.use("/wallets", walletsRouter);
apiRouter.use("/orders", ordersRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/demo", demoRouter);
apiRouter.use("/integrations/student-app", studentAppRouter);
apiRouter.use("/inventory", inventoryRouter);
