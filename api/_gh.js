const { GH_TOKEN, GH_OWNER, GH_REPO } = process.env;
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

module.exports = { H, gh, findRun };
