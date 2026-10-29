import { spawnSync } from "node:child_process";
import { existsSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type FileSpec = {
	path: string;
	line?: number;
	column?: number;
	isDirectory?: true;
};

export function formatSpec(target: FileSpec): string {
	if (target.line != null && target.column != null) {
		return `${target.path}:${target.line}:${target.column}`;
	}
	if (target.line != null) {
		return `${target.path}:${target.line}`;
	}
	return target.path;
}

export function resolveTarget(token: string, cwd: string, home = defaultHome()): FileSpec | null {
	const trimmed = token.trim();
	if (!trimmed) {
		return null;
	}
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return markDirectory(parseFreshLocalUri(trimmed));
	}
	if (trimmed.startsWith("file://")) {
		return markDirectory(parseFileUri(trimmed));
	}
	return resolvePlainPath(trimmed, cwd, home);
}

function markDirectory(spec: FileSpec | null): FileSpec | null {
	if (!spec || spec.line != null) {
		return spec;
	}
	try {
		if (!statSync(spec.path).isDirectory()) {
			return spec;
		}
	} catch {
		return spec;
	}
	return { path: spec.path, isDirectory: true };
}

function parseFreshLocalUri(token: string): FileSpec | null {
	let url: URL;
	try {
		url = new URL(token);
	} catch {
		return null;
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.hostname !== "fresh.local"
	) {
		return null;
	}
	const spec = splitLineColumn(decodeURIComponent(url.pathname));
	if (spec.line == null) {
		const queryLine = url.searchParams.get("line");
		if (queryLine != null) {
			const line = Number(queryLine);
			if (Number.isFinite(line)) {
				spec.line = line;
			}
		}
	}
	return spec;
}

