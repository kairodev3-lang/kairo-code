const env = process.env;
// Works with the variable names you already have in Vercel
const GH_TOKEN =
  env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUB_PAT || env.GITHUB_ACCESS_TOKEN || env.GIT_TOKEN || "";
// BUILDER_REPO can be "repo", "owner/repo" or a full GitHub URL
const br = (env.BUILDER_REPO || "").trim().replace(/\.git$/, "").replace(/\/$/, "");
const parts = br.split("/").filter(Boolean);
const brRepo = parts.length ? parts[parts.length - 1] : "";
const brOwner = parts.length > 1 ? parts[parts.length - 2] : "";
const [repoOwner, repoName] = (env.GITHUB_REPOSITORY || env.GH_REPOSITORY || "").split("/");
const GH_OWNER = env.GH_OWNER || brOwner || env.GITHUB_OWNER || repoOwner || env.VERCEL_GIT_REPO_OWNER;
const GH_REPO = env.GH_REPO || brRepo || env.GITHUB_REPO || repoName || env.VERCEL_GIT_REPO_SLUG;
const BASE = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`;
const H = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "kairo-apk-builder"
};
const gh = (path, opts = {}) =>
  fetch(BASE + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });

// finds the workflow run that belongs to a build id
async function findRun(id) {
  const r = await gh("/actions/runs?event=workflow_dispatch&per_page=30");
  const j = await r.json();
  return (j.workflow_runs || []).find(x => x.display_title && x.display_title.includes(id));
}

// downloads the build artifact (zip) for a build id
async function getArtifactZip(id) {
  const AdmZip = require("adm-zip");
  const run = await findRun(id);
  if (!run || run.conclusion !== "success") return null;
  const a = await (await gh(`/actions/runs/${run.id}/artifacts`)).json();
  const art = (a.artifacts || []).find(x => x.name === "apk-" + id);
  if (!art) return null;
  const z = await fetch(art.archive_download_url, { headers: H, redirect: "manual" });
  const loc = z.headers.get("location");
  if (!loc) return null;
  const buf = Buffer.from(await (await fetch(loc)).arrayBuffer());
  return { zip: new AdmZip(buf), run };
}

module.exports = { H, gh, findRun, getArtifactZip };
