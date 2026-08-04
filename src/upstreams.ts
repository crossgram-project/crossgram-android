export type UpstreamId =
  | "nagram"
  | "telegram"
  | "nnngram"
  | "nullgram"
  | "mercurygram"
  | "forkgram";

export type ReleaseVariant = "arm64" | "x86_64";

export interface Upstream {
  id: UpstreamId;
  repository: string;
  defaultBranch: string;
  gradleTask: string;
  gradleTasks?: Partial<Record<ReleaseVariant, string>>;
  releaseVariants: readonly ReleaseVariant[];
  buildGradles: readonly string[];
  appGradle: string;
  appModuleManifests: boolean;
  ndkVersion: string;
  nativeDepsNdkVersion?: string;
  tdlibNdkVersion?: string;
}

export const upstreams: readonly Upstream[] = [
  {
    id: "nagram",
    repository: "NextAlone/Nagram",
    defaultBranch: "main",
    gradleTask: ":TMessagesProj:assembleRelease",
    releaseVariants: ["arm64", "x86_64"],
    buildGradles: ["TMessagesProj/build.gradle"],
    appGradle: "TMessagesProj/build.gradle",
    appModuleManifests: false,
    ndkVersion: "27.2.12479018",
  },
  {
    id: "telegram",
    repository: "DrKLO/Telegram",
    defaultBranch: "master",
    gradleTask: ":TMessagesProj_App:assembleAfatRelease",
    releaseVariants: ["arm64", "x86_64"],
    buildGradles: ["TMessagesProj/build.gradle", "TMessagesProj_App/build.gradle"],
    appGradle: "TMessagesProj_App/build.gradle",
    appModuleManifests: true,
    ndkVersion: "21.4.7075529",
  },
  {
    id: "nnngram",
    repository: "NextAlone/Nnngram",
    defaultBranch: "main",
    gradleTask: ":TMessagesProj:assembleRelease",
    releaseVariants: ["arm64"],
    buildGradles: ["TMessagesProj/build.gradle.kts"],
    appGradle: "TMessagesProj/build.gradle.kts",
    appModuleManifests: false,
    ndkVersion: "28.2.13676358",
  },
  {
    id: "nullgram",
    repository: "qwq233/Nullgram",
    defaultBranch: "master",
    gradleTask: ":TMessagesProj:assembleRelease",
    releaseVariants: ["arm64"],
    buildGradles: ["TMessagesProj/build.gradle.kts"],
    appGradle: "TMessagesProj/build.gradle.kts",
    appModuleManifests: false,
    ndkVersion: "29.0.14206865",
  },
  {
    id: "mercurygram",
    repository: "Mercurygram/Mercurygram",
    defaultBranch: "Mercurygram",
    gradleTask: ":TMessagesProj_App:assembleAfatFdArm64Release",
    gradleTasks: {
      arm64: ":TMessagesProj_App:assembleAfatFdArm64Release",
      x86_64: ":TMessagesProj_App:assembleAfatFdX86_64Release",
    },
    releaseVariants: ["arm64", "x86_64"],
    buildGradles: ["TMessagesProj/build.gradle", "TMessagesProj_App/build.gradle"],
    appGradle: "TMessagesProj_App/build.gradle",
    appModuleManifests: true,
    ndkVersion: "27.2.12479018",
  },
  {
    id: "forkgram",
    repository: "forkgram/TelegramAndroid",
    defaultBranch: "dev",
    gradleTask: ":TMessagesProj_App:assembleAfatRelease",
    releaseVariants: ["arm64"],
    buildGradles: ["TMessagesProj/build.gradle", "TMessagesProj_App/build.gradle"],
    appGradle: "TMessagesProj_App/build.gradle",
    appModuleManifests: true,
    ndkVersion: "27.2.12479018",
    nativeDepsNdkVersion: "27.2.12479018",
    tdlibNdkVersion: "23.2.8568313",
  },
] as const;

export function gradleTaskForVariant(upstream: Upstream, variant: ReleaseVariant): string {
  return upstream.gradleTasks?.[variant] ?? upstream.gradleTask;
}

export function getUpstream(id: string): Upstream {
  const result = upstreams.find((upstream) => upstream.id === id);
  if (!result) {
    throw new Error(`Unsupported upstream: ${id}`);
  }
  return result;
}
