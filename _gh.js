const API = "https://api.github.com";

function gh(path, opts = {}) {
  return fetch(path.startsWith("http") ? path : API + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + process.env.GH_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "kairo-code",
      ...(opts.headers || {})
    }
  });
}

async function repoInfo() {
  if (!process.env.GH_TOKEN) return { error: "GH_TOKEN is not set in Vercel" };
  let repo = (process.env.BUILDER_REPO || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (!repo) return { error: "BUILDER_REPO is not set in Vercel" };
  if (!repo.includes("/")) {
    const u = await gh("/user");
    if (!u.ok) return { error: "GH_TOKEN is not valid (" + u.status + ")" };
    repo = (await u.json()).login + "/" + repo;
  }
  const r = await gh("/repos/" + repo);
  if (!r.ok) return { error: "Cannot open repo " + repo + " (" + r.status + "). Check BUILDER_REPO and GH_TOKEN." };
  return { repo, branch: (await r.json()).default_branch };
}

module.exports = { gh, repoInfo };
