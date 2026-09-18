// Server-side only. Called from the API routes in src/app/api/webhooks/*,
// never directly from client components.
//
// Real mode's three functions below go straight to
// src/lib/supabase/webhooks.ts (real Supabase persistence + real Claude/
// Firecrawl/Tavily/Voyage calls). n8n is no longer part of this system at
// all (2026-09-18, see DESIGN.md's decisions log) — there's no separate
// publish runner anymore either; `publishing_queue` (populated on
// approval) is itself the "scheduled for release" record, and nothing
// polls or auto-publishes it.

import { USE_MOCK_DATA } from "./config";
import {
  handleContentRequestWebhook as handleMockContentRequestWebhook,
  handleManageAttachmentWebhook as handleMockManageAttachmentWebhook,
  handleManualEditWebhook as handleMockManualEditWebhook,
  handleReviewActionWebhook as handleMockReviewActionWebhook,
  handleRetryRequestWebhook as handleMockRetryRequestWebhook,
  handleRetryRevisionWebhook as handleMockRetryRevisionWebhook,
  type ContentRequestWebhookResult,
  type ManageAttachmentInput,
  type ManageAttachmentResult,
  type ManualEditInput,
  type ManualEditResult,
  type ReviewActionInput,
  type ReviewActionWebhookResult,
  type RetryRequestInput,
  type RetryRequestResult,
  type RetryRevisionInput,
  type RetryRevisionResult,
} from "./mock/webhooks";
import {
  handleContentRequestWebhook as handleRealContentRequestWebhook,
  handleManageAttachmentWebhook as handleRealManageAttachmentWebhook,
  handleManualEditWebhook as handleRealManualEditWebhook,
  handleReviewActionWebhook as handleRealReviewActionWebhook,
  handleRetryRequestWebhook as handleRealRetryRequestWebhook,
  handleRetryRevisionWebhook as handleRealRetryRevisionWebhook,
} from "./supabase/webhooks";
import type { NewRequestInput } from "./validation";

export async function submitContentRequest(
  input: NewRequestInput & { submitted_by: string; reviewer_ids: string[]; origin?: string }
): Promise<ContentRequestWebhookResult> {
  if (USE_MOCK_DATA) return handleMockContentRequestWebhook(input);
  return handleRealContentRequestWebhook(input);
}

export async function submitReviewAction(
  input: ReviewActionInput & { origin?: string }
): Promise<ReviewActionWebhookResult> {
  if (USE_MOCK_DATA) return handleMockReviewActionWebhook(input);
  return handleRealReviewActionWebhook(input);
}

export async function submitManageAttachment(input: ManageAttachmentInput): Promise<ManageAttachmentResult> {
  if (USE_MOCK_DATA) return handleMockManageAttachmentWebhook(input);
  return handleRealManageAttachmentWebhook(input);
}

export async function submitRetryRequest(
  input: RetryRequestInput & { origin?: string }
): Promise<RetryRequestResult> {
  if (USE_MOCK_DATA) return handleMockRetryRequestWebhook(input);
  return handleRealRetryRequestWebhook(input);
}

export async function submitManualEdit(input: ManualEditInput): Promise<ManualEditResult> {
  if (USE_MOCK_DATA) return handleMockManualEditWebhook(input);
  return handleRealManualEditWebhook(input);
}

export async function submitRetryRevision(
  input: RetryRevisionInput & { origin?: string }
): Promise<RetryRevisionResult> {
  if (USE_MOCK_DATA) return handleMockRetryRevisionWebhook(input);
  return handleRealRetryRevisionWebhook(input);
}
