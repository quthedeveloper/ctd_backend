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

dotenv.config();

const PORT = process.env.PORT;

const app = express();

// Better Auth owns /api/auth/* (sign-up, sign-in, sign-out, session, ...)
// NOTE: Express 5 requires the wildcard to be named (/*splat).
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

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
const result = await confirmation(pool);

app.listen(PORT, ()=>{
console.log(`server working at port: ${PORT}`);
console.log(result)
});
