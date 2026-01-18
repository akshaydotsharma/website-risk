import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const userId = searchParams.get("userId") || "default";

    if (key) {
      // Get specific preference
      const preference = await prisma.userPreference.findUnique({
        where: {
          userId_key: {
            userId,
            key,
          },
        },
      });

      return NextResponse.json({ preference });
    }

    // Get all preferences for user
    const preferences = await prisma.userPreference.findMany({
      where: { userId },
    });

    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value, userId = "default" } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: "Key and value are required" },
        { status: 400 }
      );
    }

    const preference = await prisma.userPreference.upsert({
      where: {
        userId_key: {
          userId,
          key,
        },
      },
      update: {
        value: String(value),
      },
      create: {
        userId,
        key,
        value: String(value),
      },
    });

    return NextResponse.json({ preference });
  } catch (error) {
    console.error("Error saving preference:", error);
    return NextResponse.json(
      { error: "Failed to save preference" },
      { status: 500 }
    );
  }
}
