# paseo-ci

A Paseo plugin that shows, next to the composer's other pills, the CI of the pull request an agent is working on:
the GitHub or Bitbucket logo and `#1821 ◐ 3/7` (running), `#1821 ✓`, `#1821 ✗ 2` (failed checks) or `#1821 fusionado`.
Tap it for every check: state, workflow, duration (live while it runs) and a link to its log; the title opens the PR.

- The PR is the last one the agent's conversation names: a GitHub or Bitbucket PR URL, `owner/repo#N`, or
  `gh pr <verb> N -R owner/repo`. It works in workspaces that are not a git checkout (Paseo's own PR badge needs one).
- The daemon reads the forge, so no token reaches the client. GitHub goes through `gh` (its login on the daemon's host).
  Bitbucket Cloud uses `BITBUCKET_TOKEN` (Bearer) or `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD` in the daemon's
  environment; without them only public repositories answer.
- Polls every 20 s while checks run, every 2 min once settled; one read per PR every 15 s at most, whatever the clients.

## Install

```sh
paseo plugin add git:pocharlies-org/paseo-ci
```

## Development

`npm ci --ignore-scripts && npm run typecheck && npm test`.

MIT licensed.
