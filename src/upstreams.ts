export type UpstreamId = "nagram" | "telegram" | "nnngram" | "nullgram";

export type LoginUi = "nagram-menu" | "more-menu" | "standalone-button";

export interface Upstream {
  id: UpstreamId;
  repository: string;
  defaultBranch: string;
  loginUi: LoginUi;
  gradleTask: string;
}

export const upstreams: readonly Upstream[] = [
  {
    id: "nagram",
    repository: "NextAlone/Nagram",
    defaultBranch: "main",
    loginUi: "nagram-menu",
    gradleTask: ":TMessagesProj:assembleRelease",
  },
  {
    id: "telegram",
    repository: "DrKLO/Telegram",
    defaultBranch: "master",
    loginUi: "standalone-button",
    gradleTask: ":TMessagesProj_App:assembleAfatRelease",
  },
  {
    id: "nnngram",
    repository: "NextAlone/Nnngram",
    defaultBranch: "main",
    loginUi: "more-menu",
    gradleTask: ":TMessagesProj:assembleRelease",
  },
  {
    id: "nullgram",
    repository: "qwq233/Nullgram",
    defaultBranch: "master",
    loginUi: "more-menu",
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
