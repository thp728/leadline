"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addPerson, getLead, logAttempt, setLeadStatus, setNextTouch, setResearchStatus } from "../lib/store.mjs";
import { companySlugOf } from "../lib/core.mjs";

/**
 * The things the browser can change: name a human (which creates a Lead), move
 * that Lead's status, time a revisit, override the next touch, log an Attempt,
 * record a reply, and move the Company's research state.
 *
 * The machines and the ladder are enforced in the domain core. Forms only offer
 * legal moves, so a refusal here means a stale tab or a hand-made request; the
 * Lead page shows the message rather than failing silently.
 */

/** Revalidate every view of one Lead and report whether it still exists. */
function refresh(leadId) {
  const row = getLead(leadId);
  revalidatePath("/");
  revalidatePath(`/l/${leadId}`);
  if (row) revalidatePath(`/c/${row.lead.companySlug}`);
  return row;
}

function backWith(backTo, failure) {
  redirect(failure ? `${backTo}?error=${encodeURIComponent(failure)}` : backTo);
}

/** Run one Lead action, refresh its views, and surface a refusal on the page. */
async function runOnLead(formData, run) {
  const leadId = String(formData.get("leadId") || "");
  if (!leadId) return;

  const backTo = `/l/${leadId}`;
  let failure = null;
  try {
    run(leadId);
  } catch (err) {
    failure = err.message;
  }

  if (!refresh(leadId)) return;
  backWith(backTo, failure);
}

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

  const revisitAfter = String(formData.get("revisitAfter") || "").trim() || undefined;
  const backTo = String(formData.get("back") || "");

  let failure = null;
  try {
    setLeadStatus(leadId, status, { revisitAfter });
  } catch (err) {
    failure = err.message;
  }

  const row = refresh(leadId);
  if (!row) return;
  if (backTo) backWith(backTo, failure);

  // A stale form on the Company page: the page below shows the current status
  // and its legal moves, so there is nothing more to say.
  revalidatePath(`/c/${companySlugOf(leadId)}`);
}

/** Log the Attempt the operator just made, with the suggestion they confirmed. */
export async function saveAttempt(formData) {
  await runOnLead(formData, (leadId) => {
    logAttempt(leadId, {
      date: String(formData.get("date") || "").trim() || undefined,
      channel: String(formData.get("channel") || ""),
      kind: String(formData.get("kind") || "").trim() || undefined,
      note: String(formData.get("note") || ""),
      accept: formData.get("accept") === "1",
    });
  });
}

/** They came back: move to replied, which clears the suggested date. */
export async function saveReply(formData) {
  await runOnLead(formData, (leadId) => setLeadStatus(leadId, "replied"));
}

/** Override the next touch for one Lead, or clear it to hand the date back. */
export async function saveNextTouch(formData) {
  await runOnLead(formData, (leadId) =>
    setNextTouch(leadId, String(formData.get("date") || "").trim() || null),
  );
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
