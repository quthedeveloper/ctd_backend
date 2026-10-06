import express from "express";
import { listSessions, listActiveSessions } from "../controllers/sessions.js";

const SessionsRouter = express.Router();

SessionsRouter.get("/", listSessions);
SessionsRouter.get("/active", listActiveSessions);

export default SessionsRouter;
