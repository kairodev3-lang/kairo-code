
module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "");
  if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: "Bad id" });
  const repo = process.env.BUILDER_REPO;
  const h = {
    Authorization: "Bearer " + process.env.GH_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kairo-code"
  };
  res.setHeader("Cache-Control", "no-store");
  const r = await fetch("https://api.github.com/repos/" + repo + "/actions/workflows/build.yml/runs?event=workflow_dispatch&per_page=30", { headers: h });
  const j = await r.json();
  const run = (j.workflow_runs || []).find(x => x.display_title === "build-" + id);
  if (!run) return res.json({ state: "queued" });
  if (run.status !== "completed") return res.json({ state: "building" });
  if (run.conclusion !== "success") return res.json({ state: "failed", run_url: run.html_url });
  const rel = await (await fetch("https://api.github.com/repos/" + repo + "/releases/tags/build-" + id, { headers: h })).json();
  const a = (rel.assets || [])[0];
  if (!a) return res.json({ state: "building" });
  res.json({ state: "done", url: a.browser_download_url, name: a.name });
};
