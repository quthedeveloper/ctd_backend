import crypto from "node:crypto";
import { pool } from "../config/db.js";

// Command types the backend can send to a gateway (PDF section 11)
const COMMAND_TYPES = [
    "CONFIG_UPDATE",
    "AUTHORIZE_PEER",
    "REVOKE_PEER",
    "UPDATE_QOS",
    "DISCONNECT_SESSION",
    "ROTATE_CONFIG",
    "REQUEST_USAGE_SYNC",
];

// Queue a command for a gateway. The gateway picks it up on its next
// heartbeat (it initiates all communication — PDF section 11).
const enqueueCommand = async (gatewayId, type, payload = {}) => {
    const message_id = crypto.randomUUID();
    const result = await pool.query(
        `INSERT INTO gateway_commands
            (gateway_id, message_id, type, payload, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING *`,
        [gatewayId, message_id, type, JSON.stringify(payload)]
    );
    return result.rows[0];
};

// Fetch + mark delivered every pending command for a gateway, shaped as
// the control-plane message the PDF describes: protocol version,
// gateway id, message id, timestamp, type, payload.
const deliverPendingCommands = async (gatewayId) => {
    const result = await pool.query(
        `UPDATE gateway_commands
         SET status = 'delivered', delivered_at = NOW()
         WHERE id IN (
             SELECT id FROM gateway_commands
             WHERE gateway_id = $1 AND status = 'pending'
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
         )
         RETURNING message_id, type, payload, created_at`,
        [gatewayId]
    );

    return result.rows.map((row) => ({
        protocol_version: "1.0",
        gateway_id: gatewayId,
        message_id: row.message_id,
        timestamp: new Date().toISOString(),
        type: row.type,
        payload: row.payload,
    }));
};

// POST /gateways/:id/commands — enqueue a command (operator).
// Body: { type, payload? }
// NOTE: any signed-in user for now; restrict to admins in task #11.
const postCommand = async (req, res) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { type, payload } = req.body ?? {};
        if (!COMMAND_TYPES.includes(type)) {
            return res.status(400).json({
                message: `type must be one of: ${COMMAND_TYPES.join(", ")}`
            });
        }

        const gw = await pool.query(
            `SELECT id FROM gateways WHERE id = $1`,
            [req.params.id]
        );
        if (gw.rows.length === 0) {
            return res.status(404).json({ message: "Gateway not found" });
        }

        const command = await enqueueCommand(req.params.id, type, payload ?? {});

        return res.status(201).json({
            message: "Command queued",
            command: {
                message_id: command.message_id,
                type: command.type,
                status: command.status,
            },
        });
    } catch (error) {
        console.error("postCommand error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /gateways/:id/commands — list queued/delivered commands (?status=)
const listCommands = async (req, res) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { status } = req.query;
        const params = [req.params.id];
        let sql = `SELECT message_id, type, payload, status, created_at, delivered_at
                   FROM gateway_commands WHERE gateway_id = $1`;
        if (status) {
            params.push(status);
            sql += ` AND status = $2`;
        }
        sql += ` ORDER BY created_at DESC`;

        const result = await pool.query(sql, params);
        return res.status(200).json({ commands: result.rows });
    } catch (error) {
        console.error("listCommands error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /gateways/commands/:messageId/ack — gateway confirms it applied
// (or failed) a command. Idempotent: re-acking is a no-op.
// (gatewayAuth — the gateway calls this, not a user.)
const ackCommand = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { status = "acknowledged" } = req.body ?? {};

        if (!["acknowledged", "failed"].includes(status)) {
            return res.status(400).json({
                message: "status must be 'acknowledged' or 'failed'"
            });
        }

        const found = await pool.query(
            `SELECT * FROM gateway_commands
             WHERE message_id = $1 AND gateway_id = $2`,
            [messageId, req.gateway.id]
        );
        if (found.rows.length === 0) {
            return res.status(404).json({ message: "Command not found" });
        }

        const command = found.rows[0];
        if (command.status === "acknowledged") {
            return res.status(200).json({ message: "Already acknowledged" });
        }

        await pool.query(
            `UPDATE gateway_commands SET status = $1 WHERE message_id = $2`,
            [status, messageId]
        );

        // Drive peer state from command outcomes
        const peerId = command.payload?.peer_id;
        if (peerId) {
            if (command.type === "AUTHORIZE_PEER" && status === "acknowledged") {
                await pool.query(
                    `UPDATE gateway_peers SET status = 'active' WHERE id = $1`,
                    [peerId]
                );
            } else if (command.type === "REVOKE_PEER" && status === "acknowledged") {
                await pool.query(
                    `UPDATE gateway_peers SET status = 'revoked' WHERE id = $1`,
                    [peerId]
                );
            } else if (status === "failed") {
                await pool.query(
                    `UPDATE gateway_peers SET status = 'error' WHERE id = $1`,
                    [peerId]
                );
            }
        }

        return res.status(200).json({ message: "Ack recorded" });
    } catch (error) {
        console.error("ackCommand error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export {
    COMMAND_TYPES,
    enqueueCommand,
    deliverPendingCommands,
    postCommand,
    listCommands,
    ackCommand,
};
