import express from "express";
import { gatewayAuth } from "../middleware/gatewayAuth.js";
import {
    registerGateway,
    heartbeat,
    listGateways,
    getGateway,
} from "../controllers/gateways.js";

const GatewaysRouter = express.Router();

// Bootstrap: provision-token auth (see controller), NOT a user session
GatewaysRouter.post("/register", registerGateway);

// Gateway control plane: gateway API token auth
GatewaysRouter.post("/heartbeat", gatewayAuth, heartbeat);

// Human-facing: user session auth (admin-only in task #11)
GatewaysRouter.get("/", listGateways);
GatewaysRouter.get("/:id", getGateway);

export default GatewaysRouter;