function parseFileUri(token: string): FileSpec | null {
	let rest = token.slice("file://".length);
	let hashLine: number | undefined;
	const hash = rest.match(/^(.*)#(?:L|l)(\d+)$/);
	if (hash) {
		rest = hash[1]!;
		hashLine = Number(hash[2]);
	}
	const path = rest.startsWith("/") ? rest : null;
	if (path == null) {
		return null;
	}
	const spec = splitLineColumn(path);
	if (spec.line == null && hashLine != null) {
		spec.line = hashLine;
	}
	return spec;
}

function resolvePlainPath(token: string, cwd: string, home: string): FileSpec | null {
	const spec = splitLineColumn(token);
	if (!spec.path) {
		return null;
	}
	const resolved = resolveAgainstCwd(spec.path, cwd, home);
	if (existsSync(resolved)) {
		return markDirectory({ ...spec, path: resolved });
	}
	const full = resolveAgainstCwd(token, cwd, home);
	if (existsSync(full)) {
		return markDirectory({ path: full });
	}
	return null;
}

function defaultHome(): string {
	return process.env.HOME || homedir();
}

function resolveAgainstCwd(path: string, cwd: string, home: string): string {
	if (path === "~" || path.startsWith("~/")) {
		return join(home, path.slice(1));
	}
	if (isAbsolute(path)) {
		return path;
	}
	return join(cwd, path);
}

function splitLineColumn(value: string): FileSpec {
	const lineCol = value.match(/^(.*):(\d+):(\d+)$/);
	if (lineCol) {
		return {
			path: lineCol[1]!,
			line: Number(lineCol[2]),
			column: Number(lineCol[3]),
		};
	}
	const lineOnly = value.match(/^(.*):(\d+)$/);
	if (lineOnly) {
		return { path: lineOnly[1]!, line: Number(lineOnly[2]) };
	}
	return { path: value };
}

export type PaneSnapshot = {
	pane_id: string;
	tab_id: string;
	cwd?: string;
	terminal_title_stripped?: string | null;
	title?: string | null;
};

export type FreshDaemon = {
	name: string;
	cwd: string;
};

export type FreshPlan =
	| { kind: "open-file"; paneId: string; daemon: string; spec: string }
	| { kind: "focus"; paneId: string }
	| { kind: "split"; spec: string };

export function planFreshOpen(input: {
	tabId: string;
	spec: string;
	isDirectory?: boolean;
	panes: PaneSnapshot[];
	daemons: FreshDaemon[];
}): FreshPlan {
	const fresh = input.panes.find(
		(pane) => pane.tab_id === input.tabId && isFreshPane(pane),
	);
	if (fresh) {
		if (input.isDirectory) {
			// `fresh --cmd daemon open-file` refuses directories, so a Fresh
			// already rooted at the clicked folder is the only reusable pane.
			return fresh.cwd && resolve(fresh.cwd) === resolve(input.spec)
				? { kind: "focus", paneId: fresh.pane_id }
				: { kind: "split", spec: input.spec };
		}
		const daemon = input.daemons.find((item) => item.cwd === fresh.cwd);
		if (daemon) {
			return {
				kind: "open-file",
				paneId: fresh.pane_id,
				daemon: daemon.name,
				spec: input.spec,
			};
		}
		return { kind: "focus", paneId: fresh.pane_id };
	}
	return { kind: "split", spec: input.spec };
}

function isFreshPane(pane: PaneSnapshot): boolean {
	const title = pane.terminal_title_stripped ?? pane.title ?? "";
	return title.includes(" — Fresh");
}

export type SplitDirection = "right" | "down";

export type RunResult = { status: number; stdout: string; stderr?: string };

export function smartSplitDirection(layoutStdout: string, paneId: string): SplitDirection {
	try {
		const parsed = JSON.parse(layoutStdout) as {
			result?: {
				layout?: {
					panes?: Array<{
						pane_id?: string;
						rect?: { width?: number; height?: number };
					}>;
				};
			};
		};
		const panes = parsed.result?.layout?.panes;
		if (!Array.isArray(panes)) return "right";
		const hit = panes.find((p) => p.pane_id === paneId);
		const width = hit?.rect?.width;
		const height = hit?.rect?.height;
		if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
			return width >= height * 2 ? "right" : "down";
		}
	} catch {}
	return "right";
}
export function resolveExplorerRoot(
	filePath: string,
	fallbackCwd: string,
	exists: (path: string) => boolean = existsSync,
	isDirectory: (path: string) => boolean = (path) => {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
): string {
	if (!filePath || !isAbsolute(filePath)) return fallbackCwd;
	const startDir = exists(filePath) && isDirectory(filePath) ? resolve(filePath) : resolve(dirname(filePath));
	let dir = startDir;
	for (;;) {
		if (exists(join(dir, ".git")) || exists(join(dir, ".jj"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return fallbackCwd || startDir;
}

export type OpenInFreshInput = {
	url: string;
	workspaceId: string;
	tabId: string;
	paneId: string;
	cwd: string;
	herdr: string;
	fresh: string;
	run: (bin: string, argv: string[]) => RunResult;
	daemonCwd: (pid: number) => string | null;
};
export async function openInFresh(input: OpenInFreshInput): Promise<void> {
	const target = resolveTarget(input.url, input.cwd);
	if (!target) return;

	const spec = formatSpec(target);
	const panes = parsePaneList(
		input.run(input.herdr, ["pane", "list", "--workspace", input.workspaceId]).stdout,
	);
	const daemons = parseFreshDaemons(
		input.run(input.fresh, ["--cmd", "daemon", "list"]).stdout,
		input.daemonCwd,
	);
	const plan = planFreshOpen({
		tabId: input.tabId,
		spec,
		isDirectory: target.isDirectory,
		panes,
		daemons,
	});

	if (plan.kind === "open-file") {
		input.run(input.fresh, ["--cmd", "daemon", "open-file", plan.daemon, plan.spec]);
		input.run(input.herdr, ["pane", "focus", plan.paneId]);
		return;
	}
	if (plan.kind === "focus") {
		input.run(input.herdr, ["pane", "focus", plan.paneId]);
		return;
	}

	const before = new Set(
		panes.filter((pane) => pane.tab_id === input.tabId).map((pane) => pane.pane_id),
	);
	const direction = smartSplitDirection(
		input.run(input.herdr, ["pane", "layout", "--pane", input.paneId]).stdout,
		input.paneId,
	);
	input.run(input.herdr, [
		"pane",
		"split",
		"--pane",
		input.paneId,
		"--direction",
		direction,
		"--cwd",
		target.isDirectory
			? resolve(target.path)
			: resolveExplorerRoot(target.path, input.cwd),
		"--ratio",
		"0.5",
	]);

	const created = parsePaneList(
		input.run(input.herdr, ["pane", "list", "--workspace", input.workspaceId]).stdout,
	).find((pane) => pane.tab_id === input.tabId && !before.has(pane.pane_id));
	if (!created) return;

	input.run(input.herdr, ["pane", "run", created.pane_id, "fresh", "--no-restore", plan.spec]);
}

function parsePaneList(stdout: string): PaneSnapshot[] {
	try {
		const json = JSON.parse(stdout) as { result?: { panes?: PaneSnapshot[] } };
		return Array.isArray(json.result?.panes) ? json.result.panes : [];
	} catch {
		return [];
	}
}

function parseFreshDaemons(
	output: string,
	daemonCwd: (pid: number) => string | null,
): FreshDaemon[] {
	const daemons: FreshDaemon[] = [];
	for (const line of output.split("\n")) {
		const match = line.trim().match(/^(local-(\d+)-\S+)/);
		if (!match) continue;
		const [, name, pid] = match;
		const cwd = daemonCwd(Number(pid));
		if (cwd) daemons.push({ name: name!, cwd });
	}
	return daemons;
}

export function parseInvocation(
	argv: string[],
	env: NodeJS.ProcessEnv,
): {
	url: string;
	workspaceId: string;
	tabId: string;
	paneId: string;
	cwd: string;
} | null {
	const flags = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 1) {
		const key = argv[i];
		if (key?.startsWith("--") && i + 1 < argv.length) {
			flags.set(key.slice(2), argv[i + 1]!);
			i += 1;
		}
	}
	let context: Record<string, unknown> = {};
	if (env.HERDR_PLUGIN_CONTEXT_JSON) {
		try {
			context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON) as Record<string, unknown>;
		} catch {
			context = {};
		}
	}
	const clicked =
		typeof context.clicked_url === "string" ? context.clicked_url : undefined;
	const workspace =
		typeof context.workspace_id === "string" ? context.workspace_id : undefined;
	const tab = typeof context.tab_id === "string" ? context.tab_id : undefined;
	const pane =
		typeof context.focused_pane_id === "string" ? context.focused_pane_id : undefined;
	const paneCwd =
		typeof context.focused_pane_cwd === "string" ? context.focused_pane_cwd : undefined;
	const url = flags.get("url") ?? env.HERDR_PLUGIN_CLICKED_URL ?? clicked;
	const workspaceId = flags.get("workspace-id") ?? env.HERDR_WORKSPACE_ID ?? workspace;
	const tabId = flags.get("tab-id") ?? env.HERDR_TAB_ID ?? tab;
	const paneId = flags.get("pane-id") ?? env.HERDR_PANE_ID ?? pane;
	const cwd = flags.get("cwd") ?? paneCwd ?? env.PWD ?? "";
	if (!url || !workspaceId || !tabId || !paneId) {
		return null;
	}
	return { url, workspaceId, tabId, paneId, cwd };
}

function liveRun(bin: string, argv: string[]): RunResult {
	const result = spawnSync(bin, argv, { encoding: "utf8" });
	return {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function liveDaemonCwd(pid: number): string | null {
	try {
		const cwd = readlinkSync(`/proc/${pid}/cwd`).trim();
		return cwd || null;
	} catch {
		return null;
	}
}

async function main(): Promise<number> {
	const parsed = parseInvocation(process.argv.slice(2), process.env);
	if (!parsed) {
		return 2;
	}
	await openInFresh({
		...parsed,
		herdr: process.env.HERDR_BIN_PATH ?? "herdr",
		fresh: process.env.FRESH_BIN ?? "fresh",
		run: liveRun,
		daemonCwd: liveDaemonCwd,
	});
	return 0;
}

if (import.meta.main) {
	process.exit(await main());
}
