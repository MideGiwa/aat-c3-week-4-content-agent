import type {
  ActivityLogEntry,
  ChannelAsset,
  ContentRequest,
  Draft,
  Evaluation,
  Profile,
  RequestAttachment,
  ReviewDecision,
  SourceRef,
} from "../types";
import {
  seedActivity,
  seedAttachments,
  seedChannelAssets,
  seedDecisions,
  seedDrafts,
  seedEvaluations,
  seedProfiles,
  seedRequests,
  seedSources,
} from "./seed";

export interface MockStore {
  profiles: Profile[];
  requests: ContentRequest[];
  attachments: RequestAttachment[];
  sources: SourceRef[];
  drafts: Draft[];
  evaluations: Evaluation[];
  channelAssets: ChannelAsset[];
  activity: ActivityLogEntry[];
  decisions: ReviewDecision[];
}

// Next.js dev mode hot-reloads modules on every save, which would otherwise
// reset this store constantly and make the app feel broken while you're
// editing it. Stashing it on `globalThis` (guarded to server-side only)
// makes it survive hot reloads, the same trick commonly used for a
// Prisma/DB client singleton in Next.js apps.
const globalForStore = globalThis as unknown as { __mockStore?: MockStore };

function createStore(): MockStore {
  return {
    profiles: structuredClone(seedProfiles),
    requests: structuredClone(seedRequests),
    attachments: structuredClone(seedAttachments),
    sources: structuredClone(seedSources),
    drafts: structuredClone(seedDrafts),
    evaluations: structuredClone(seedEvaluations),
    channelAssets: structuredClone(seedChannelAssets),
    activity: structuredClone(seedActivity),
    decisions: structuredClone(seedDecisions),
  };
}

export function getStore(): MockStore {
  if (!globalForStore.__mockStore) {
    globalForStore.__mockStore = createStore();
  }
  return globalForStore.__mockStore;
}

/** Dev convenience only — not part of the real system's design. Lets the
 * board's "Reset sample data" control put things back the way they started
 * without restarting the dev server. */
export function resetStore(): void {
  globalForStore.__mockStore = createStore();
}

let idCounter = 1000;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}
