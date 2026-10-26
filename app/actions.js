"use server";

import { revalidatePath } from "next/cache";
import { updateOutreach } from "../lib/store.mjs";

export async function saveOutreach(formData) {
  const slug = String(formData.get("slug") || "");
  if (!slug) return;

  const patch = {};
  for (const key of ["stage", "channel", "firstTouch", "lastTouch", "nextTouch", "proofLink", "notes"]) {
    const value = formData.get(key);
    if (value !== null) patch[key] = String(value);
  }

  updateOutreach(slug, patch);
  revalidatePath("/");
  revalidatePath(`/c/${slug}`);
}
