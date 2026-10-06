import { pool } from "../config/db.js";

// Role-based guard for the admin APIs. Requires a signed-in session
// (req.authUser, set by the session middleware) whose users.role = 'admin'.
// Promote yourself once via SQL after migration 006:
//   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
const requireAdmin = async (req, res, next) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await pool.query(
            `SELECT role FROM users WHERE auth_user_id = $1`,
            [req.authUser.id]
        );

        if (result.rows.length === 0 || result.rows[0].role !== "admin") {
            return res.status(403).json({ message: "Forbidden: admins only" });
        }

        next();
    } catch (error) {
        console.error("requireAdmin error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { requireAdmin };
