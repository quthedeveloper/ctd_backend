import express from "express";
import { listPackages, getPackage, createPackage } from "../controllers/packages.js";

const PackagesRouter = express.Router();

PackagesRouter.get("/", listPackages);
PackagesRouter.get("/:id", getPackage);
PackagesRouter.post("/", createPackage);

export default PackagesRouter;
