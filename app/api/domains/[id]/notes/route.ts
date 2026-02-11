import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createNoteSchema = z.object({
  content: z.string().max(5000).optional(),
  type: z.enum(["note", "review"]).default("note"),
  riskDecision: z.enum(["risky", "not_risky"]).optional(),
}).refine(
  (data) => {
    // For regular notes, content is required
    if (data.type === "note") {
      return data.content && data.content.length > 0;
    }
    // For reviews, riskDecision is required but content is optional
    if (data.type === "review") {
      return data.riskDecision !== undefined;
    }
    return true;
  },
  { message: "Invalid note data: notes require content, reviews require riskDecision" }
);

// GET - List all notes for a domain
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify domain exists
    const domain = await prisma.domain.findUnique({
      where: { id },
    });

    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const notes = await prisma.investigationNote.findMany({
      where: { domainId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ notes });
  } catch (error) {
    console.error("Error fetching notes:", error);
    return NextResponse.json(
      { error: "Failed to fetch notes" },
      { status: 500 }
    );
  }
}

// POST - Create a new note
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const validation = createNoteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Verify domain exists
    const domain = await prisma.domain.findUnique({ where: { id } });
    if (!domain) {
      return NextResponse.json({ error: "Domain not found" }, { status: 404 });
    }

    const { type, riskDecision, content } = validation.data;

    // For reviews, also update the domain's manual risk flag
    if (type === "review" && riskDecision) {
      await prisma.domain.update({
        where: { id },
        data: {
          isManuallyRisky: riskDecision === "risky",
          manualRiskSetAt: new Date(),
        },
      });
    }

    const note = await prisma.investigationNote.create({
      data: {
        domainId: id,
        content: content || "",
        type,
        riskDecision,
      },
    });

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
}
