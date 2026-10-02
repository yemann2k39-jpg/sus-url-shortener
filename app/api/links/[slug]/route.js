import { NextResponse } from "next/server";
import { StoreError, deleteLink } from "@/lib/store";

export async function DELETE(_req, { params }) {
  const { slug } = await params;
  try {
    const removed = deleteLink(slug);
    if (!removed) {
      return NextResponse.json(
        {
          error: `No sus link answers to "${slug}".`,
          code: "not_found",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: removed.slug, target: removed.target });
  } catch (err) {
    if (err instanceof StoreError) {
      const status = err.code === "store_corrupt" ? 500 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, {
        status,
      });
    }
    console.error("deleteLink failed unexpectedly:", err);
    return NextResponse.json(
      { error: "Something went sus on our side. Try again.", code: "internal" },
      { status: 500 }
    );
  }
}
