export type UpstreamId = "nagram" | "telegram" | "nnngram" | "nullgram";

export interface Upstream {
  id: UpstreamId;
  repository: string;
  defaultBranch: string;
  gradleTask: string;
}

export const upstreams: readonly Upstream[] = [
  {
    id: "nagram",
    repository: "NextAlone/Nagram",
    defaultBranch: "main",
    gradleTask: ":TMessagesProj:assembleRelease",
  },
  {
    id: "telegram",
    repository: "DrKLO/Telegram",
    defaultBranch: "master",
    gradleTask: ":TMessagesProj_App:assembleAfatRelease",
  },
  {
    id: "nnngram",
    repository: "NextAlone/Nnngram",
    defaultBranch: "main",
    gradleTask: ":TMessagesProj:assembleRelease",
  },
  {
    id: "nullgram",
    repository: "qwq233/Nullgram",
    defaultBranch: "master",
    gradleTask: ":TMessagesProj:assembleRelease",
  },
] as const;

export function getUpstream(id: string): Upstream {
  const result = upstreams.find((upstream) => upstream.id === id);
  if (!result) {
    throw new Error(`Unsupported upstream: ${id}`);
  }
  return result;
}
