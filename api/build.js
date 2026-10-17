const { gh } = require("./_gh");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN && !process.env.GITHUB_PAT && !process.env.GITHUB_ACCESS_TOKEN && !process.env.GIT_TOKEN)
    return res.status(500).json({ error: "No GitHub token found in Vercel variables" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { url, packageName, appName, icon } = b;

    if (!/^https:\/\/[^\s.]+\.[^\s]+$/i.test(url || "")) return res.status(400).json({ error: "Invalid website link" });
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName || "")) return res.status(400).json({ error: "Invalid package name" });
    if (!appName || appName.length > 30) return res.status(400).json({ error: "Invalid app name" });

    const iconB64 = String(icon || "").replace(/^data:image\/\w+;base64,/, "");
    if (!iconB64 || iconB64.length > 55000) return res.status(400).json({ error: "Icon missing or too large" });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    // 1) can the token see the repo? (also gives us the default branch)
    const info = await gh("");
    const repoName = `${process.env.GH_OWNER || process.env.BUILDER_REPO || "(from Vercel git)"}`;
    if (info.status === 404 || info.status === 401 || info.status === 403) {
      return res.status(502).json({
        error: `Token cannot access the repo (${info.status}). Check BUILDER_REPO (${repoName}) and that GH_TOKEN has access to that repo.`
      });
    }
    const repo = await info.json();
    const branch = process.env.GH_BRANCH || repo.default_branch || "main";

    // 2) does the workflow exist?
    const wf = await (await gh("/actions/workflows")).json();
    const names = (wf.workflows || []).map(w => w.path);
    if (!names.includes(".github/workflows/build-apk.yml")) {
      return res.status(502).json({
        error: `Repo ${repo.full_name} found, but .github/workflows/build-apk.yml is missing on its default branch. Workflows found: ${names.join(", ") || "none"}.`
      });
    }

    // 3) start the build
    const r = await gh("/actions/workflows/build-apk.yml/dispatches", {
      method: "POST",
      body: JSON.stringify({
        ref: branch,
        inputs: { build_id: id, url, package: packageName, app_name: appName, icon_b64: iconB64 }
      })
    });
    if (r.status !== 204) {
      const t = await r.text();
      const hint = (r.status === 403 || r.status === 404)
        ? " (GH_TOKEN probably lacks Actions: Read and write permission)" : "";
      return res.status(502).json({ error: "GitHub error " + r.status + hint + ": " + t.slice(0, 160) });
    }
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
