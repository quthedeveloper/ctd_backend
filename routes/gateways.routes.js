import express from "express";
import { gatewayAuth } from "../middleware/gatewayAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { rateLimit, perIp, perGateway } from "../middleware/rateLimit.js";
import {
    postCommand,
    listCommands,
    ackCommand,
} from "../controllers/gatewayCommands.js";
import {
    listPeers,
    authorizePeer,
    revokePeer,
} from "../controllers/gatewayPeers.js";
import {
    registerGateway,
    heartbeat,
    listGateways,
    getGateway,
} from "../controllers/gateways.js";
import { reportSession } from "../controllers/sessions.js";
import { reportUsage } from "../controllers/usage.js";

const GatewaysRouter = express.Router();

// Bootstrap: provision-token auth (see controller), NOT a user session
GatewaysRouter.post(
    "/register",
    rateLimit({ key: perIp, limit: 10, windowSeconds: 60 }),
    registerGateway
);

// Gateway control plane: gateway API token auth
GatewaysRouter.post(
    "/heartbeat",
    gatewayAuth,
    rateLimit({ key: perGateway, limit: 30, windowSeconds: 60 }),
    heartbeat
);

// Gateway telemetry: session events + usage reports (gateway token auth)
GatewaysRouter.post(
    "/sessions",
    gatewayAuth,
    rateLimit({ key: perGateway, limit: 120, windowSeconds: 60 }),
    reportSession
);
GatewaysRouter.post(
    "/usage",
    gatewayAuth,
    rateLimit({ key: perGateway, limit: 120, windowSeconds: 60 }),
    reportUsage
);

// Human-facing: admin only
GatewaysRouter.get("/", requireAdmin, listGateways);
GatewaysRouter.get("/:id", requireAdmin, getGateway);

// Control plane: queue + inspect commands (operator)
GatewaysRouter.post("/:id/commands", requireAdmin, postCommand);
GatewaysRouter.get("/:id/commands", requireAdmin, listCommands);

// Gateway acks (gateway token auth)
GatewaysRouter.post("/commands/:messageId/ack", gatewayAuth, ackCommand);

// Peer management (operator)
GatewaysRouter.get("/:id/peers", requireAdmin, listPeers);
GatewaysRouter.post("/:id/peers", requireAdmin, authorizePeer);
GatewaysRouter.delete("/:id/peers/:peerId", requireAdmin, revokePeer);

export default GatewaysRouter;
