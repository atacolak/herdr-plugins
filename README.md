# herdr-plugins

Small, self-contained [Herdr](https://herdr.dev) plugins.

| plugin | what it does |
| --- | --- |
| [`fresh-link`](./fresh-link) | open `file://`, `fresh.local`, and local `path:line:col` links — plus directory links as Fresh explorers — in the active tab's Fresh pane |

```bash
herdr plugin install atacolak/herdr-plugins/fresh-link   # install
herdr plugin link ./fresh-link                            # local dev
```

Each plugin is a directory with a `herdr-plugin.toml` manifest and a Bun script.
Run `bun test` from the repo root.
