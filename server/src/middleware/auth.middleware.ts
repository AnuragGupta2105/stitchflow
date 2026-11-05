
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "../../generated/prisma/client";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    buyerId: string | null;
    unitId: string | null;
  };
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authReq = req as AuthenticatedRequest;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication token is required",
    });
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return res.status(500).json({
      message: "Authentication configuration error",
    });
  }

  try {
    const decoded = jwt.verify(token, secret) as {
      sub: string;
      role: UserRole;
      buyerId: string | null;
      unitId: string | null;
    };

    authReq.user = {
      id: decoded.sub,
      role: decoded.role,
      buyerId: decoded.buyerId,
      unitId: decoded.unitId,
    };

    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

export const allowRoles = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user || !roles.includes(authReq.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to access this resource",
      });
    }

    next();
  };
};
