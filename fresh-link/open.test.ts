import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatSpec,
	openInFresh,
	parseInvocation,
	planFreshOpen,
	resolveExplorerRoot,
	resolveTarget,
	smartSplitDirection,
} from "./open.ts";

function uniqueDir(name: string): string {
	return mkdtempSync(join(tmpdir(), `herdr-fresh-open-${name}-`));
}

test("parseInvocation reads Herdr link-handler env and context JSON", () => {
	expect(
		parseInvocation([], {
			HERDR_PLUGIN_CLICKED_URL: "file:///tmp/foo.rs:12",
			HERDR_WORKSPACE_ID: "ws",
			HERDR_TAB_ID: "tab-1",
			HERDR_PANE_ID: "w:p1",
			HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
				focused_pane_cwd: "/work/repo",
			}),
		}),
	).toEqual({
		url: "file:///tmp/foo.rs:12",
		workspaceId: "ws",
		tabId: "tab-1",
		paneId: "w:p1",
		cwd: "/work/repo",
	});
});

test("resolveTarget parses file URI with line and column", () => {
	const cwd = uniqueDir("file-uri");
	try {
		const target = resolveTarget("file:///tmp/missing.rs:42:3", cwd);
		expect(target).toEqual({
			path: "/tmp/missing.rs",
			line: 42,
			column: 3,
		});
		expect(formatSpec(target!)).toBe("/tmp/missing.rs:42:3");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget parses file URI hash line", () => {
	const cwd = uniqueDir("file-uri-hash");
	try {
		expect(resolveTarget("file:///work/notes.md#L12", cwd)).toEqual({
			path: "/work/notes.md",
			line: 12,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget parses http://fresh.local URI with line", () => {
	const cwd = uniqueDir("fresh-local-http");
	try {
		expect(resolveTarget("http://fresh.local/work/repo/notes.md:1", cwd)).toEqual({
			path: "/work/repo/notes.md",
			line: 1,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget parses https://fresh.local URI with line", () => {
	const cwd = uniqueDir("fresh-local-https");
	try {
		expect(resolveTarget("https://fresh.local/work/repo/notes.md:1", cwd)).toEqual({
			path: "/work/repo/notes.md",
			line: 1,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget percent-decodes http://fresh.local pathname", () => {
	const cwd = uniqueDir("fresh-local-decode");
	try {
		expect(
			resolveTarget("http://fresh.local/work/repo/lead%20notes.md:1", cwd),
		).toEqual({
			path: "/work/repo/lead notes.md",
			line: 1,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget parses http://fresh.local URI query line", () => {
	const cwd = uniqueDir("fresh-local-query");
	try {
		expect(
			resolveTarget("http://fresh.local/work/repo/notes.md?line=1", cwd),
		).toEqual({
			path: "/work/repo/notes.md",
			line: 1,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget resolves existing relative path with line and column", () => {
	const cwd = uniqueDir("rel-path");
	try {
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "foo.rs"), "fn main() {}\n");
		expect(resolveTarget("src/foo.rs:12:3", cwd)).toEqual({
			path: join(cwd, "src", "foo.rs"),
			line: 12,
			column: 3,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("resolveTarget expands ~ against the given home directory", () => {
	const home = uniqueDir("home");
	try {
		mkdirSync(join(home, "repo"));
		writeFileSync(join(home, "repo", "notes.md"), "# notes\n");
		expect(resolveTarget("~/repo/notes.md:7", "/work/elsewhere", home)).toEqual({
			path: join(home, "repo", "notes.md"),
			line: 7,
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("resolveTarget marks an existing directory so a Fresh explorer can root there", () => {
	const cwd = uniqueDir("dir-target");
	try {
		mkdirSync(join(cwd, "src"));
		expect(resolveTarget("src", cwd)).toEqual({
			path: join(cwd, "src"),
			isDirectory: true,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("planFreshOpen splits instead of open-file when the target is a directory", () => {
	expect(
		planFreshOpen({
			tabId: "tab-1",
			spec: "/work/repo/src",
			isDirectory: true,
			panes: [
				{
					pane_id: "w:p7",
					tab_id: "tab-1",
					terminal_title_stripped: "src/main.rs — Fresh",
					cwd: "/work/repo",
				},
			],
			daemons: [{ name: "local-99-abc", cwd: "/work/repo" }],
		}),
	).toEqual({ kind: "split", spec: "/work/repo/src" });
});

test("planFreshOpen focuses a Fresh pane already rooted at the clicked directory", () => {
	expect(
		planFreshOpen({
			tabId: "tab-1",
			spec: "/work/repo/src",
			isDirectory: true,
			panes: [
				{
					pane_id: "w:p7",
					tab_id: "tab-1",
					terminal_title_stripped: "src — Fresh",
					cwd: "/work/repo/src",
				},
			],
			daemons: [{ name: "local-99-abc", cwd: "/work/repo/src" }],
		}),
	).toEqual({ kind: "focus", paneId: "w:p7" });
});

test("resolveTarget marks a file URI that points at an existing directory", () => {
	const cwd = uniqueDir("file-uri-dir");
	try {
		expect(resolveTarget(`file://${cwd}`, "/work/elsewhere")).toEqual({
			path: cwd,
			isDirectory: true,
		});
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("planFreshOpen reuses same-tab Fresh daemon", () => {
	const cwd = "/work/repo";
	expect(
		planFreshOpen({
			tabId: "tab-1",
			spec: "/tmp/foo.rs:12:3",
			panes: [
				{
					pane_id: "w:p1",
					tab_id: "tab-1",
					terminal_title_stripped: "omp",
					cwd,
				},
				{
					pane_id: "w:p7",
					tab_id: "tab-1",
					terminal_title_stripped: "src/main.rs — Fresh",
					cwd,
				},
				{
					pane_id: "w:p9",
					tab_id: "tab-other",
					terminal_title_stripped: "notes.md — Fresh",
					cwd: "/other",
				},
			],
			daemons: [{ name: "local-99-abc", cwd }],
		}),
	).toEqual({
		kind: "open-file",
		paneId: "w:p7",
		daemon: "local-99-abc",
		spec: "/tmp/foo.rs:12:3",
	});
});

test("planFreshOpen splits when tab has no Fresh pane", () => {
	expect(
		planFreshOpen({
			tabId: "tab-1",
			spec: "/tmp/foo.rs:12:3",
			panes: [
				{
					pane_id: "w:p1",
					tab_id: "tab-1",
					terminal_title_stripped: "omp",
					cwd: "/work/repo",
				},
			],
			daemons: [],
		}),
	).toEqual({ kind: "split", spec: "/tmp/foo.rs:12:3" });
});

test("planFreshOpen focuses existing Fresh when daemon is unbound", () => {
	expect(
		planFreshOpen({
			tabId: "tab-1",
			spec: "/tmp/foo.rs:12:3",
			panes: [
				{
					pane_id: "w:p4",
					tab_id: "tab-1",
					terminal_title_stripped: "notes.md — Fresh",
					cwd: "/tmp/editor",
				},
			],
			daemons: [],
		}),
	).toEqual({ kind: "focus", paneId: "w:p4" });
});

test("openInFresh opens file on matching same-tab daemon and focuses pane", async () => {
	const calls: string[][] = [];
	const cwd = "/work/repo";
	await openInFresh({
		url: "file:///tmp/foo.rs:12:3",
		workspaceId: "ws",
		tabId: "tab-1",
		paneId: "w:p1",
		cwd,
		herdr: "herdr",
		fresh: "fresh",
		run(_bin, argv) {
			calls.push([_bin, ...argv]);
			if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "list") {
				return {
					status: 0,
					stdout: JSON.stringify({
						id: "cli:pane:list",
						result: {
							type: "pane_list",
							panes: [
								{
									pane_id: "w:p1",
									tab_id: "tab-1",
									terminal_title_stripped: "omp",
									cwd,
								},
								{
									pane_id: "w:p7",
									tab_id: "tab-1",
									terminal_title_stripped: "src/main.rs — Fresh",
									cwd,
								},
							],
						},
					}),
				};
			}
			if (_bin === "fresh" && argv.includes("list")) {
				return {
					status: 0,
					stdout: "Running daemons:\n  local-99-abc\n",
				};
			}
			return { status: 0, stdout: "" };
		},
		daemonCwd(pid) {
			return pid === 99 ? cwd : null;
		},
	});
	expect(calls).toContainEqual([
		"fresh",
		"--cmd",
		"daemon",
		"open-file",
		"local-99-abc",
		"/tmp/foo.rs:12:3",
	]);
	expect(calls).toContainEqual(["herdr", "pane", "focus", "w:p7"]);
});

test("openInFresh splits and runs fresh when tab has no Fresh pane", async () => {
	const calls: string[][] = [];
	const cwd = "/work/repo";
	const existing = {
		pane_id: "w:p1",
		tab_id: "tab-1",
		terminal_title_stripped: "omp",
		cwd,
	};
	const created = {
		pane_id: "w:p2",
		tab_id: "tab-1",
		terminal_title_stripped: "zsh",
		cwd,
	};
	let lists = 0;
	await openInFresh({
		url: "file:///tmp/foo.rs:12:3",
		workspaceId: "ws",
		tabId: "tab-1",
		paneId: "w:p1",
		cwd,
		herdr: "herdr",
		fresh: "fresh",
		run(_bin, argv) {
			calls.push([_bin, ...argv]);
			if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "list") {
				lists += 1;
				const panes = lists === 1 ? [existing] : [existing, created];
				return {
					status: 0,
					stdout: JSON.stringify({
						id: "cli:pane:list",
						result: { type: "pane_list", panes },
					}),
				};
			}
			if (_bin === "fresh" && argv.includes("list")) {
				return { status: 0, stdout: "Running daemons:\n" };
			}
			return { status: 0, stdout: "" };
		},
		daemonCwd() {
			return null;
		},
	});
	expect(calls).toContainEqual([
		"herdr",
		"pane",
		"split",
		"--pane",
		"w:p1",
		"--direction",
		"right",
		"--cwd",
		cwd,
		"--ratio",
		"0.5",
	]);
	expect(calls).toContainEqual([
		"herdr",
		"pane",
		"run",
		"w:p2",
		"fresh",
		"--no-restore",
		"/tmp/foo.rs:12:3",
	]);
});

test("smartSplitDirection picks right for wide 1x1 panes and down for tall column panes", () => {
	const fullScreen = JSON.stringify({
		result: {
			layout: {
				panes: [{ pane_id: "w:p1", rect: { x: 0, y: 0, width: 165, height: 46 } }],
			},
		},
	});
	const twoColumn = JSON.stringify({
		result: {
			layout: {
				panes: [
					{ pane_id: "w:p1", rect: { x: 0, y: 0, width: 82, height: 46 } },
					{ pane_id: "w:p2", rect: { x: 82, y: 0, width: 83, height: 46 } },
				],
			},
		},
	});
	expect(smartSplitDirection(fullScreen, "w:p1")).toBe("right");
	expect(smartSplitDirection(twoColumn, "w:p1")).toBe("down");
});

test("resolveExplorerRoot walks up to project root of clicked file and falls back to cwd", () => {
	const root = "/work/repo";
	const file = "/work/repo/src/open.ts";
	const exists = (p: string) => p === "/work/repo/.git";
	expect(resolveExplorerRoot(file, "/work/elsewhere", exists, () => false)).toBe(root);
	expect(resolveExplorerRoot("/tmp/foo.rs", "/work/repo", () => false, () => false)).toBe(
		"/work/repo",
	);
});

test("resolveExplorerRoot treats a .jj directory as a project root", () => {
	const exists = (p: string) => p === "/work/colocated/.jj";
	expect(
		resolveExplorerRoot("/work/colocated/src/open.ts", "/work/elsewhere", exists, () => false),
	).toBe("/work/colocated");
});
test("openInFresh splits down when clicked pane is a narrow column in a side-by-side tab", async () => {
	const calls: string[][] = [];
	const cwd = "/work/repo";
	const left = { pane_id: "w:p1", tab_id: "tab-1", terminal_title_stripped: "lead", cwd };
	const right = { pane_id: "w:p2", tab_id: "tab-1", terminal_title_stripped: "mg", cwd };
	const created = { pane_id: "w:p3", tab_id: "tab-1", terminal_title_stripped: "zsh", cwd };
	let lists = 0;
	await openInFresh({
		url: "file:///tmp/foo.rs:12:3",
		workspaceId: "ws",
		tabId: "tab-1",
		paneId: "w:p1",
		cwd,
		herdr: "herdr",
		fresh: "fresh",
		run(_bin, argv) {
			calls.push([_bin, ...argv]);
			if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "list") {
				lists += 1;
				const panes = lists === 1 ? [left, right] : [left, right, created];
				return {
					status: 0,
					stdout: JSON.stringify({ id: "cli:pane:list", result: { type: "pane_list", panes } }),
				};
			}
			if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "layout") {
				return {
					status: 0,
					stdout: JSON.stringify({
						result: {
							layout: {
								panes: [
									{ pane_id: "w:p1", rect: { x: 0, y: 0, width: 82, height: 46 } },
									{ pane_id: "w:p2", rect: { x: 82, y: 0, width: 83, height: 46 } },
								],
							},
						},
					}),
				};
			}
			if (_bin === "fresh" && argv.includes("list")) {
				return { status: 0, stdout: "Running daemons:\n" };
			}
			return { status: 0, stdout: "" };
		},
		daemonCwd() {
			return null;
		},
	});
	expect(calls).toContainEqual([
		"herdr",
		"pane",
		"split",
		"--pane",
		"w:p1",
		"--direction",
		"down",
		"--cwd",
		cwd,
		"--ratio",
		"0.5",
	]);
	expect(calls).toContainEqual([
		"herdr",
		"pane",
		"run",
		"w:p3",
		"fresh",
		"--no-restore",
		"/tmp/foo.rs:12:3",
	]);
});
test("open.ts CLI reads daemon cwd without a readlink binary on PATH", async () => {
	const dir = uniqueDir("no-readlink");
	const log = join(dir, "calls.log");
	const cwd = join(dir, "project");
	mkdirSync(cwd);
	const daemon = Bun.spawn({ cmd: ["sleep", "30"], cwd, stdout: "ignore", stderr: "ignore" });
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const herdr = join(bin, "herdr");
	const fresh = join(bin, "fresh");
	writeFileSync(
		herdr,
		`#!/bin/sh
echo herdr "$@" >> "$CALLS"
if [ "$1" = pane ] && [ "$2" = list ]; then
printf '%s\\n' '{"id":"cli:pane:list","result":{"type":"pane_list","panes":[{"pane_id":"w:p1","tab_id":"tab-1","terminal_title_stripped":"omp","cwd":"CWD_PLACEHOLDER"},{"pane_id":"w:p7","tab_id":"tab-1","terminal_title_stripped":"src/main.rs — Fresh","cwd":"CWD_PLACEHOLDER"}]}}'
fi
`,
	);
	writeFileSync(
		fresh,
		`#!/bin/sh
echo fresh "$@" >> "$CALLS"
if [ "$1" = --cmd ] && [ "$2" = daemon ] && [ "$3" = list ]; then
echo "Running daemons:"
echo "  local-${daemon.pid}-abc"
fi
`,
	);
	chmodSync(herdr, 0o755);
	chmodSync(fresh, 0o755);
	writeFileSync(herdr, readFileSync(herdr, "utf8").replaceAll("CWD_PLACEHOLDER", cwd));
	chmodSync(herdr, 0o755);
	try {
		const proc = Bun.spawn({
			cmd: [
				process.execPath,
				join(import.meta.dir, "open.ts"),
				"--url",
				"file:///tmp/foo.rs:12:3",
				"--workspace-id",
				"ws",
				"--tab-id",
				"tab-1",
				"--pane-id",
				"w:p1",
				"--cwd",
				cwd,
			],
			env: {
				...process.env,
				// Only the fixtures are reachable: no readlink on PATH.
				PATH: bin,
				CALLS: log,
				HERDR_BIN_PATH: herdr,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		expect(code).toBe(0);
		const logged = readFileSync(log, "utf8");
		expect(logged).toContain(
			`fresh --cmd daemon open-file local-${daemon.pid}-abc /tmp/foo.rs:12:3`,
		);
	} finally {
		daemon.kill();
		rmSync(dir, { recursive: true, force: true });
	}
});
test("openInFresh splits at the clicked directory instead of opening it as a file", async () => {
	const root = uniqueDir("e2e-dir");
	try {
		mkdirSync(join(root, ".git"));
		const docs = join(root, "docs");
		mkdirSync(docs);
		const calls: string[][] = [];
		const existing = {
			pane_id: "w:p1",
			tab_id: "tab-1",
			terminal_title_stripped: "omp",
			cwd: root,
		};
		const created = {
			pane_id: "w:p2",
			tab_id: "tab-1",
			terminal_title_stripped: "zsh",
			cwd: root,
		};
		let lists = 0;
		await openInFresh({
			url: docs,
			workspaceId: "ws",
			tabId: "tab-1",
			paneId: "w:p1",
			cwd: root,
			herdr: "herdr",
			fresh: "fresh",
			run(_bin, argv) {
				calls.push([_bin, ...argv]);
				if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "list") {
					lists += 1;
					const panes = lists === 1 ? [existing] : [existing, created];
					return {
						status: 0,
						stdout: JSON.stringify({
							id: "cli:pane:list",
							result: { type: "pane_list", panes },
						}),
					};
				}
				if (_bin === "fresh" && argv.includes("list")) {
					return { status: 0, stdout: "Running daemons:\n  local-99-abc\n" };
				}
				return { status: 0, stdout: "" };
			},
			daemonCwd() {
				return root;
			},
		});
		expect(calls).toContainEqual([
			"herdr",
			"pane",
			"split",
			"--pane",
			"w:p1",
			"--direction",
			"right",
			"--cwd",
			docs,
			"--ratio",
			"0.5",
		]);
		expect(calls).toContainEqual([
			"herdr",
			"pane",
			"run",
			"w:p2",
			"fresh",
			"--no-restore",
			docs,
		]);
		expect(calls.some((call) => call.includes("open-file"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openInFresh focuses a same-tab Fresh already rooted at the clicked directory", async () => {
	const root = uniqueDir("e2e-dir-focus");
	try {
		mkdirSync(join(root, ".git"));
		const docs = join(root, "docs");
		mkdirSync(docs);
		const calls: string[][] = [];
		await openInFresh({
			url: docs,
			workspaceId: "ws",
			tabId: "tab-1",
			paneId: "w:p1",
			cwd: root,
			herdr: "herdr",
			fresh: "fresh",
			run(_bin, argv) {
				calls.push([_bin, ...argv]);
				if (_bin === "herdr" && argv[0] === "pane" && argv[1] === "list") {
					return {
						status: 0,
						stdout: JSON.stringify({
							id: "cli:pane:list",
							result: {
								type: "pane_list",
								panes: [
									{ pane_id: "w:p1", tab_id: "tab-1", terminal_title_stripped: "omp", cwd: root },
									{
										pane_id: "w:p7",
										tab_id: "tab-1",
										terminal_title_stripped: "docs — Fresh",
										cwd: docs,
									},
								],
							},
						}),
					};
				}
				if (_bin === "fresh" && argv.includes("list")) {
					return { status: 0, stdout: "Running daemons:\n  local-99-abc\n" };
				}
				return { status: 0, stdout: "" };
			},
			daemonCwd() {
				return docs;
			},
		});
		expect(calls).toContainEqual(["herdr", "pane", "focus", "w:p7"]);
		expect(calls.some((call) => call.includes("split"))).toBe(false);
		expect(calls.some((call) => call.includes("open-file"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("open.ts CLI opens file using HERDR env and argv", async () => {
	const dir = uniqueDir("cli");
	const log = join(dir, "calls.log");
	const cwd = join(dir, "project");
	mkdirSync(cwd);
	// A real process whose /proc/<pid>/cwd is the project dir: the daemon list
	// reports this pid instead of a fixture, so cwd binding is genuinely read.
	const daemon = Bun.spawn({ cmd: ["sleep", "30"], cwd, stdout: "ignore", stderr: "ignore" });
	const herdr = join(dir, "herdr");
	const fresh = join(dir, "fresh");
	writeFileSync(
		herdr,
		`#!/bin/sh
echo herdr "$@" >> "$CALLS"
if [ "$1" = pane ] && [ "$2" = list ]; then
cat <<'JSON'
{"id":"cli:pane:list","result":{"type":"pane_list","panes":[{"pane_id":"w:p1","tab_id":"tab-1","terminal_title_stripped":"omp","cwd":"CWD_PLACEHOLDER"},{"pane_id":"w:p7","tab_id":"tab-1","terminal_title_stripped":"src/main.rs — Fresh","cwd":"CWD_PLACEHOLDER"}]}}
JSON
fi
`,
	);
	writeFileSync(
		fresh,
		`#!/bin/sh
echo fresh "$@" >> "$CALLS"
if [ "$1" = --cmd ] && [ "$2" = daemon ] && [ "$3" = list ]; then
echo "Running daemons:"
echo "  local-${daemon.pid}-abc"
fi
`,
	);
	chmodSync(herdr, 0o755);
	chmodSync(fresh, 0o755);
	const herdrSrc = readFileSync(herdr, "utf8").replaceAll("CWD_PLACEHOLDER", cwd);
	writeFileSync(herdr, herdrSrc);
	chmodSync(herdr, 0o755);
	try {
		const proc = Bun.spawn({
			cmd: [
				"bun",
				join(import.meta.dir, "open.ts"),
				"--url",
				"file:///tmp/foo.rs:12:3",
				"--workspace-id",
				"ws",
				"--tab-id",
				"tab-1",
				"--pane-id",
				"w:p1",
				"--cwd",
				cwd,
			],
			env: {
				...process.env,
				PATH: `${dir}:${process.env.PATH ?? ""}`,
				CALLS: log,
				HERDR_BIN_PATH: herdr,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		expect(code).toBe(0);
		const logged = readFileSync(log, "utf8");
		expect(logged).toContain(
			`fresh --cmd daemon open-file local-${daemon.pid}-abc /tmp/foo.rs:12:3`,
		);
		expect(logged).toContain("herdr pane focus w:p7");
	} finally {
		daemon.kill();
		rmSync(dir, { recursive: true, force: true });
	}
});
