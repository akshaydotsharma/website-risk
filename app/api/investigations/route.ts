import { NextResponse } from "next/server";
import { runInBackground } from "@/lib/runInBackground";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  extractDomainFromInput,
  generateDomainHash,
} from "@/lib/utils";
import { processInvestigation } from "@/lib/investigation-processor";

export const maxDuration = 300;

const createSchema = z.object({
  urls: z.array(z.string()).min(1, "At least 1 URL required").max(50, "Maximum 50 URLs"),
  name: z.string().optional(),
});

/**
 * POST /api/investigations — Create a new investigation
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { urls, name } = parsed.data;

    // Normalize and deduplicate URLs
    const domainMap = new Map<string, { id: string; normalized: string }>();
    for (const rawUrl of urls) {
      try {
        const normalized = extractDomainFromInput(rawUrl);
        const id = generateDomainHash(normalized);
        if (!domainMap.has(id)) {
          domainMap.set(id, { id, normalized });
        }
      } catch {
        // Skip invalid URLs
      }
    }

    if (domainMap.size === 0) {
      return NextResponse.json(
        { error: "No valid URLs provided" },
        { status: 400 }
      );
    }

    // Create investigation + domains in a transaction
    const investigation = await prisma.$transaction(async (tx) => {
      // Ensure all domains exist
      for (const { id, normalized } of domainMap.values()) {
        await tx.domain.upsert({
          where: { id },
          create: {
            id,
            normalizedUrl: normalized,
            isActive: false,
            lastCheckedAt: new Date(),
          },
          update: {
            lastCheckedAt: new Date(),
          },
        });
      }

      // Create the investigation
      const inv = await tx.investigation.create({
        data: {
          name: name || `Investigation — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          domainCount: domainMap.size,
          domains: {
            create: Array.from(domainMap.values()).map(({ id }) => ({
              domainId: id,
            })),
          },
        },
        include: {
          domains: { include: { domain: { select: { normalizedUrl: true } } } },
        },
      });

      return inv;
    });

    // Start processing in background
    const runProcessing = async () => {
      try {
        await processInvestigation(investigation.id);
      } catch (error) {
        console.error(`Investigation ${investigation.id} failed:`, error);
      }
    };

    runInBackground(runProcessing);

    return NextResponse.json(
      {
        id: investigation.id,
        status: "pending",
        domainCount: investigation.domainCount,
        domains: investigation.domains.map((d) => ({
          domainId: d.domainId,
          url: d.domain.normalizedUrl,
          status: d.status,
        })),
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error creating investigation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/investigations — List investigations
 */
export async function GET() {
  try {
    const investigations = await prisma.investigation.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        domains: {
          include: {
            domain: {
              select: { normalizedUrl: true, riskScore: true, isActive: true },
            },
          },
        },
      },
    });

    return NextResponse.json({
      investigations: investigations.map((inv) => ({
        id: inv.id,
        name: inv.name,
        status: inv.status,
        domainCount: inv.domainCount,
        scannedCount: inv.scannedCount,
        createdAt: inv.createdAt.toISOString(),
        completedAt: inv.completedAt?.toISOString() ?? null,
        domains: inv.domains.map((d) => ({
          domainId: d.domainId,
          url: d.domain.normalizedUrl,
          riskScore: d.domain.riskScore,
          isActive: d.domain.isActive,
          status: d.status,
          scanId: d.scanId,
        })),
      })),
    });
  } catch (error) {
    console.error("Error listing investigations:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
