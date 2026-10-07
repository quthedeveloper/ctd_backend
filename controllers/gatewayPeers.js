import { pool } from "../config/db.js";
import { enqueueCommand } from "./gatewayCommands.js";

// Tunnel IP pool for WireGuard peers (V1): 10.8.0.2 - 10.8.0.254,
// allocated sequentially per gateway.
const TUNNEL_BASE = "10.8.0";

async function allocateTunnelIp(gatewayId) {
    const r = await pool.query(
        `SELECT tunnel_ip FROM gateway_peers WHERE gateway_id = $1`,
        [gatewayId]
    );
    const used = new Set();
    for (const row of r.rows) {
        const m = /^10\.8\.0\.(\d+)$/.exec(row.tunnel_ip ?? "");
        if (m) used.add(Number(m[1]));
    }
    for (let i = 2; i <= 254; i++) {
        if (!used.has(i)) return `${TUNNEL_BASE}.${i}`;
    }
    return null;
}

async function requireOperator(req, res) {
    if (!req.authUser) {
        res.status(401).json({ message: "Unauthorized" });
        return false;
    }
    return true;
}

// GET /gateways/:id/peers — list peers on a gateway
const listPeers = async (req, res) => {
    try {
        if (!(await requireOperator(req, res))) return;

        const result = await pool.query(
            `SELECT gp.*, d.device_identifier
             FROM gateway_peers gp
             LEFT JOIN devices d ON d.id = gp.device_id
             WHERE gp.gateway_id = $1
             ORDER BY gp.tunnel_ip ASC`,
            [req.params.id]
        );

        return res.status(200).json({ peers: result.rows });
    } catch (error) {
        console.error("listPeers error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /gateways/:id/peers — authorize a device as a WireGuard peer.
// Body: { device_id }
// Creates the peer row (status 'pending'), queues AUTHORIZE_PEER; the peer
// flips to 'active' when the gateway acks the command.
// NOTE: any signed-in user for now; restrict to admins in task #11.
const authorizePeer = async (req, res) => {
    try {
        if (!(await requireOperator(req, res))) return;

        const gatewayId = req.params.id;
        const gw = await pool.query(
            `SELECT id FROM gateways WHERE id = $1`,
            [gatewayId]
        );
        if (gw.rows.length === 0) {
            return res.status(404).json({ message: "Gateway not found" });
        }

        const { device_id } = req.body ?? {};
        if (!device_id) {
            return res.status(400).json({ message: "device_id is required" });
        }

        const dev = await pool.query(
            `SELECT id, public_key FROM devices WHERE id = $1`,
            [device_id]
        );
        if (dev.rows.length === 0) {
            return res.status(404).json({ message: "Device not found" });
        }

        const dup = await pool.query(
            `SELECT id FROM gateway_peers
             WHERE gateway_id = $1 AND device_id = $2
               AND status IN ('pending', 'active')`,
            [gatewayId, device_id]
        );
        if (dup.rows.length > 0) {
            return res.status(409).json({
                message: "Device is already peered on this gateway"
            });
        }

        // unique_gateway_device blocks re-authorizing a device whose old
        // peer row lingers in a terminal state — clear those first.
        await pool.query(
            `DELETE FROM gateway_peers
             WHERE gateway_id = $1 AND device_id = $2
               AND status IN ('revoked', 'error', 'inactive')`,
            [gatewayId, device_id]
        );

        const tunnel_ip = await allocateTunnelIp(gatewayId);
        if (!tunnel_ip) {
            return res.status(507).json({
                message: "No free tunnel IPs left on this gateway"
            });
        }

        const peer = await pool.query(
            `INSERT INTO gateway_peers
                (gateway_id, device_id, tunnel_ip, public_key, status)
             VALUES ($1, $2, $3, $4, 'pending')
             RETURNING *`,
            [gatewayId, device_id, tunnel_ip, dev.rows[0].public_key]
        );

        const command = await enqueueCommand(gatewayId, "AUTHORIZE_PEER", {
            peer_id: peer.rows[0].id,
            device_id,
            public_key: dev.rows[0].public_key,
            tunnel_ip,
        });

        return res.status(201).json({
            message: "Peer authorization queued — applies on next gateway heartbeat",
            peer: peer.rows[0],
            command_id: command.message_id,
        });
    } catch (error) {
        console.error("authorizePeer error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// DELETE /gateways/:id/peers/:peerId — revoke a peer.
// Marks 'revoking', queues REVOKE_PEER; flips to 'revoked' on gateway ack.
const revokePeer = async (req, res) => {
    try {
        if (!(await requireOperator(req, res))) return;

        const peer = await pool.query(
            `SELECT * FROM gateway_peers WHERE id = $1 AND gateway_id = $2`,
            [req.params.peerId, req.params.id]
        );
        if (peer.rows.length === 0) {
            return res.status(404).json({ message: "Peer not found" });
        }
        if (!["pending", "active"].includes(peer.rows[0].status)) {
            return res.status(409).json({
                message: `Peer is already ${peer.rows[0].status}`
            });
        }

        await pool.query(
            `UPDATE gateway_peers SET status = 'revoking' WHERE id = $1`,
            [peer.rows[0].id]
        );

        const command = await enqueueCommand(req.params.id, "REVOKE_PEER", {
            peer_id: peer.rows[0].id,
            device_id: peer.rows[0].device_id,
            public_key: peer.rows[0].public_key,
            tunnel_ip: peer.rows[0].tunnel_ip,
        });

        return res.status(200).json({
            message: "Peer revocation queued — applies on next gateway heartbeat",
            command_id: command.message_id,
        });
    } catch (error) {
        console.error("revokePeer error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { listPeers, authorizePeer, revokePeer };
