import express from "express";
import { gatewayAuth } from "../middleware/gatewayAuth.js";
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
GatewaysRouter.post("/register", registerGateway);

// Gateway control plane: gateway API token auth
GatewaysRouter.post("/heartbeat", gatewayAuth, heartbeat);

// Gateway telemetry: session events + usage reports (gateway token auth)
GatewaysRouter.post("/sessions", gatewayAuth, reportSession);
GatewaysRouter.post("/usage", gatewayAuth, reportUsage);

// Human-facing: user session auth (admin-only in task #11)
GatewaysRouter.get("/", listGateways);
GatewaysRouter.get("/:id", getGateway);

// Control plane: queue + inspect commands (operator)
GatewaysRouter.post("/:id/commands", postCommand);
GatewaysRouter.get("/:id/commands", listCommands);

// Gateway acks (gateway token auth)
GatewaysRouter.post("/commands/:messageId/ack", gatewayAuth, ackCommand);

// Peer management (operator)
GatewaysRouter.get("/:id/peers", listPeers);
GatewaysRouter.post("/:id/peers", authorizePeer);
GatewaysRouter.delete("/:id/peers/:peerId", revokePeer);

export default GatewaysRouter;
