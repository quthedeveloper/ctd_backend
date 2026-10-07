import express from "express";
import dotenv from "dotenv";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth } from "./config/auth.js";
import { confirmation, pool } from "./config/db.js";
import UserAuthRouter from "./routes/users.routes.js";
import DevicesRouter from "./routes/devices.routes.js";
import PackagesRouter from "./routes/packages.routes.js";
import TrialsRouter from "./routes/trials.routes.js";
import SubscriptionsRouter from "./routes/subscriptions.routes.js";
import GatewaysRouter from "./routes/gateways.routes.js";
import SessionsRouter from "./routes/sessions.routes.js";
import UsageRouter from "./routes/usage.routes.js";
import AdminRouter from "./routes/admin.routes.js";
import { initRedis } from "./config/redis.js";
import { rateLimit, perIp } from "./middleware/rateLimit.js";

dotenv.config();

const PORT = process.env.PORT;

const app = express();

// Better Auth owns /api/auth/* (sign-up, sign-in, sign-out, session, ...)
// NOTE: Express 5 requires the wildcard to be named (/*splat).
// Auth endpoints are brute-force sensitive: 20 requests/min per IP
app.all(
    "/api/auth/*splat",
    rateLimit({ key: perIp, limit: 20, windowSeconds: 60 }),
    toNodeHandler(auth)
);

app.use(express.json());

// Optional: enables Redis caching + distributed rate limits
initRedis();

// Session middleware: verifies the Better Auth session and exposes the
// signed-in user as req.authUser (null when signed out).
// This replaces clerkMiddleware().
app.use(async (req, res, next) => {
    try {
        const session = await auth.api.getSession({
            headers: fromNodeHeaders(req.headers),
        });
        req.authUser = session?.user ?? null;
    } catch {
        req.authUser = null;
    }
    next();
});

// routes
app.use("/auth/user", UserAuthRouter);
app.use("/devices", DevicesRouter);
app.use("/packages", PackagesRouter);
app.use("/trials", TrialsRouter);
app.use("/subscriptions", SubscriptionsRouter);
app.use("/gateways", GatewaysRouter);
app.use("/sessions", SessionsRouter);
app.use("/usage", UsageRouter);
app.use("/admin", AdminRouter);
const result = await confirmation(pool);

app.listen(PORT, ()=>{
console.log(`server working at port: ${PORT}`);
console.log(result)
});
