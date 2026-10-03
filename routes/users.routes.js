import express from "express";
import userAuth from "../controllers/usersAuth.js";

const UserAuthRouter = express.Router();

UserAuthRouter.get("/me", userAuth);

export default UserAuthRouter;