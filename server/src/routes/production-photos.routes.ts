import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { UserRole } from "../../generated/prisma/client";
import { prisma } from "../config/database";
import {
  requireAuth,
  allowRoles,
} from "../middleware/auth.middleware";
import type { AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();
const uploadsDirectory = path.resolve(process.cwd(), "uploads");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const mimeTypeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only JPG, PNG and WebP images are allowed."));
      return;
    }
    callback(null, true);
  },
});

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
  }

  if (mimeType === "image/webp") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }

  return false;
}

function isSafePhotoFilename(filename: string): boolean {
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename);
}

// --------------------------------------------------
// GET: AUTHENTICATED PHOTO DELIVERY
// Buyers: own company only.
// Supervisors: assigned unit only.
// Merchandisers: all orders.
// --------------------------------------------------
router.get(
  "/file/:filename",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      const rawFilename = req.params.filename;
      const filename = Array.isArray(rawFilename) ? rawFilename[0] : rawFilename;

      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Express 5 route params can be string | string[]. Normalize and validate
      // before passing the value to path or Prisma APIs.
      if (typeof filename !== "string" || !isSafePhotoFilename(filename)) {
        return res.status(404).json({ message: "Photo not found" });
      }

      // Find the update that owns this file. Fetch orderId first, then perform
      // a separate order lookup to keep the relation type explicit.
      const photoRecord = await prisma.productionUpdate.findFirst({
        where: {
          photoUrl: {
            endsWith: filename,
          },
        },
        select: {
          orderId: true,
        },
      });

      if (!photoRecord) {
        return res.status(404).json({ message: "Photo not found" });
      }

      const order = await prisma.order.findUnique({
        where: {
          id: photoRecord.orderId,
        },
        select: {
          buyerId: true,
          unitName: true,
        },
      });

      if (!order) {
        return res.status(404).json({ message: "Photo not found" });
      }

      const orderAccessAllowed =
        user.role === UserRole.MERCHANDISER ||
        (user.role === UserRole.BUYER &&
          Boolean(user.buyerId) &&
          user.buyerId === order.buyerId) ||
        (user.role === UserRole.SUPERVISOR &&
          Boolean(user.unitId) &&
          user.unitId === order.unitName);

      // Use 404 for inaccessible files to avoid revealing their existence.
      if (!orderAccessAllowed) {
        return res.status(404).json({ message: "Photo not found" });
      }

      const extension = path.extname(filename).toLowerCase();
      const mimeType = mimeTypeByExtension[extension];
      if (!mimeType) {
        return res.status(404).json({ message: "Photo not found" });
      }

      const filePath = path.join(uploadsDirectory, filename);
      const imageBuffer = await readFile(filePath);

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", imageBuffer.length);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(imageBuffer);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return res.status(404).json({ message: "Photo file not found" });
      }

      console.error("Protected photo retrieval error:", error);
      return res.status(500).json({
        message: "Unable to retrieve production photo",
      });
    }
  },
);

// --------------------------------------------------
// DELETE: REMOVE PHOTO FROM PRODUCTION EVIDENCE
// Merchandiser only.
// Keeps the production report and quantity intact.
// --------------------------------------------------

router.delete(
  "/updates/:updateId/photo",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req: Request, res: Response) => {
    try {
      const rawUpdateId = req.params.updateId;
      const updateId = Array.isArray(rawUpdateId)
        ? rawUpdateId[0]
        : rawUpdateId;

      if (typeof updateId !== "string" || !updateId.trim()) {
        return res.status(400).json({
          message: "Valid production update ID is required",
        });
      }

      const update = await prisma.productionUpdate.findUnique({
        where: { id: updateId },
        select: {
          id: true,
          photoUrl: true,
        },
      });

      if (!update) {
        return res.status(404).json({
          message: "Production update not found",
        });
      }

      if (!update.photoUrl) {
        return res.status(404).json({
          message: "No photo is attached to this production update",
        });
      }

      // Extract and validate the stored image filename.
      const photoPath = new URL(
        update.photoUrl,
        "http://localhost",
      ).pathname;

      const filename = path.basename(photoPath);

      if (!isSafePhotoFilename(filename)) {
        return res.status(400).json({
          message: "Stored photo filename is invalid",
        });
      }

      // Clear only the photo reference. Keep quantity, stage,
      // issue note and production history untouched.
      await prisma.productionUpdate.update({
        where: { id: updateId },
        data: { photoUrl: null },
      });

      // Delete the physical file only if no other update references it.
      let fileDeleted = false;

      const remainingReferences = await prisma.productionUpdate.count({
        where: {
          id: { not: updateId },
          photoUrl: { endsWith: filename },
        },
      });

      if (remainingReferences === 0) {
        try {
          await unlink(path.join(uploadsDirectory, filename));
          fileDeleted = true;
        } catch (fileError) {
          const code = (fileError as NodeJS.ErrnoException).code;

          if (code !== "ENOENT") {
            console.warn(
              "Photo reference cleared, but physical file cleanup failed:",
              fileError,
            );
          }
        }
      }

      return res.json({
        success: true,
        message:
          "Photo removed. Production report and quantity were preserved.",
        updateId,
        fileDeleted,
      });
    } catch (error) {
      console.error("Photo removal error:", error);

      return res.status(500).json({
        message: "Unable to remove production photo",
      });
    }
  },
);

// --------------------------------------------------
// POST: SUPERVISOR PHOTO UPLOAD
// --------------------------------------------------
router.post(
  "/upload",
  requireAuth,
  allowRoles(UserRole.SUPERVISOR),
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      if (!user || !user.unitId) {
        return res.status(403).json({
          message: "Supervisor is not assigned to a production unit",
        });
      }

      const orderId = req.body?.orderId;
      if (typeof orderId !== "string" || !orderId.trim()) {
        return res.status(400).json({ message: "Order ID is required" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Please select a production photo" });
      }

      if (!hasValidImageSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({
          message: "The selected file is not a valid JPG, PNG or WebP image",
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, unitName: true },
      });

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.unitName !== user.unitId) {
        return res.status(403).json({
          message: "You cannot upload photos for another production unit",
        });
      }

      const extension = extensionByMimeType[req.file.mimetype];
      if (!extension) {
        return res.status(400).json({ message: "Unsupported image format" });
      }

      const filename = `${randomUUID()}${extension}`;

      await mkdir(uploadsDirectory, { recursive: true });
      await writeFile(path.join(uploadsDirectory, filename), req.file.buffer, {
        flag: "wx",
      });

      // The production-update validator expects photoUrl to be a valid URL.
      // The order API rewrites this into a relative authenticated image path.
      const baseUrl = (process.env.API_PUBLIC_URL || "http://localhost:5000").replace(/\/$/, "");
      const photoUrl = `${baseUrl}/api/production-photos/file/${filename}`;

      return res.status(201).json({
        success: true,
        message: "Production photo uploaded successfully",
        photoUrl,
      });
    } catch (error) {
      console.error("Production photo upload error:", error);
      return res.status(500).json({
        message: "Unable to upload production photo",
      });
    }
  },
);

export default router;
