import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getOrCreateArtifact,
  extractReadableText,
} from "@/lib/extractHomepageArtifact";
import type { AboutPageData } from "@/lib/extractors";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: domainId } = await params;

  try {
    // Load domain and its about page URL
    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        normalizedUrl: true,
        dataPoints: {
          where: { key: { in: ["contact_details", "about_page"] } },
          select: { key: true, value: true },
        },
      },
    });

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    // Get about page URL from contact_details or existing about_page data point
    let aboutPageUrl: string | null = null;

    const contactDp = domain.dataPoints.find((dp) => dp.key === "contact_details");
    if (contactDp) {
      try {
        const contactData = JSON.parse(contactDp.value);
        aboutPageUrl = contactData.about_page_url || null;
      } catch {
        // ignore
      }
    }

    if (!aboutPageUrl) {
      const aboutDp = domain.dataPoints.find((dp) => dp.key === "about_page");
      if (aboutDp) {
        try {
          const aboutData = JSON.parse(aboutDp.value);
          aboutPageUrl = aboutData.about_page_url || null;
        } catch {
          // ignore
        }
      }
    }

    if (!aboutPageUrl) {
      return NextResponse.json(
        { error: "No about page URL found for this domain. Run a full scan first." },
        { status: 400 }
      );
    }

    // Re-fetch the about page with skipCache
    console.log(`[Rescan About] Fetching ${aboutPageUrl} for domain ${domain.normalizedUrl}...`);
    const { artifact, artifactId } = await getOrCreateArtifact(aboutPageUrl, "about", {
      skipCache: true,
    });

    const readableText = artifact.htmlSnippet
      ? extractReadableText(artifact.htmlSnippet).substring(0, 8 * 1024)
      : artifact.textSnippet?.substring(0, 8 * 1024) || null;

    const aboutPageResult: AboutPageData = {
      about_page_url: aboutPageUrl,
      text_content: readableText,
      word_count: artifact.features?.wordCount ?? 0,
      headings: artifact.features?.headingTexts ?? [],
      fetch_method: artifact.fetchMethod,
      status_code: artifact.statusCode,
      blocked: artifact.features?.blocked ?? false,
      blocked_reason: artifact.features?.blockedReason ?? null,
      artifact_id: artifactId,
    };

    // Update the about_page DomainDataPoint
    await prisma.domainDataPoint.upsert({
      where: { domainId_key: { domainId, key: "about_page" } },
      create: {
        domainId,
        key: "about_page",
        label: "About page",
        value: JSON.stringify(aboutPageResult),
        sources: JSON.stringify([aboutPageUrl]),
        rawOpenAIResponse: JSON.stringify({}),
      },
      update: {
        value: JSON.stringify(aboutPageResult),
        sources: JSON.stringify([aboutPageUrl]),
        extractedAt: new Date(),
      },
    });

    console.log(
      `[Rescan About] Done: ${artifact.features?.wordCount ?? 0} words, ` +
      `method=${artifact.fetchMethod}, blocked=${artifact.features?.blocked ?? false}`
    );

    return NextResponse.json({
      success: true,
      aboutPage: aboutPageResult,
    });
  } catch (error) {
    console.error("[Rescan About] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rescan failed" },
      { status: 500 }
    );
  }
}
