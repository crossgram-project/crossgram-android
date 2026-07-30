import { appendFile } from "node:fs/promises";

import { gradleTaskForVariant, upstreams, type ReleaseVariant } from "./upstreams.js";

interface GithubRelease {
  tag_name?: string;
  published_at?: string;
}

interface GithubTag {
  name?: string;
}

async function github<T>(path: string): Promise<T | undefined> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "crossgram-android-patcher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub API ${path} failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export interface DiscoveredUpstream {
  id: string;
  repository: string;
  ref: string;
  version: string;
  defaultBranch: string;
  gradleTask: string;
  releaseVariants: readonly ReleaseVariant[];
  ndkVersion: string;
  nativeDepsNdkVersion: string;
  tdlibNdkVersion: string;
}

export function variantsForClient(id: string): readonly ReleaseVariant[] {
  return upstreams.find((upstream) => upstream.id === id)?.releaseVariants ?? [];
}

export async function discoverUpstreams(): Promise<DiscoveredUpstream[]> {
  return Promise.all(upstreams.map(async (upstream) => {
    const release = await github<GithubRelease>(`/repos/${upstream.repository}/releases/latest`);
    let ref = release?.tag_name;
    if (!ref) {
      const tags = await github<GithubTag[]>(`/repos/${upstream.repository}/tags?per_page=1`);
      ref = tags?.[0]?.name;
    }
    ref ||= upstream.defaultBranch;
    return {
      id: upstream.id,
      repository: upstream.repository,
      ref,
      version: ref.replace(/^v/, ""),
      defaultBranch: upstream.defaultBranch,
      gradleTask: upstream.gradleTask,
      releaseVariants: upstream.releaseVariants,
      ndkVersion: upstream.ndkVersion,
      nativeDepsNdkVersion: upstream.nativeDepsNdkVersion ?? "",
      tdlibNdkVersion: upstream.tdlibNdkVersion ?? "",
    };
  }));
}

export async function emitGithubMatrices(outputFile?: string): Promise<object> {
  const discovered = await discoverUpstreams();
  const requested = process.env.CROSSGRAM_CLIENT ?? "all";
  const clients = requested === "all"
    ? discovered
    : discovered.filter((client) => client.id === requested);
  if (clients.length === 0) {
    throw new Error(`Unknown CROSSGRAM_CLIENT: ${requested}`);
  }
  const build = {
    include: clients.flatMap((client) =>
      variantsForClient(client.id).map((variant) => ({
        ...client,
        variant,
        gradleTask: gradleTaskForVariant(
          upstreams.find((upstream) => upstream.id === client.id)!,
          variant,
        ),
      })),
    ),
  };
  const result = { clients, build };
  if (outputFile) {
    await appendFile(
      outputFile,
      `clients=${JSON.stringify(clients)}\nbuild=${JSON.stringify(build)}\n`,
      "utf8",
    );
  }
  return result;
}
