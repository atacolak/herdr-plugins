# fresh-link

```bash
herdr plugin install atacolak/herdr-plugins/fresh-link
```

Ctrl+Click a `file://` URI, `fresh.local` link, or local path (`src/open.ts:12:3`, `src/`) in any Herdr pane.

## Files

- Reuses the `Fresh` pane already in that tab: `fresh --cmd daemon open-file <daemon> <path:line:col>`, then focuses it.
- Otherwise splits `0.5` along the clicked pane's longer axis (`right` if `width >= height * 2`, else `down`), rooted at the file's `.git` / `.jj` project root.
- Launches `fresh --no-restore <path:line:col>` in the new pane.

## Directories

A link to a directory opens it as a Fresh file explorer rooted at that directory rather than as a file.

- `fresh --cmd daemon open-file` refuses directories (`No files to open (only directories were specified).`), so a directory never reuses the tab's existing Fresh pane that way.
- If the tab's `Fresh` pane is already rooted at exactly that directory, it is focused.
- Otherwise splits `0.5` as above, but with `--cwd <directory>` — not the project root — and launches `fresh --no-restore <directory>`, which roots the explorer there.

Requires Linux (`/proc`), `bun`, and `fresh` on `PATH`.
