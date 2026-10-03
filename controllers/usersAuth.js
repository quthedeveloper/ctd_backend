

import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../config/db.js";


const userAuth = async(req, res)=> {
    try{

        const { userId } = getAuth(req);

        // Make sure the user is authenticated
        if (!userId) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }

        // Check if this Clerk user already exists
        const existingUser = await pool.query(
            `
            SELECT *
            FROM users
            WHERE clerk_user_id = $1
            `,
            [userId]
        );

        // If user already exists, return them
        if (existingUser.rows.length > 0) {
            return res.status(200).json({
                message: "User found",
                user: existingUser.rows[0]
            });
        }

        // Get user's information from Clerk
        const clerkUser = await clerkClient.users.getUser(userId);
        const firstName = clerkUser.firstName || "";
        const lastName = clerkUser.lastName || "";
        const phone = clerkUser.phoneNumbers[0]?.phoneNumber || null;
        const fullName = `${firstName} ${lastName}`.trim();

        // Find primary email
        const primaryEmail = clerkUser.emailAddresses.find(
            email =>
                email.id === clerkUser.primaryEmailAddressId
        );

        if (!primaryEmail) {
            return res.status(400).json({
                message: "User has no email address"
            });
        }

        const email = primaryEmail.emailAddress;

        // Create the user in CTD PostgreSQL
        const newUser = await pool.query(
            `
            INSERT INTO users (
                clerk_user_id,
                full_name,
                email,
                phone
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [
                userId,
                fullName,
                email,
                phone
            ]
        );

        return res.status(201).json({
            message: "CTD user created",
            user: newUser.rows[0]
        });

    } catch(error){
          console.error("User route error:", error);

        return res.status(500).json({
            message: "Server error"
        });
    }
}


export default userAuth;

