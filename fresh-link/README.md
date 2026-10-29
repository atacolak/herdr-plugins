# fresh-link

```bash
herdr plugin install atacolak/herdr-plugins/fresh-link
```

Ctrl+Click a `file://` URI, `fresh.local` link, or local path (`src/open.ts:12:3`) in any Herdr pane.

- Reuses the `Fresh` pane already in that tab: `fresh --cmd daemon open-file <daemon> <path:line:col>`, then focuses it.
- Otherwise splits `0.5` along the clicked pane's longer axis (`right` if `width >= height * 2`, else `down`), rooted at the file's `.git` / `.jj` project root.
- Launches `fresh --no-restore <path:line:col>` in the new pane.

Requires Linux (`/proc`), `bun`, and `fresh` on `PATH`.
