import express from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
    listUsers,
    getUser,
    updateUserStatus,
    updateUserRole,
    listGatewaysAdmin,
    deleteGateway,
    updatePackage,
    deletePackage,
    listPayments,
    listAuditLogs,
    getStats,
} from "../controllers/admin.js";

const AdminRouter = express.Router();

// Everything under /admin requires the admin role
AdminRouter.use(requireAdmin);

AdminRouter.get("/stats", getStats);

AdminRouter.get("/users", listUsers);
AdminRouter.get("/users/:id", getUser);
AdminRouter.patch("/users/:id", updateUserStatus);
AdminRouter.patch("/users/:id/role", updateUserRole);

AdminRouter.get("/gateways", listGatewaysAdmin);
AdminRouter.delete("/gateways/:id", deleteGateway);

AdminRouter.patch("/packages/:id", updatePackage);
AdminRouter.delete("/packages/:id", deletePackage);

AdminRouter.get("/payments", listPayments);
AdminRouter.get("/audit-logs", listAuditLogs);

export default AdminRouter;
