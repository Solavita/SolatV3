# GitHub environment handoff

The V2 repository has its own local Git history and a Windows CI workflow at
`.github/workflows/ci.yml`. The workflow is intentionally independent from V1
and runs the same `npm.cmd run check` and `npm.cmd test` commands used locally.

No remote is configured for V2 yet. This is deliberate: the owner must choose
the exact GitHub repository name and visibility before a remote or push is
created. The V1 origin must never be reused silently. The initial rebuild
milestone is complete with this local repository and CI workflow; attaching a
remote is an optional owner-controlled follow-up.
