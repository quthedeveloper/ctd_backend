import { pool } from "../config/db.js";

// req.authUser is set by the session middleware in index.js
// (verified Better Auth session, or null when signed out).

// GET /auth/user/me — return the caller's CTD profile.
// The CTD row is normally created by the signup hook in config/auth.js;
// this lazily creates it as a fallback so old sessions never 404.
const userAuth = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }

        const existingUser = await pool.query(
            `
            SELECT *
            FROM users
            WHERE auth_user_id = $1
            `,
            [authUser.id]
        );

        if (existingUser.rows.length > 0) {
            return res.status(200).json({
                message: "User found",
                user: existingUser.rows[0]
            });
        }

        const newUser = await pool.query(
            `
            INSERT INTO users (
                auth_user_id,
                full_name,
                email,
                status
            )
            VALUES ($1, $2, $3, 'active')
            RETURNING *
            `,
            [authUser.id, authUser.name, authUser.email]
        );

        return res.status(201).json({
            message: "CTD user created",
            user: newUser.rows[0]
        });
    } catch (error) {
        console.error("User route error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// PATCH /auth/user/me — update editable profile fields.
// Email stays owned by the auth account, so it is not editable here.
const updateMe = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }

        const { full_name, phone } = req.body ?? {};

        if (full_name === undefined && phone === undefined) {
            return res.status(400).json({
                message: "Provide full_name and/or phone to update"
            });
        }

        const result = await pool.query(
            `
            UPDATE users
            SET full_name = COALESCE($1, full_name),
                phone = COALESCE($2, phone)
            WHERE auth_user_id = $3
            RETURNING *
            `,
            [full_name ?? null, phone ?? null, authUser.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "User not found. Call GET /auth/user/me first to sync your profile."
            });
        }

        return res.status(200).json({
            message: "Profile updated",
            user: result.rows[0]
        });
    } catch (error) {
        console.error("updateMe error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

export { updateMe };
export default userAuth;
