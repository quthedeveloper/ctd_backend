import express from "express";
import userAuth, { updateMe } from "../controllers/usersAuth.js";

const UserAuthRouter = express.Router();

UserAuthRouter.get("/me", userAuth);
UserAuthRouter.patch("/me", updateMe);

export default UserAuthRouter;
