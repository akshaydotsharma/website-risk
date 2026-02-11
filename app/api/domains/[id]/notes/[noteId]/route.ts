import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const updateNoteSchema = z.object({
  content: z.string().min(1, "Note content is required").max(5000),
});

// PATCH - Update a note
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id, noteId } = await params;
    const body = await request.json();

    const validation = updateNoteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    // Verify note exists and belongs to this domain
    const existingNote = await prisma.investigationNote.findFirst({
      where: { id: noteId, domainId: id },
    });

    if (!existingNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const note = await prisma.investigationNote.update({
      where: { id: noteId },
      data: { content: validation.data.content },
    });

    return NextResponse.json({ note });
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a note
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { id, noteId } = await params;

    // Verify note exists and belongs to this domain
    const existingNote = await prisma.investigationNote.findFirst({
      where: { id: noteId, domainId: id },
    });

    if (!existingNote) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await prisma.investigationNote.delete({
      where: { id: noteId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
}
