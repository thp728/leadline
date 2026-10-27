"use server";

import { revalidatePath } from "next/cache";
import { addPerson, setLeadStatus, setResearchStatus } from "../lib/store.mjs";
import { companySlugOf } from "../lib/core.mjs";

/**
 * The three things the browser can change: name a human (which creates a Lead),
 * move that Lead's status, and move the Company's research state. The status
 * machines are enforced in the domain core; the forms only offer legal moves,
 * so a refusal here means a stale tab, not a user mistake.
 */

export async function savePerson(formData) {
  const company = String(formData.get("company") || "");
  const name = String(formData.get("name") || "").trim();
  if (!company || !name) return;

  addPerson(company, {
    name,
    role: String(formData.get("role") || "").trim() || null,
    handle: String(formData.get("handle") || "").trim() || null,
    email: String(formData.get("email") || "").trim() || null,
    contactSource: String(formData.get("contactSource") || "").trim() || null,
  });

  revalidatePath("/");
  revalidatePath(`/c/${company}`);
}

export async function saveLeadStatus(formData) {
  const leadId = String(formData.get("leadId") || "");
  const status = String(formData.get("status") || "");
  if (!leadId || !status) return;

  let companySlug = null;
  try {
    companySlug = setLeadStatus(leadId, status).companySlug;
  } catch {
    // Stale form: the page below shows the current status and its legal moves.
    companySlug = companySlugOf(leadId);
  }

  revalidatePath("/");
  if (companySlug) revalidatePath(`/c/${companySlug}`);
}

export async function saveResearchStatus(formData) {
  const company = String(formData.get("company") || "");
  const status = String(formData.get("status") || "");
  if (!company || !status) return;

  try {
    setResearchStatus(company, status);
  } catch {
    // Stale form: the page below shows the current state and its legal moves.
  }

  revalidatePath("/");
  revalidatePath(`/c/${company}`);
}
