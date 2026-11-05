import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { UserRole } from "../../generated/prisma/client";
import { prisma } from "../config/database";
import { requireAuth, allowRoles } from "../middleware/auth.middleware";
import type { AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const reasonCategories = [
  "MACHINE_BREAKDOWN",
  "MATERIAL_SHORTAGE",
  "QUALITY_DEFECT",
  "LABOUR_SHORTAGE",
  "POWER_OR_UTILITY",
  "SUBCONTRACTOR_DELAY",
  "CAPACITY_OR_PLANNING",
  "OTHER",
] as const;

const aiResultSchema = z.object({
  translation: z.string().min(1).max(1200),
  summary: z.string().min(1).max(500),
  category: z.enum(reasonCategories),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
});

const reviewSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("CONFIRM") }),
  z.object({
    decision: z.literal("CORRECT"),
    correctedCategory: z.enum(reasonCategories),
  }),
]);

function getParam(value: string | string[] | undefined): string | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  return typeof normalized === "string" && normalized.trim()
    ? normalized.trim()
    : null;
}

async function classifyWithGroq(note: string) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("AI_NOT_CONFIGURED: Add GROQ_API_KEY to server/.env.");
  }

  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: 700,
        messages: [
          {
            role: "system",
            content: [
              "You classify production-floor issue notes for a knitwear garment factory.",
              "The user note may be in Tamil, English, or mixed Tamil-English.",
              "Translate the note faithfully into concise English. Do not add facts.",
              "Choose exactly one category from the supplied enum.",
              "Use OTHER and low confidence when the note is vague, ambiguous, or unrelated.",
              "Confidence is your calibrated estimate from 0 to 1; do not present it as a probability guarantee.",
              "Do not infer buyer impact, shipment delay, blame, or root causes not stated in the note.",
              "Return only the required structured fields.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Classify this original production issue note. Preserve its meaning.\n\n${note}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "production_issue_reason",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                translation: { type: "string" },
                summary: { type: "string" },
                category: { type: "string", enum: [...reasonCategories] },
                confidence: { type: "number" },
                rationale: { type: "string" },
              },
              required: [
                "translation",
                "summary",
                "category",
                "confidence",
                "rationale",
              ],
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    // Do not log or return request headers, credentials, or API key material.
    throw new Error(`Groq classification request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload: unknown = await response.json();
  const completion = z.object({
    choices: z.array(z.object({
      message: z.object({ content: z.string().nullable() }),
    })).min(1),
  }).parse(payload);

  const content = completion.choices[0]?.message.content;
  if (!content) throw new Error("The AI provider returned an empty classification.");

  const parsed: unknown = JSON.parse(content);
  return {
    model,
    result: aiResultSchema.parse(parsed),
  };
}

// Supervisor can classify an issue from their own unit; merchandiser can
// classify any issue. The original note is never overwritten.
router.post(
  "/classify/:updateId",
  requireAuth,
  allowRoles(UserRole.SUPERVISOR, UserRole.MERCHANDISER),
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const updateId = getParam(req.params.updateId);

    if (!user || !updateId) {
      return res.status(400).json({ message: "A valid production update ID is required." });
    }

    try {
      const update = await prisma.productionUpdate.findUnique({
        where: { id: updateId },
        select: {
          id: true,
          issueNote: true,
          order: { select: { unitName: true } },
          reasonAnalysis: { select: { reviewStatus: true, finalCategory: true } },
        },
      });

      if (!update) return res.status(404).json({ message: "Production update not found." });

      if (
        user.role === UserRole.SUPERVISOR &&
        (!user.unitId || user.unitId !== update.order.unitName)
      ) {
        return res.status(404).json({ message: "Production update not found." });
      }

      if (!update.issueNote?.trim()) {
        return res.status(400).json({ message: "This production update has no issue note to classify." });
      }

      if (["CONFIRMED", "CORRECTED"].includes(update.reasonAnalysis?.reviewStatus ?? "")) {
        return res.status(409).json({ message: "This issue category has already been reviewed and cannot be overwritten." });
      }

      await prisma.issueReasonAnalysis.upsert({
        where: { productionUpdateId: updateId },
        create: {
          productionUpdateId: updateId,
          processingStatus: "PROCESSING",
          reviewStatus: "PENDING_REVIEW",
        },
        update: {
          processingStatus: "PROCESSING",
        },
      });

      try {
        const { model, result } = await classifyWithGroq(update.issueNote);
        const analysis = await prisma.issueReasonAnalysis.update({
          where: { productionUpdateId: updateId },
          data: {
            translation: result.translation,
            englishSummary: result.summary,
            suggestedCategory: result.category,
            confidence: result.confidence,
            rationale: result.rationale,
            providerModel: model,
            processingStatus: "SUCCEEDED",
            reviewStatus: "PENDING_REVIEW",
            finalCategory: null,
            reviewedBy: null,
            reviewedAt: null,
          },
        });

        return res.status(200).json({
          success: true,
          message: "Issue note classified. Merchandiser review is required before buyer communication.",
          analysis,
          originalNote: update.issueNote,
        });
      } catch (aiError) {
        const safeMessage = aiError instanceof Error ? aiError.message : "AI classification failed.";
        await prisma.issueReasonAnalysis.update({
          where: { productionUpdateId: updateId },
          data: {
            processingStatus: "FAILED",
            reviewStatus: "PENDING_REVIEW",
            rationale: safeMessage.slice(0, 500),
          },
        });
        return res.status(502).json({
          success: false,
          message: "The production update is saved, but AI classification is unavailable. The original note is preserved for manual review.",
        });
      }
    } catch (error) {
      console.error("Issue classification route error:", error);
      return res.status(500).json({ message: "Unable to classify this production issue." });
    }
  },
);

// Merchandiser-only queue. Buyer endpoints never expose original notes or AI
// analysis. All categories remain pending until explicitly reviewed here.
router.get(
  "/review-queue",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (_req: Request, res: Response) => {
    try {
      const items = await prisma.productionUpdate.findMany({
        where: {
          issueNote: { not: null },
          reasonAnalysis: { isNot: null },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          issueNote: true,
          stage: true,
          createdAt: true,
          user: { select: { name: true } },
          order: { select: { id: true, poNumber: true, unitName: true, buyer: { select: { companyName: true } } } },
          reasonAnalysis: true,
        },
      });

      return res.json({ success: true, count: items.length, items });
    } catch (error) {
      console.error("Issue review queue error:", error);
      return res.status(500).json({ message: "Unable to load the issue review queue." });
    }
  },
);

// Merchandiser confirms the AI suggestion or overrides it. Only this reviewed
// category is copied to ProductionUpdate.reasonCategory for downstream use.
router.patch(
  "/review/:analysisId",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    const analysisId = getParam(req.params.analysisId);
    const validation = reviewSchema.safeParse(req.body);

    if (!user || !analysisId) return res.status(400).json({ message: "A valid analysis ID is required." });
    if (!validation.success) {
      return res.status(400).json({ message: "Invalid review decision.", errors: validation.error.flatten() });
    }

    try {
      const analysis = await prisma.issueReasonAnalysis.findUnique({
        where: { id: analysisId },
        include: {
          productionUpdate: {
            select: { id: true, orderId: true, reasonCategory: true },
          },
        },
      });

      if (!analysis) return res.status(404).json({ message: "Issue analysis not found." });
      if (analysis.reviewStatus === "CONFIRMED" || analysis.reviewStatus === "CORRECTED") {
        return res.status(409).json({ message: "This issue has already been reviewed." });
      }

      const finalCategory = validation.data.decision === "CONFIRM"
        ? analysis.suggestedCategory
        : validation.data.correctedCategory;

      if (!finalCategory) {
        return res.status(400).json({ message: "There is no AI suggestion to confirm. Choose a corrected category instead." });
      }

      const reviewStatus = validation.data.decision === "CONFIRM" ? "CONFIRMED" : "CORRECTED";

      const result = await prisma.$transaction(async (tx) => {
        const savedAnalysis = await tx.issueReasonAnalysis.update({
          where: { id: analysisId },
          data: {
            finalCategory,
            reviewStatus,
            reviewedBy: user.id,
            reviewedAt: new Date(),
          },
        });

        await tx.productionUpdate.update({
          where: { id: analysis.productionUpdate.id },
          data: { reasonCategory: finalCategory },
        });

        await tx.auditLog.create({
          data: {
            orderId: analysis.productionUpdate.orderId,
            fieldName: "reasonCategory",
            oldValue: analysis.productionUpdate.reasonCategory,
            newValue: finalCategory,
            changedBy: user.id,
          },
        });

        return savedAnalysis;
      });

      return res.json({
        success: true,
        message: validation.data.decision === "CONFIRM"
          ? "AI category confirmed by merchandiser."
          : "AI category corrected by merchandiser.",
        analysis: result,
        buyerWarningEligible: true,
      });
    } catch (error) {
      console.error("Issue category review error:", error);
      return res.status(500).json({ message: "Unable to save the issue review." });
    }
  },
);

export default router;
