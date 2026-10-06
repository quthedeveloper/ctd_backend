import { pool } from "../config/db.js";
import { auditLog } from "../utils/audit.js";
import { decorateGateway } from "./gateways.js";

const HEARTBEAT_TIMEOUT_SECONDS = Number(
    process.env.GATEWAY_HEARTBEAT_TIMEOUT_SECONDS ?? 90
);

// ---------- Users ----------

// GET /admin/users — list all users
const listUsers = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, phone, status, role, created_at
             FROM users ORDER BY created_at DESC LIMIT 100`
        );
        return res.status(200).json({ users: result.rows });
    } catch (error) {
        console.error("admin listUsers error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /admin/users/:id — user detail with devices, subscriptions, trials
const getUser = async (req, res) => {
    try {
        const user = await pool.query(
            `SELECT id, full_name, email, phone, status, role, created_at
             FROM users WHERE id = $1`,
            [req.params.id]
        );
        if (user.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        const [devices, subscriptions, trials] = await Promise.all([
            pool.query(`SELECT * FROM devices WHERE user_id = $1`, [req.params.id]),
            pool.query(
                `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY starts_at DESC`,
                [req.params.id]
            ),
            pool.query(
                `SELECT * FROM trials WHERE user_id = $1 ORDER BY starts_at DESC`,
                [req.params.id]
            ),
        ]);

        return res.status(200).json({
            user: user.rows[0],
            devices: devices.rows,
            subscriptions: subscriptions.rows,
            trials: trials.rows,
        });
    } catch (error) {
        console.error("admin getUser error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// PATCH /admin/users/:id — update account status (e.g. suspend)
// Body: { status }
const updateUserStatus = async (req, res) => {
    try {
        const { status } = req.body ?? {};
        if (!status || typeof status !== "string") {
            return res.status(400).json({ message: "status is required" });
        }

        const result = await pool.query(
            `UPDATE users SET status = $1 WHERE id = $2 RETURNING id, email, status`,
            [status, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        await auditLog({
            actor: req.authUser.email,
            action: "user.status.update",
            resource: `users:${req.params.id}`,
            metadata: { status },
        });

        return res.status(200).json({
            message: "User status updated",
            user: result.rows[0],
        });
    } catch (error) {
        console.error("admin updateUserStatus error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// PATCH /admin/users/:id/role — promote/demote
// Body: { role: 'admin' | 'customer' }
const updateUserRole = async (req, res) => {
    try {
        const { role } = req.body ?? {};
        if (!["admin", "customer"].includes(role)) {
            return res.status(400).json({
                message: "role must be 'admin' or 'customer'"
            });
        }

        const target = await pool.query(
            `SELECT id, auth_user_id FROM users WHERE id = $1`,
            [req.params.id]
        );
        if (target.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        if (target.rows[0].auth_user_id === req.authUser.id) {
            return res.status(400).json({
                message: "You cannot change your own role"
            });
        }

        const result = await pool.query(
            `UPDATE users SET role = $1 WHERE id = $2 RETURNING id, email, role`,
            [role, req.params.id]
        );

        await auditLog({
            actor: req.authUser.email,
            action: "user.role.update",
            resource: `users:${req.params.id}`,
            metadata: { role },
        });

        return res.status(200).json({
            message: "User role updated",
            user: result.rows[0],
        });
    } catch (error) {
        console.error("admin updateUserRole error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// ---------- Gateways ----------

// GET /admin/gateways — list gateways with live online state
const listGatewaysAdmin = async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM gateways ORDER BY name ASC`);
        return res.status(200).json({
            gateways: result.rows.map(decorateGateway),
        });
    } catch (error) {
        console.error("admin listGateways error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// DELETE /admin/gateways/:id — remove a gateway and its peers
// (queued commands cascade via FK)
const deleteGateway = async (req, res) => {
    try {
        const gw = await pool.query(`SELECT id, name FROM gateways WHERE id = $1`, [
            req.params.id,
        ]);
        if (gw.rows.length === 0) {
            return res.status(404).json({ message: "Gateway not found" });
        }

        await pool.query(`DELETE FROM gateway_peers WHERE gateway_id = $1`, [
            req.params.id,
        ]);
        await pool.query(`DELETE FROM gateways WHERE id = $1`, [req.params.id]);

        await auditLog({
            actor: req.authUser.email,
            action: "gateway.delete",
            resource: `gateways:${req.params.id}`,
            metadata: { name: gw.rows[0].name },
        });

        return res.status(200).json({ message: "Gateway deleted" });
    } catch (error) {
        console.error("admin deleteGateway error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// ---------- Packages ----------

// PATCH /admin/packages/:id — update a package
const updatePackage = async (req, res) => {
    try {
        const allowed = [
            "name",
            "price",
            "currency",
            "quota_bytes",
            "duration_hours",
            "speed_policy",
        ];
        const sets = [];
        const values = [];
        let i = 1;

        for (const key of allowed) {
            if (req.body?.[key] !== undefined) {
                if (
                    ["price", "quota_bytes", "duration_hours"].includes(key) &&
                    (!Number.isFinite(Number(req.body[key])) ||
                        Number(req.body[key]) < 0)
                ) {
                    return res.status(400).json({
                        message: `${key} must be a non-negative number`
                    });
                }
                sets.push(`${key} = $${i++}`);
                values.push(req.body[key]);
            }
        }

        if (sets.length === 0) {
            return res.status(400).json({ message: "No updatable fields provided" });
        }

        values.push(req.params.id);
        const result = await pool.query(
            `UPDATE packages SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
            values
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }

        await auditLog({
            actor: req.authUser.email,
            action: "package.update",
            resource: `packages:${req.params.id}`,
            metadata: req.body,
        });

        return res.status(200).json({
            message: "Package updated",
            package: result.rows[0],
        });
    } catch (error) {
        console.error("admin updatePackage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// DELETE /admin/packages/:id — delete a package
const deletePackage = async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM packages WHERE id = $1 RETURNING id, name`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }

        await auditLog({
            actor: req.authUser.email,
            action: "package.delete",
            resource: `packages:${req.params.id}`,
            metadata: { name: result.rows[0].name },
        });

        return res.status(200).json({ message: "Package deleted" });
    } catch (error) {
        console.error("admin deletePackage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// ---------- Payments ----------

// GET /admin/payments — list all payment records
const listPayments = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.email AS user_email
             FROM payments p
             LEFT JOIN users u ON u.id = p.user_id
             ORDER BY p.created_at DESC
             LIMIT 100`
        );
        return res.status(200).json({ payments: result.rows });
    } catch (error) {
        console.error("admin listPayments error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// ---------- Audit ----------

// GET /admin/audit-logs — security/operation history
const listAuditLogs = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100`
        );
        return res.status(200).json({ audit_logs: result.rows });
    } catch (error) {
        console.error("admin listAuditLogs error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// ---------- Stats ----------

// GET /admin/stats — dashboard numbers
const getStats = async (req, res) => {
    try {
        const [users, trials, subs, gateways, commands, bytes] = await Promise.all([
            pool.query(`SELECT COUNT(*) AS n FROM users`),
            pool.query(
                `SELECT COUNT(*) AS n FROM trials WHERE status = 'active'`
            ),
            pool.query(
                `SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'`
            ),
            pool.query(`SELECT id, last_heartbeat_at FROM gateways`),
            pool.query(
                `SELECT COUNT(*) AS n FROM gateway_commands WHERE status = 'pending'`
            ),
            pool.query(
                `SELECT COALESCE(SUM(bytes_rx), 0) AS rx,
                        COALESCE(SUM(bytes_tx), 0) AS tx
                 FROM usage_records`
            ),
        ]);

        const cutoff = Date.now() - HEARTBEAT_TIMEOUT_SECONDS * 1000;
        const online = gateways.rows.filter(
            (g) =>
                g.last_heartbeat_at &&
                new Date(g.last_heartbeat_at).getTime() >= cutoff
        ).length;

        return res.status(200).json({
            stats: {
                users: Number(users.rows[0].n),
                active_trials: Number(trials.rows[0].n),
                active_subscriptions: Number(subs.rows[0].n),
                gateways_total: gateways.rows.length,
                gateways_online: online,
                pending_commands: Number(commands.rows[0].n),
                bytes_rx: Number(bytes.rows[0].rx),
                bytes_tx: Number(bytes.rows[0].tx),
            },
        });
    } catch (error) {
        console.error("admin getStats error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export {
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
};
