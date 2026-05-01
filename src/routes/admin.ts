import type { Request } from "express";
import express from "express";
import multer from "multer";
import { requireRole } from "../middlewares/role.middleware";
import { uploadDriverVocabulary } from "../services/admin/drivers-upload.service";
import { uploadTemplateModel } from "../services/admin/template-upload.service";
import { AppError } from "../errors";

const adminRouter = express.Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: "Admin" | "Editor" | "Viewer";
    contributor_id: number | null;
  };
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function makeUpload(allowedMimeTypes: string[]) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new AppError(400, "VALIDATION_ERROR", `Unsupported file type: ${file.mimetype}. Allowed: ${allowedMimeTypes.join(", ")}`));
      }
      return cb(null, true);
    },
  });
}

// POST /admin/drivers/upload
adminRouter.post(
  "/drivers/upload",
  requireRole(["Admin"]),
  makeUpload(["text/csv", "application/json"]).single("file"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "Missing file field 'file'");
      }

      const result = await uploadDriverVocabulary({
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalName: file.originalname,
      });

      res.status(200).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /admin/templates/upload
adminRouter.post(
  "/templates/upload",
  requireRole(["Admin"]),
  makeUpload(["application/json"]).single("file"),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new AppError(400, "VALIDATION_ERROR", "Missing file field 'file'");
      }

      const actor = (req as AuthenticatedRequest).user;
      if (!actor) {
        throw new AppError(401, "AUTH_INVALID_CREDENTIALS", "Unauthenticated");
      }

      const result = await uploadTemplateModel({
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalName: file.originalname,
        actorEmail: actor.email,
      });

      res.status(201).json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export default adminRouter;
