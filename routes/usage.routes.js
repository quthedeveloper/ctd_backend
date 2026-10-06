import express from "express";
import { listUsage, usageSummary } from "../controllers/usage.js";

const UsageRouter = express.Router();

UsageRouter.get("/", listUsage);
UsageRouter.get("/summary", usageSummary);

export default UsageRouter;
