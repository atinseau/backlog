<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { t } from "./i18n.svelte.js";
  import { isMissingRepositoryPathError, relocateRepositoryPath } from "./repository-relocate.js";
  import {
    addGitWorktree,
    checkoutGitBranch,
    commitGitChanges,
    createGitPullRequest,
    discardGitChanges,
    ensureGitIgnore,
    fetchCommits,
    fetchGitBranchPreview,
    fetchGitBranches,
    fetchGitChanges,
    fetchGitCommitFiles,
    fetchGitRemoteState,
    fetchGitWorktrees,
    ignoreGitChanges,
    initGitRepository,
    mergeGitBranch,
    pruneGitWorktrees,
    removeGitWorktree,
    stashGitChanges,
    syncGitRepo,
    type CommitEntry,
    type CommitLink,
    type GitBranchPreview,
    type GitRepoBranches,
    type GitChangeEntry,
    type GitCommitFileEntry,
    type GitRemoteState,
    type GitRepoChanges,
    type GitRepoWorktrees,
    type GitWorktreeEntry,
  } from "./api.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
    selectedRepoId?: string | null;
    onCommitted?: () => void;
    onOpenDiff?: (repo: string, file: string, sha?: string | null, base?: string | null, head?: string | null) => void;
  }

  type GitTab = "changes" | "history" | "branches" | "worktrees";
  type CommitGroup = { repo: string; paths: string[] };
  type ContextMenuItem = { label: string; action: () => void; disabled?: boolean; danger?: boolean };
  type BranchRow = {
    key: string;
    repo: string;
    name: string;
    label: string;
    kind: "local" | "remote";
    current: boolean;
    upstream?: string | null;
    remote?: string;
  };

  const HISTORY_PAGE_SIZE = 50;

  let { onClose, embedded = false, selectedRepoId = null, onCommitted, onOpenDiff }: Props = $props();

  let activeTab = $state<GitTab>("changes");
  let commits = $state<CommitEntry[]>([]);
  let repos = $state<GitRepoChanges[]>([]);
  let remotes = $state<GitRemoteState[]>([]);
  let branches = $state<GitRepoBranches[]>([]);
  let worktrees = $state<GitRepoWorktrees[]>([]);
  let selected = $state<Set<string>>(new Set());
  let message = $state("");
  let loading = $state(true);
  let committing = $state(false);
  let gitActionBusy = $state<"discard" | "stash" | "ignore" | null>(null);
  let syncingRepo = $state<string | null>(null);
  let branchBusy = $state<string | null>(null);
  let pullRequestBusy = $state<string | null>(null);
  let worktreeBusy = $state<string | null>(null);
  let newBranchByRepo = $state<Record<string, string>>({});
  let mergeSourceByRepo = $state<Record<string, string>>({});
  let mergeStrategyByRepo = $state<Record<string, "auto" | "ff_only" | "no_ff">>({});
  let mergePreviews = $state<Record<string, GitBranchPreview | { loading: true } | { error: string }>>({});
  let newWorktreePathByRepo = $state<Record<string, string>>({});
  let newWorktreeBranchByRepo = $state<Record<string, string>>({});
  let error = $state<string | null>(null);
  let info = $state<string | null>(null);
  let messageEl = $state<HTMLTextAreaElement | null>(null);
  let selectedCommitKey = $state<string | null>(null);
  let commitFiles = $state<GitCommitFileEntry[]>([]);
  let commitFilesLoading = $state(false);
  let commitFilesError = $state<string | null>(null);
  let historyLoadingMore = $state(false);
  let historyHasMore = $state(false);
  let selectedBranchKey = $state<string | null>(null);
  let selectedWorktreeKey = $state<string | null>(null);
  let contextMenu = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  let focusRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const dirtyCount = $derived(repos.reduce((sum, repo) => sum + repo.changes.length, 0));
  const visibleRepos = $derived(repos.filter((repo) => repo.changes.length > 0 || repo.status.error));
  const selectedPaths = $derived([...selected]);
  const selectedRepoCount = $derived(new Set(selectedPaths.map((key) => key.split("\0")[0]).filter(Boolean)).size);
  const canCommit = $derived(Boolean(selectedPaths.length > 0 && message.trim() && !committing && !gitActionBusy));
  const canChangeSelected = $derived(Boolean(selectedPaths.length > 0 && !committing && !gitActionBusy));

  function focusOnMount(node: HTMLElement): void {
    setTimeout(() => node.focus(), 0);
  }

  function setActiveTab(next: GitTab) {
    activeTab = next;
  }

  function handleTabKeydown(e: KeyboardEvent, next: GitTab) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    setActiveTab(next);
  }

  function keyFor(repo: string, path: string): string {
    return `${repo}\0${path}`;
  }

  function pathsForRepo(repoId: string): string[] {
    return selectedPaths
      .filter((key) => key.startsWith(`${repoId}\0`))
      .map((key) => key.slice(repoId.length + 1));
  }

  function selectedPathGroups(): CommitGroup[] {
    const groups = new Map<string, string[]>();
    for (const key of selectedPaths) {
      const separator = key.indexOf("\0");
      if (separator === -1) continue;
      const repo = key.slice(0, separator);
      const path = key.slice(separator + 1);
      if (!repo || !path) continue;
      const paths = groups.get(repo) ?? [];
      paths.push(path);
      groups.set(repo, paths);
    }
    return [...groups.entries()].map(([repo, paths]) => ({ repo, paths }));
  }

  function resetSelection(nextRepos: GitRepoChanges[]) {
    const next = new Set<string>();
    for (const repo of nextRepos) {
      for (const change of repo.changes) {
        if (change.kind !== "conflicted") next.add(keyFor(repo.repo, change.path));
      }
    }
    selected = next;
  }

  function preserveSelection(nextRepos: GitRepoChanges[]) {
    const valid = new Set<string>();
    for (const repo of nextRepos) {
      for (const change of repo.changes) {
        if (change.kind !== "conflicted") valid.add(keyFor(repo.repo, change.path));
      }
    }
    selected = new Set([...selected].filter((key) => valid.has(key)));
  }

  async function load(options: { preserveSelection?: boolean } = {}) {
    loading = true;
    try {
      const [nextRepos, nextCommits] = await Promise.all([
        fetchGitChanges(selectedRepoId),
        fetchCommits(HISTORY_PAGE_SIZE + 1, selectedRepoId),
      ]);
      repos = nextRepos;
      commits = nextCommits.slice(0, HISTORY_PAGE_SIZE);
      historyHasMore = nextCommits.length > HISTORY_PAGE_SIZE;
      if (selectedCommitKey && !nextCommits.some((commit) => commitKey(commit) === selectedCommitKey)) {
        selectedCommitKey = null;
        commitFiles = [];
        commitFilesError = null;
      }
      const [nextRemotes, nextBranches, nextWorktrees] = await Promise.all([
        fetchGitRemoteState(selectedRepoId).catch(() => []),
        fetchGitBranches(selectedRepoId).catch(() => []),
        fetchGitWorktrees(selectedRepoId).catch(() => []),
      ]);
      remotes = nextRemotes;
      branches = nextBranches;
      worktrees = nextWorktrees;
      if (selectedBranchKey && !nextBranches.some((state) => branchRows(state).some((row) => row.key === selectedBranchKey))) {
        selectedBranchKey = null;
      }
      if (selectedWorktreeKey && !nextWorktrees.some((repo) => repo.worktrees.some((worktree) => worktreeKey(repo.repo, worktree.path) === selectedWorktreeKey))) {
        selectedWorktreeKey = null;
      }
      if (options.preserveSelection) preserveSelection(nextRepos);
      else resetSelection(nextRepos);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
      setTimeout(() => messageEl?.focus(), 0);
    }
  }

  function toggleChange(repo: string, change: GitChangeEntry, checked: boolean) {
    const next = new Set(selected);
    const key = keyFor(repo, change.path);
    if (checked) next.add(key);
    else next.delete(key);
    selected = next;
  }

  function changeSelected(repo: string, change: GitChangeEntry): boolean {
    return selected.has(keyFor(repo, change.path));
  }

  function toggleChangeRow(repo: string, change: GitChangeEntry) {
    onOpenDiff?.(repo, change.path);
    if (change.kind === "conflicted") return;
    toggleChange(repo, change, !changeSelected(repo, change));
  }

  function handleChangeRowKeydown(e: KeyboardEvent, repo: string, change: GitChangeEntry) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleChangeRow(repo, change);
  }

  function splitPath(path: string): { dir: string; name: string } {
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx === -1) return { dir: "", name: normalized };
    return { dir: normalized.slice(0, idx + 1), name: normalized.slice(idx + 1) };
  }

  function repoRoot(repoId: string): string | null {
    return repos.find((repo) => repo.repo === repoId)?.path
      ?? branches.find((repo) => repo.repo === repoId)?.path
      ?? worktrees.find((repo) => repo.repo === repoId)?.path
      ?? null;
  }

  function absoluteFilePath(repoId: string, filePath: string): string | null {
    const root = repoRoot(repoId);
    if (!root) return null;
    return `${root.replace(/[\\/]+$/, "")}/${filePath.replace(/^[\\/]+/, "")}`;
  }

  function openPath(path: string) {
    if (typeof window !== "undefined" && window.backlog?.openPath) {
      void window.backlog.openPath(path).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(path).catch(() => undefined);
      info = t("git.path_copied");
    }
  }

  function openEditor(path: string) {
    if (typeof window !== "undefined" && window.backlog?.openEditor) {
      void window.backlog.openEditor(path).catch(() => openPath(path));
    } else {
      openPath(path);
    }
  }

  function revealPath(path: string) {
    if (typeof window !== "undefined" && window.backlog?.showInFolder) {
      void window.backlog.showInFolder(path).catch(() => undefined);
    } else {
      openPath(path);
    }
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function showContextMenu(event: MouseEvent, items: ContextMenuItem[]) {
    event.preventDefault();
    event.stopPropagation();
    const width = 230;
    const height = Math.max(44, items.length * 32 + 8);
    const maxX = typeof window === "undefined" ? event.clientX : window.innerWidth - width - 8;
    const maxY = typeof window === "undefined" ? event.clientY : window.innerHeight - height - 8;
    contextMenu = {
      x: Math.max(8, Math.min(event.clientX, maxX)),
      y: Math.max(8, Math.min(event.clientY, maxY)),
      items,
    };
  }

  function showRepositoryContextMenu(event: MouseEvent, repoId: string) {
    const root = repoRoot(repoId);
    showContextMenu(event, [
      { label: t("context.open_editor"), action: () => root && openEditor(root), disabled: !root },
      { label: t("context.reveal_finder"), action: () => root && revealPath(root), disabled: !root },
      { label: t("git.gitignore.edit"), action: () => { void editGitIgnore(repoId); }, disabled: !root },
    ]);
  }

  function showFileContextMenu(event: MouseEvent, repoId: string, filePath: string) {
    const absolutePath = absoluteFilePath(repoId, filePath);
    showContextMenu(event, [
      { label: t("context.open_editor"), action: () => absolutePath && openEditor(absolutePath), disabled: !absolutePath },
      { label: t("context.reveal_finder"), action: () => absolutePath && revealPath(absolutePath), disabled: !absolutePath },
      { label: t("git.ignore.context_file"), action: () => { void ignoreGroups([{ repo: repoId, paths: [filePath] }]); }, disabled: !absolutePath },
      { label: t("git.gitignore.edit"), action: () => { void editGitIgnore(repoId); }, disabled: !absolutePath },
    ]);
  }

  function toggleRepo(repo: GitRepoChanges, checked: boolean) {
    const next = new Set(selected);
    for (const change of repo.changes) {
      const key = keyFor(repo.repo, change.path);
      if (checked && change.kind !== "conflicted") next.add(key);
      else next.delete(key);
    }
    selected = next;
  }

  function kindLabel(kind: GitChangeEntry["kind"]): string {
    return t(`git.change.${kind}`);
  }

  function changeStatusLabel(change: GitChangeEntry): string {
    if (change.kind === "untracked") return t("git.change.added");
    return kindLabel(change.kind);
  }

  function remoteFor(repoId: string): GitRemoteState | null {
    return remotes.find((remote) => remote.repo === repoId) ?? null;
  }

  function branchesFor(repoId: string): GitRepoBranches | null {
    return branches.find((entry) => entry.repo === repoId) ?? null;
  }

  function hasLocalCheckout(state: GitRepoBranches): boolean {
    return state.has_local_checkout ?? Boolean(state.path);
  }

  function branchOptions(state: GitRepoBranches): string[] {
    const names = new Set<string>();
    for (const branch of state.local) names.add(branch.name);
    for (const branch of state.remote) names.add(branch.name);
    if (state.current_branch) names.add(state.current_branch);
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function mergeOptions(state: GitRepoBranches): string[] {
    return branchOptions(state).filter((name) => name !== state.current_branch);
  }

  function selectedMergeSource(state: GitRepoBranches): string {
    const options = mergeOptions(state);
    const current = mergeSourceByRepo[state.repo];
    return current && options.includes(current) ? current : options[0] ?? "";
  }

  function branchRowKey(repo: string, kind: BranchRow["kind"], name: string): string {
    return `${repo}\0${kind}\0${name}`;
  }

  function branchRows(state: GitRepoBranches): BranchRow[] {
    const rows: BranchRow[] = [];
    const seen = new Set<string>();
    for (const branch of state.local) {
      const key = branchRowKey(state.repo, "local", branch.name);
      rows.push({
        key,
        repo: state.repo,
        name: branch.name,
        label: branch.name,
        kind: "local",
        current: branch.current,
        upstream: branch.upstream,
      });
      seen.add(branch.name);
    }
    for (const branch of state.remote) {
      if (seen.has(branch.name)) continue;
      const current = branch.short_name === state.current_branch || branch.name === state.current_branch;
      rows.push({
        key: branchRowKey(state.repo, "remote", branch.name),
        repo: state.repo,
        name: branch.name,
        label: branch.short_name,
        kind: "remote",
        current,
        remote: branch.remote,
      });
    }
    return rows.sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.kind !== b.kind) return a.kind === "local" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }

  function branchMeta(row: BranchRow): string {
    const parts = [t(row.kind === "local" ? "git.branch.local" : "git.branch.remote")];
    if (row.upstream) parts.push(row.upstream);
    else if (row.remote) parts.push(row.remote);
    return parts.join(" · ");
  }

  function toggleBranchRow(state: GitRepoBranches, row: BranchRow) {
    selectedBranchKey = selectedBranchKey === row.key ? null : row.key;
    if (selectedBranchKey === row.key && !row.current && state.current_branch) {
      void loadMergePreview(state.repo, state.current_branch, row.name);
    }
  }

  function handleBranchRowKeydown(e: KeyboardEvent, state: GitRepoBranches, row: BranchRow) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleBranchRow(state, row);
  }

  function branchPreviewForRow(state: GitRepoBranches, row: BranchRow): GitBranchPreview | { loading: true } | { error: string } | null {
    if (row.current || !state.current_branch) return null;
    return mergePreviews[previewKey(state.repo, state.current_branch, row.name)] ?? null;
  }

  function worktreesFor(repoId: string): GitRepoWorktrees | null {
    return worktrees.find((entry) => entry.repo === repoId) ?? null;
  }

  function worktreeErrorText(value: string): string {
    if (value === "remote_repository_no_local_checkout" || value === "repository_has_no_local_checkout") {
      return t("git.worktree.checkout_required");
    }
    return value;
  }

  function isNotGitRepositoryError(value?: string | null): boolean {
    if (!value) return false;
    return /not a git repository|not inside a git work tree|must be run in a work tree/i.test(value);
  }

  function previewKey(repo: string, target: string, source: string): string {
    return `${repo}\0${target}\0${source}`;
  }

  function previewFor(state: GitRepoBranches): GitBranchPreview | { loading: true } | { error: string } | null {
    const source = selectedMergeSource(state);
    if (!source) return null;
    return mergePreviews[previewKey(state.repo, state.current_branch ?? "HEAD", source)] ?? null;
  }

  async function loadMergePreview(repo: string, target: string, source: string) {
    const key = previewKey(repo, target, source);
    if (mergePreviews[key]) return;
    mergePreviews = { ...mergePreviews, [key]: { loading: true } };
    try {
      const preview = await fetchGitBranchPreview(repo, source, target);
      mergePreviews = { ...mergePreviews, [key]: preview };
    } catch (err) {
      mergePreviews = { ...mergePreviews, [key]: { error: err instanceof Error ? err.message : String(err) } };
    }
  }

  function setNewBranch(repo: string, value: string) {
    newBranchByRepo = { ...newBranchByRepo, [repo]: value };
  }

  function setMergeSource(repo: string, value: string) {
    mergeSourceByRepo = { ...mergeSourceByRepo, [repo]: value };
    const state = branchesFor(repo);
    if (state) void loadMergePreview(repo, state.current_branch ?? "HEAD", value);
  }

  function setMergeStrategy(repo: string, value: "auto" | "ff_only" | "no_ff") {
    mergeStrategyByRepo = { ...mergeStrategyByRepo, [repo]: value };
  }

  function setNewWorktreePath(repo: string, value: string) {
    newWorktreePathByRepo = { ...newWorktreePathByRepo, [repo]: value };
  }

  function setNewWorktreeBranch(repo: string, value: string) {
    newWorktreeBranchByRepo = { ...newWorktreeBranchByRepo, [repo]: value };
  }

  function remoteText(remote: GitRemoteState | null): string {
    if (!remote) return t("git.remote.unknown");
    if (remote.error) return t("git.remote.error");
    if (!remote.has_upstream) return t("git.remote.no_upstream");
    if (remote.ahead === 0 && remote.behind === 0) return t("git.remote.up_to_date");
    const parts: string[] = [];
    if (remote.ahead > 0) parts.push(t("git.remote.ahead", { count: remote.ahead }));
    if (remote.behind > 0) parts.push(t("git.remote.behind", { count: remote.behind }));
    return parts.join(" · ");
  }

  function repoChecked(repo: GitRepoChanges): boolean {
    const committable = repo.changes.filter((change) => change.kind !== "conflicted");
    return committable.length > 0 && committable.every((change) => selected.has(keyFor(repo.repo, change.path)));
  }

  async function commitGroups(groups: CommitGroup[]) {
    const text = message.trim();
    if (groups.length === 0 || !text) return;
    committing = true;
    error = null;
    info = null;
    try {
      const results: string[] = [];
      for (const group of groups) {
        const result = await commitGitChanges({
          repo: group.repo,
          paths: group.paths,
          message: text,
        });
        results.push(result.short_sha);
      }
      info = results.length === 1
        ? t("git.commit.done", { sha: results[0] })
        : t("git.commit.done_multi", { count: results.length });
      message = "";
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      committing = false;
    }
  }

  async function commitSelected() {
    await commitGroups(selectedPathGroups());
  }

  async function commitRepoSelection(repoId: string) {
    const paths = pathsForRepo(repoId);
    if (paths.length === 0) return;
    await commitGroups([{ repo: repoId, paths }]);
  }

  async function discardGroups(groups: CommitGroup[]) {
    const count = groups.reduce((sum, group) => sum + group.paths.length, 0);
    if (count === 0) return;
    const ok = typeof window === "undefined" || window.confirm(t("git.discard.confirm", { count }));
    if (!ok) return;
    gitActionBusy = "discard";
    error = null;
    info = null;
    try {
      for (const group of groups) {
        await discardGitChanges({ repo: group.repo, paths: group.paths });
      }
      info = t("git.discard.done", { count });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      gitActionBusy = null;
    }
  }

  async function stashGroups(groups: CommitGroup[]) {
    const count = groups.reduce((sum, group) => sum + group.paths.length, 0);
    if (count === 0) return;
    gitActionBusy = "stash";
    error = null;
    info = null;
    try {
      const stashMessage = message.trim() || t("git.stash.default_message");
      for (const group of groups) {
        await stashGitChanges({ repo: group.repo, paths: group.paths, message: stashMessage });
      }
      info = t("git.stash.done", { count });
      message = "";
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      gitActionBusy = null;
    }
  }

  async function ignoreGroups(groups: CommitGroup[]) {
    const count = groups.reduce((sum, group) => sum + group.paths.length, 0);
    if (count === 0) return;
    gitActionBusy = "ignore";
    error = null;
    info = null;
    try {
      let patternsAdded = 0;
      for (const group of groups) {
        const result = await ignoreGitChanges({ repo: group.repo, paths: group.paths });
        patternsAdded += result.patterns_added;
      }
      info = t("git.ignore.done", { count, patterns: patternsAdded });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      gitActionBusy = null;
    }
  }

  async function discardSelected() {
    await discardGroups(selectedPathGroups());
  }

  async function stashSelected() {
    await stashGroups(selectedPathGroups());
  }

  async function ignoreSelected() {
    await ignoreGroups(selectedPathGroups());
  }

  async function editGitIgnore(repoId: string) {
    error = null;
    info = null;
    try {
      const result = await ensureGitIgnore(repoId);
      openPath(result.path);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function initializeGitRepository(repoId: string) {
    error = null;
    info = null;
    branchBusy = repoId;
    try {
      await initGitRepository(repoId);
      info = t("git.not_git.initialized");
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      branchBusy = null;
    }
  }

  async function syncRepo(repoId: string) {
    syncingRepo = repoId;
    error = null;
    info = null;
    try {
      const result = await syncGitRepo(repoId);
      info = t("git.sync.done", { actions: result.actions.length > 0 ? result.actions.join(", ") : t("git.sync.noop") });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      syncingRepo = null;
    }
  }

  async function checkoutBranch(repoId: string, branch: string) {
    const state = branchesFor(repoId);
    if (!branch || branch === state?.current_branch) return;
    branchBusy = repoId;
    error = null;
    info = null;
    try {
      const result = await checkoutGitBranch({ repo: repoId, branch });
      info = t("git.branch.checkout_done", { branch: result.state.current_branch ?? branch });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      branchBusy = null;
    }
  }

  async function createBranch(repoId: string) {
    const name = (newBranchByRepo[repoId] ?? "").trim();
    if (!name) return;
    branchBusy = repoId;
    error = null;
    info = null;
    try {
      const result = await checkoutGitBranch({ repo: repoId, branch: name, create: true });
      newBranchByRepo = { ...newBranchByRepo, [repoId]: "" };
      info = t("git.branch.create_done", { branch: result.state.current_branch ?? name });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      branchBusy = null;
    }
  }

  async function mergeBranch(repoId: string, sourceOverride?: string) {
    const state = branchesFor(repoId);
    if (!state) return;
    const source = sourceOverride ?? selectedMergeSource(state);
    if (!source) return;
    const preview = sourceOverride && state.current_branch
      ? mergePreviews[previewKey(repoId, state.current_branch, source)] ?? null
      : previewFor(state);
    if (!preview || "loading" in preview || "error" in preview) {
      await loadMergePreview(repoId, state.current_branch ?? "HEAD", source);
      return;
    }
    const ok = typeof window === "undefined" || window.confirm(t("git.branch.merge_confirm", {
      source,
      target: state.current_branch ?? "HEAD",
      commits: preview.commits.length,
      files: preview.files.length,
    }));
    if (!ok) return;
    const strategy = mergeStrategyByRepo[repoId] ?? "auto";
    branchBusy = repoId;
    error = null;
    info = null;
    try {
      const result = await mergeGitBranch({ repo: repoId, source, strategy });
      info = t("git.branch.merge_done", {
        source,
        target: result.state.current_branch ?? state.current_branch ?? "HEAD",
        sha: result.short_sha,
      });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      branchBusy = null;
    }
  }

  async function createPullRequestForBranch(repoId: string, source: string) {
    const state = branchesFor(repoId);
    if (!state) return;
    const target = state.current_branch ?? state.default_branch;
    if (!source || !target) return;
    pullRequestBusy = repoId;
    error = null;
    info = null;
    try {
      const result = await createGitPullRequest({
        repo: repoId,
        source,
        target,
        title: t("git.pr.default_title", { source, target }),
        body: t("git.pr.default_body"),
      });
      info = t("git.pr.created", { url: result.url });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      pullRequestBusy = null;
    }
  }

  function openPreviewFileDiff(preview: GitBranchPreview, file: GitCommitFileEntry) {
    onOpenDiff?.(preview.repo, file.path, null, preview.base, preview.source);
  }

  function worktreeBranchLabel(worktree: GitWorktreeEntry): string {
    if (worktree.branch) return worktree.branch;
    if (worktree.detached) return t("git.branch.detached");
    return t("git.worktree.no_branch");
  }

  function worktreeKey(repo: string, path: string): string {
    return `${repo}\0${path}`;
  }

  function toggleWorktreeRow(repo: string, worktree: GitWorktreeEntry) {
    const key = worktreeKey(repo, worktree.path);
    selectedWorktreeKey = selectedWorktreeKey === key ? null : key;
  }

  function handleWorktreeRowKeydown(e: KeyboardEvent, repo: string, worktree: GitWorktreeEntry) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggleWorktreeRow(repo, worktree);
  }

  function openWorktree(path: string) {
    if (typeof window !== "undefined" && window.backlog?.openPath) {
      void window.backlog.openPath(path).catch(() => undefined);
    } else {
      void navigator.clipboard?.writeText(path).catch(() => undefined);
      info = t("git.worktree.path_copied");
    }
  }

  async function addWorktree(repoId: string) {
    const path = (newWorktreePathByRepo[repoId] ?? "").trim();
    if (!path) return;
    worktreeBusy = repoId;
    error = null;
    info = null;
    try {
      await addGitWorktree({
        repo: repoId,
        path,
        branch: newWorktreeBranchByRepo[repoId] || undefined,
      });
      newWorktreePathByRepo = { ...newWorktreePathByRepo, [repoId]: "" };
      info = t("git.worktree.add_done");
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      worktreeBusy = null;
    }
  }

  async function removeWorktree(repoId: string, worktree: GitWorktreeEntry, force = false) {
    const ok = typeof window === "undefined" || window.confirm(t(force ? "git.worktree.force_remove_confirm" : "git.worktree.remove_confirm", { path: worktree.path }));
    if (!ok) return;
    worktreeBusy = repoId;
    error = null;
    info = null;
    try {
      await removeGitWorktree({ repo: repoId, path: worktree.path, force });
      info = t("git.worktree.remove_done");
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      worktreeBusy = null;
    }
  }

  async function pruneWorktrees(repoId: string) {
    worktreeBusy = repoId;
    error = null;
    info = null;
    try {
      await pruneGitWorktrees(repoId);
      info = t("git.worktree.prune_done");
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      worktreeBusy = null;
    }
  }

  async function handleRelocateRepo(repo: { repo: string; path: string }) {
    error = null;
    info = null;
    try {
      const relocated = await relocateRepositoryPath(repo.repo, repo.path);
      if (!relocated) return;
      info = t("repos_view.relocate_done", { repository: repo.repo });
      await load();
      onCommitted?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function handleMessageKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (canCommit) void commitSelected();
  }

  function commitKey(commit: CommitEntry): string {
    return `${commit.repo}\0${commit.sha}`;
  }

  async function selectCommit(commit: CommitEntry) {
    const key = commitKey(commit);
    selectedCommitKey = key;
    commitFiles = [];
    commitFilesError = null;
    commitFilesLoading = true;
    try {
      const result = await fetchGitCommitFiles(commit.repo, commit.sha);
      if (selectedCommitKey === key) commitFiles = result.files;
    } catch (err) {
      if (selectedCommitKey === key) commitFilesError = err instanceof Error ? err.message : String(err);
    } finally {
      if (selectedCommitKey === key) commitFilesLoading = false;
    }
  }

  function handleCommitKeydown(e: KeyboardEvent, commit: CommitEntry) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void selectCommit(commit);
  }

  function openCommitFileDiff(commit: CommitEntry, file: GitCommitFileEntry) {
    onOpenDiff?.(commit.repo, file.path, commit.sha);
  }

  function linkLabel(link: CommitLink): string {
    if (link.kind === "task") return t("commits.task", { id: link.id });
    if (link.kind === "subtask") return t("commits.subtask", { id: link.id });
    return t("commits.claim", { id: link.id });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  async function loadMoreHistory() {
    if (historyLoadingMore || !historyHasMore) return;
    historyLoadingMore = true;
    try {
      const page = await fetchCommits(HISTORY_PAGE_SIZE + 1, selectedRepoId, commits.length);
      const next = page.slice(0, HISTORY_PAGE_SIZE);
      const seen = new Set(commits.map(commitKey));
      commits = [...commits, ...next.filter((commit) => !seen.has(commitKey(commit)))];
      historyHasMore = page.length > HISTORY_PAGE_SIZE;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      historyLoadingMore = false;
    }
  }

  function handleHistoryScroll(e: Event) {
    const node = e.currentTarget as HTMLElement;
    if (node.scrollTop + node.clientHeight < node.scrollHeight - 260) return;
    void loadMoreHistory();
  }

  $effect(() => {
    selectedRepoId;
    void load();
  });

  $effect(() => {
    if (activeTab !== "branches" || !selectedBranchKey) return;
    for (const state of branches) {
      if (state.error || !state.current_branch) continue;
      const row = branchRows(state).find((candidate) => candidate.key === selectedBranchKey);
      if (row && !row.current) void loadMergePreview(state.repo, state.current_branch, row.name);
    }
  });

  function refreshVisibleGit() {
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    focusRefreshTimer = setTimeout(() => {
      focusRefreshTimer = null;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void load({ preserveSelection: true });
    }, 100);
  }

  function handleWindowFocus() {
    refreshVisibleGit();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") refreshVisibleGit();
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") closeContextMenu();
  }

  onMount(() => {
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onDestroy(() => {
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    window.removeEventListener("focus", handleWindowFocus);
    window.removeEventListener("click", closeContextMenu);
    window.removeEventListener("keydown", handleGlobalKeydown);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });
</script>

{#snippet body()}
  <header>
    <div class="title-block">
      <h2>{t("git.title")}</h2>
      <div class="tabs" role="tablist">
        <div
          class="tab"
          class:active={activeTab === "changes"}
          role="tab"
          aria-selected={activeTab === "changes"}
          tabindex="0"
          onfocus={() => setActiveTab("changes")}
          onmousedown={() => setActiveTab("changes")}
          onclick={() => setActiveTab("changes")}
          onkeydown={(e) => handleTabKeydown(e, "changes")}
        >
          <span>{t("git.tab.changes")}</span>
          {#if dirtyCount > 0}<span class="badge">{dirtyCount}</span>{/if}
        </div>
        <div
          class="tab"
          class:active={activeTab === "history"}
          role="tab"
          aria-selected={activeTab === "history"}
          tabindex="0"
          onfocus={() => setActiveTab("history")}
          onmousedown={() => setActiveTab("history")}
          onclick={() => setActiveTab("history")}
          onkeydown={(e) => handleTabKeydown(e, "history")}
        >
          <span>{t("git.tab.history")}</span>
          {#if commits.length > 0}<span class="badge muted">{commits.length}</span>{/if}
        </div>
        <div
          class="tab"
          class:active={activeTab === "branches"}
          role="tab"
          aria-selected={activeTab === "branches"}
          tabindex="0"
          onfocus={() => setActiveTab("branches")}
          onmousedown={() => setActiveTab("branches")}
          onclick={() => setActiveTab("branches")}
          onkeydown={(e) => handleTabKeydown(e, "branches")}
        >
          <span>{t("git.tab.branches")}</span>
          {#if branches.length > 0}<span class="badge muted">{branches.length}</span>{/if}
        </div>
        <div
          class="tab"
          class:active={activeTab === "worktrees"}
          role="tab"
          aria-selected={activeTab === "worktrees"}
          tabindex="0"
          onfocus={() => setActiveTab("worktrees")}
          onmousedown={() => setActiveTab("worktrees")}
          onclick={() => setActiveTab("worktrees")}
          onkeydown={(e) => handleTabKeydown(e, "worktrees")}
        >
          <span>{t("git.tab.worktrees")}</span>
          {#if worktrees.length > 0}<span class="badge muted">{worktrees.reduce((sum, repo) => sum + repo.worktrees.length, 0)}</span>{/if}
        </div>
      </div>
    </div>
    <div class="header-actions">
      <button class="refresh" onclick={() => load()} title="↻">↻</button>
      {#if !embedded}
        <button class="close" onclick={onClose}>✕</button>
      {/if}
    </div>
  </header>

  {#if error}<div class="error">{error}</div>{/if}
  {#if info}<div class="info">{info}</div>{/if}

  {#if !loading && activeTab === "branches" && branches.length > 0}
    <div class="branch-list-view" aria-label={t("git.branch.section")}>
      {#each branches as state (state.repo)}
        {@const remote = remoteFor(state.repo)}
        {@const localCheckout = hasLocalCheckout(state)}
        <section class="git-repo-list">
          <div class="git-repo-head" role="group" oncontextmenu={(e) => showRepositoryContextMenu(e, state.repo)}>
            <div class="git-repo-title">
              <strong>{state.repo}</strong>
              <span>{state.current_branch ?? t("git.branch.detached")} · {remoteText(remote)}</span>
            </div>
            <div class="git-repo-actions">
              <label class="inline-create">
                <input
                  value={newBranchByRepo[state.repo] ?? ""}
                  placeholder={t("git.branch.new_placeholder")}
                  disabled={branchBusy !== null}
                  oninput={(e) => setNewBranch(state.repo, e.currentTarget.value)}
                  onkeydown={(e) => { if (e.key === "Enter") void createBranch(state.repo); }}
                  aria-label={t("git.branch.new")}
                />
                <button
                  type="button"
                  class="secondary"
                  onclick={() => createBranch(state.repo)}
                  disabled={branchBusy !== null || !(newBranchByRepo[state.repo] ?? "").trim()}
                >
                  {t("git.branch.create")}
                </button>
              </label>
              {#if localCheckout}
                <button
                  type="button"
                  class="sync"
                  onclick={() => syncRepo(state.repo)}
                  disabled={syncingRepo !== null || branchBusy !== null || !remote?.remote_url}
                  title={remote?.remote_url ?? ""}
                >
                  {syncingRepo === state.repo ? t("git.sync.running") : t("git.sync.button")}
                </button>
              {:else}
                <span class="remote-note">{t("git.branch.remote_actions")}</span>
              {/if}
            </div>
          </div>
          {#if state.error}
            <div class="repo-error">
              {#if isMissingRepositoryPathError(state.error)}
                <strong>{t("repos_view.missing_title", { repository: state.repo })}</strong>
                <span>{t("repos_view.missing_body", { path: state.path })}</span>
                <button type="button" onclick={() => handleRelocateRepo(state)}>
                  {t("repos_view.relocate")}
                </button>
              {:else if isNotGitRepositoryError(state.error)}
                <strong>{t("git.not_git.title")}</strong>
                <span>{t("git.not_git.body")}</span>
                <button type="button" onclick={() => initializeGitRepository(state.repo)} disabled={branchBusy !== null || !state.path}>
                  {branchBusy === state.repo ? t("git.not_git.initializing") : t("git.not_git.button")}
                </button>
              {:else}
                {state.error}
              {/if}
            </div>
          {:else}
            <div class="git-row-list">
              {#each branchRows(state) as row (row.key)}
                {@const isOpen = selectedBranchKey === row.key}
                {@const preview = branchPreviewForRow(state, row)}
                <div
                  class="git-line branch-line"
                  class:active={row.current}
                  class:open={isOpen}
                  role="button"
                  tabindex="0"
                  onclick={() => toggleBranchRow(state, row)}
                  onkeydown={(e) => handleBranchRowKeydown(e, state, row)}
                  title={row.name}
                >
                  <span class="branch-marker" aria-hidden="true">{row.current ? "●" : "○"}</span>
                  <span class="branch-name">{row.label}</span>
                  <span class="line-meta">{branchMeta(row)}</span>
                  {#if row.current}<span class="line-badge">{t("git.branch.current_badge")}</span>{/if}
                  <span class="line-chevron">{isOpen ? "⌃" : "⌄"}</span>
                </div>
                {#if isOpen}
                  <div class="git-line-detail">
                    {#if localCheckout}
                      <div class="branch-detail-actions">
                        <button
                          type="button"
                          class="secondary"
                          onclick={() => checkoutBranch(state.repo, row.name)}
                          disabled={branchBusy !== null || row.current}
                        >
                          {t("git.branch.checkout_action")}
                        </button>
                        <label class="branch-field strategy compact">
                          <span>{t("git.branch.strategy")}</span>
                          <select
                            value={mergeStrategyByRepo[state.repo] ?? "auto"}
                            disabled={branchBusy !== null || row.current || !state.current_branch}
                            onchange={(e) => setMergeStrategy(state.repo, e.currentTarget.value as "auto" | "ff_only" | "no_ff")}
                          >
                            <option value="auto">{t("git.branch.strategy_auto")}</option>
                            <option value="ff_only">{t("git.branch.strategy_ff")}</option>
                            <option value="no_ff">{t("git.branch.strategy_noff")}</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          class="secondary"
                          onclick={() => mergeBranch(state.repo, row.name)}
                          disabled={branchBusy !== null || row.current || !state.current_branch || preview === null || Boolean(preview && "loading" in preview)}
                        >
                          {branchBusy === state.repo
                            ? t("git.branch.running")
                            : t("git.branch.merge_into_current", { target: state.current_branch ?? "HEAD" })}
                        </button>
                        <button
                          type="button"
                          class="secondary"
                          onclick={() => createPullRequestForBranch(state.repo, row.name)}
                          disabled={pullRequestBusy !== null || row.current || !state.current_branch || preview === null || Boolean(preview && "loading" in preview)}
                        >
                          {pullRequestBusy === state.repo ? t("git.pr.running") : t("git.pr.create")}
                        </button>
                      </div>
                    {:else if !row.current}
                      <div class="branch-detail-actions">
                        <button
                          type="button"
                          class="secondary"
                          onclick={() => createPullRequestForBranch(state.repo, row.name)}
                          disabled={pullRequestBusy !== null || !state.current_branch || preview === null || Boolean(preview && "loading" in preview)}
                        >
                          {pullRequestBusy === state.repo ? t("git.pr.running") : t("git.pr.create")}
                        </button>
                        <button
                          type="button"
                          class="secondary"
                          onclick={() => mergeBranch(state.repo, row.name)}
                          disabled={branchBusy !== null || !state.current_branch || preview === null || Boolean(preview && "loading" in preview)}
                        >
                          {branchBusy === state.repo
                            ? t("git.branch.running")
                            : t("git.branch.merge_into_current", { target: state.current_branch ?? "HEAD" })}
                        </button>
                        <span class="remote-note">{t("git.branch.remote_merge_hint")}</span>
                      </div>
                    {/if}
                    {#if row.current}
                      <div class="preview-state">{t("git.branch.current_hint")}</div>
                    {:else if preview}
                      <div class="branch-preview inline">
                        {#if "loading" in preview}
                          <div class="preview-state">{t("git.branch.preview_loading")}</div>
                        {:else if "error" in preview}
                          <div class="preview-state error-text">{preview.error}</div>
                        {:else}
                          <div class="preview-head">
                            <span>{t("git.branch.preview_summary", { commits: preview.commits.length, files: preview.files.length })}</span>
                            <code>{preview.target}...{preview.source}</code>
                          </div>
                          {#if preview.commits.length > 0}
                            <div class="preview-commits">
                              {#each preview.commits.slice(0, 5) as commit (commit.sha)}
                                <div class="preview-commit">
                                  <code>{commit.short_sha}</code>
                                  <span>{commit.subject}</span>
                                </div>
                              {/each}
                              {#if preview.commits.length > 5}
                                <div class="preview-more">{t("git.branch.preview_more_commits", { count: preview.commits.length - 5 })}</div>
                              {/if}
                            </div>
                          {/if}
                          {#if preview.files.length === 0}
                            <div class="preview-state">{t("git.branch.preview_empty")}</div>
                          {:else}
                            <div class="preview-files">
                              {#each preview.files as file (file.path)}
                                {@const displayPath = splitPath(file.path)}
                                {@const oldDisplayPath = file.old_path ? splitPath(file.old_path) : null}
                                <button
                                  type="button"
                                  class="preview-file-row"
                                  onclick={() => openPreviewFileDiff(preview, file)}
                                  oncontextmenu={(e) => showFileContextMenu(e, preview.repo, file.path)}
                                  title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}
                                >
                                  <span class="kind kind-{file.kind}">{kindLabel(file.kind)}</span>
                                  <span class="path">
                                    {#if oldDisplayPath}
                                      <span class="dir">{oldDisplayPath.dir}</span><span class="file-name old-name">{oldDisplayPath.name}</span>
                                      <span class="arrow">→</span>
                                    {/if}
                                    <span class="dir">{displayPath.dir}</span><span class="file-name">{displayPath.name}</span>
                                  </span>
                                </button>
                              {/each}
                            </div>
                          {/if}
                        {/if}
                      </div>
                    {:else}
                      <div class="preview-state">{t("git.branch.preview_loading")}</div>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="loading">…</div>
  {:else if activeTab === "changes"}
    <div class="changes-layout">
      <div class="changes-toolbar">
        <span>{t("git.changes.summary", { count: dirtyCount })}</span>
        {#if selectedPaths.length > 0}
          <span>{t("git.changes.selected", { count: selectedPaths.length, repositories: selectedRepoCount })}</span>
        {/if}
      </div>
      <div class="changes-list">
        {#if visibleRepos.length === 0}
          <div class="empty">{t("git.changes.empty")}</div>
        {:else}
          {#each visibleRepos as repo (repo.repo)}
            <section class="repo-block">
              <div class="repo-row" role="group" oncontextmenu={(e) => showRepositoryContextMenu(e, repo.repo)}>
                <label class="repo-check">
                  <input
                    type="checkbox"
                    checked={repoChecked(repo)}
                    disabled={repo.changes.length === 0}
                    onchange={(e) => toggleRepo(repo, e.currentTarget.checked)}
                  />
                  <span class="repo-name">{repo.repo}</span>
                </label>
                <span class="repo-count">{repo.changes.length}</span>
                <button
                  type="button"
                  class="repo-commit"
                  onclick={() => commitRepoSelection(repo.repo)}
                  disabled={pathsForRepo(repo.repo).length === 0 || !message.trim() || committing}
                >
                  {t("git.commit.button_files", { count: pathsForRepo(repo.repo).length })}
                </button>
              </div>
              {#if repo.status.error}
                <div class="repo-error">
                  {#if isMissingRepositoryPathError(repo.status.error)}
                    <strong>{t("repos_view.missing_title", { repository: repo.repo })}</strong>
                    <span>{t("repos_view.missing_body", { path: repo.path })}</span>
                    <button type="button" onclick={() => handleRelocateRepo(repo)}>
                      {t("repos_view.relocate")}
                    </button>
                  {:else if isNotGitRepositoryError(repo.status.error)}
                    <strong>{t("git.not_git.title")}</strong>
                    <span>{t("git.not_git.body")}</span>
                    <button type="button" onclick={() => initializeGitRepository(repo.repo)} disabled={branchBusy !== null || !repo.path}>
                      {branchBusy === repo.repo ? t("git.not_git.initializing") : t("git.not_git.button")}
                    </button>
                  {:else}
                    {repo.status.error}
                  {/if}
                </div>
              {/if}
              {#each repo.changes as change (change.path)}
                {@const displayPath = splitPath(change.path)}
                {@const oldDisplayPath = change.old_path ? splitPath(change.old_path) : null}
                {@const isSelected = changeSelected(repo.repo, change)}
                <div
                  class="change-row"
                  class:conflicted={change.kind === "conflicted"}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-disabled={change.kind === "conflicted"}
                  tabindex={change.kind === "conflicted" ? -1 : 0}
                  title={change.old_path ? `${change.old_path} → ${change.path}` : change.path}
                  onclick={() => toggleChangeRow(repo.repo, change)}
                  oncontextmenu={(e) => showFileContextMenu(e, repo.repo, change.path)}
                  onkeydown={(e) => handleChangeRowKeydown(e, repo.repo, change)}
                >
                  <span class="check-box" class:checked={isSelected} aria-hidden="true"></span>
                  <span class="kind kind-{change.kind}" title={kindLabel(change.kind)}>{changeStatusLabel(change)}</span>
                  <span class="path">
                    {#if oldDisplayPath}
                      <span class="dir">{oldDisplayPath.dir}</span><span class="file-name old-name">{oldDisplayPath.name}</span>
                      <span class="arrow">→</span>
                    {/if}
                    <span class="dir">{displayPath.dir}</span><span class="file-name">{displayPath.name}</span>
                  </span>
                </div>
              {/each}
            </section>
          {/each}
        {/if}
      </div>
      <aside class="commit-box">
        <textarea
          bind:this={messageEl}
          bind:value={message}
          use:focusOnMount
          rows="5"
          placeholder={t("git.commit.placeholder")}
          onkeydown={handleMessageKeydown}
        ></textarea>
        <div class="commit-actions">
          <button class="secondary danger" onclick={discardSelected} disabled={!canChangeSelected}>
            {gitActionBusy === "discard" ? t("git.discard.running") : t("git.discard.button_files", { count: selectedPaths.length })}
          </button>
          <button class="secondary" onclick={stashSelected} disabled={!canChangeSelected}>
            {gitActionBusy === "stash" ? t("git.stash.running") : t("git.stash.button_files", { count: selectedPaths.length })}
          </button>
          <button class="secondary" onclick={ignoreSelected} disabled={!canChangeSelected}>
            {gitActionBusy === "ignore" ? t("git.ignore.running") : t("git.ignore.button_files", { count: selectedPaths.length })}
          </button>
          <button class="primary" onclick={commitSelected} disabled={!canCommit}>
            {committing ? t("git.commit.running") : t("git.commit.button_files", { count: selectedPaths.length })}
          </button>
        </div>
        {#if selectedRepoCount > 1}
          <p class="hint">{t("git.commit.multi_repo_hint", { count: selectedRepoCount })}</p>
        {:else}
          <p class="hint">{t("git.commit.enter_hint")}</p>
        {/if}
      </aside>
    </div>
  {:else if activeTab === "branches" && branches.length === 0}
    <div class="empty">{t("git.branch.empty")}</div>
  {:else if activeTab === "worktrees"}
    <div class="worktrees-view">
      {#if worktrees.length === 0}
        <div class="empty">{t("git.worktree.empty")}</div>
      {:else}
        {#each worktrees as repo (repo.repo)}
          {@const branchState = branchesFor(repo.repo)}
          {@const hasCheckout = Boolean(repo.path)}
          <section class="git-repo-list">
            <div class="git-repo-head" role="group" oncontextmenu={(e) => showRepositoryContextMenu(e, repo.repo)}>
              <div class="git-repo-title">
                <strong>{repo.repo}</strong>
                <span>{hasCheckout ? repo.path : t("git.worktree.no_checkout")}</span>
              </div>
              {#if hasCheckout}
                <button type="button" class="secondary" onclick={() => pruneWorktrees(repo.repo)} disabled={worktreeBusy !== null}>
                  {t("git.worktree.prune")}
                </button>
              {/if}
            </div>
            {#if repo.error}
              <div class="repo-error">
                {#if isMissingRepositoryPathError(repo.error)}
                  <strong>{t("repos_view.missing_title", { repository: repo.repo })}</strong>
                  <span>{t("repos_view.missing_body", { path: repo.path })}</span>
                  <button type="button" onclick={() => handleRelocateRepo(repo)}>
                    {t("repos_view.relocate")}
                  </button>
                {:else if isNotGitRepositoryError(repo.error)}
                  <strong>{t("git.not_git.title")}</strong>
                  <span>{t("git.not_git.body")}</span>
                  <button type="button" onclick={() => initializeGitRepository(repo.repo)} disabled={branchBusy !== null || !repo.path}>
                    {branchBusy === repo.repo ? t("git.not_git.initializing") : t("git.not_git.button")}
                  </button>
                {:else}
                  {worktreeErrorText(repo.error)}
                {/if}
              </div>
            {:else}
              <div class="worktree-add">
                <label class="branch-field">
                  <span>{t("git.worktree.new_path")}</span>
                  <input
                    value={newWorktreePathByRepo[repo.repo] ?? ""}
                    placeholder={t("git.worktree.new_path_placeholder")}
                    oninput={(e) => setNewWorktreePath(repo.repo, e.currentTarget.value)}
                    onkeydown={(e) => { if (e.key === "Enter") void addWorktree(repo.repo); }}
                  />
                </label>
                <label class="branch-field">
                  <span>{t("git.worktree.branch")}</span>
                  <select
                    value={newWorktreeBranchByRepo[repo.repo] ?? ""}
                    onchange={(e) => setNewWorktreeBranch(repo.repo, e.currentTarget.value)}
                  >
                    <option value="">{t("git.worktree.branch_head")}</option>
                    {#if branchState}
                      {#each branchOptions(branchState) as branch (branch)}
                        <option value={branch}>{branch}</option>
                      {/each}
                    {/if}
                  </select>
                </label>
                <button
                  type="button"
                  class="secondary"
                  onclick={() => addWorktree(repo.repo)}
                  disabled={worktreeBusy !== null || !(newWorktreePathByRepo[repo.repo] ?? "").trim()}
                >
                  {worktreeBusy === repo.repo ? t("git.branch.running") : t("git.worktree.add")}
                </button>
              </div>
              <div class="git-row-list">
                {#each repo.worktrees as worktree (worktree.path)}
                  {@const rowKey = worktreeKey(repo.repo, worktree.path)}
                  {@const isOpen = selectedWorktreeKey === rowKey}
                  <div
                    class="git-line worktree-line"
                    class:active={worktree.main}
                    class:open={isOpen}
                    role="button"
                    tabindex="0"
                    onclick={() => toggleWorktreeRow(repo.repo, worktree)}
                    oncontextmenu={(e) => showContextMenu(e, [
                      { label: t("context.open_editor"), action: () => openEditor(worktree.path) },
                      { label: t("context.reveal_finder"), action: () => revealPath(worktree.path) },
                    ])}
                    onkeydown={(e) => handleWorktreeRowKeydown(e, repo.repo, worktree)}
                    title={worktree.path}
                  >
                    <span class="branch-marker" aria-hidden="true">{worktree.main ? "●" : "○"}</span>
                    <span class="branch-name">{worktreeBranchLabel(worktree)}</span>
                    {#if worktree.main}<span class="line-badge">{t("git.worktree.main")}</span>{/if}
                    {#if worktree.prunable}<span class="line-badge warn">{t("git.worktree.prunable")}</span>{/if}
                    <code>{worktree.head ? worktree.head.slice(0, 7) : "-------"}</code>
                    <span class="line-path">{worktree.path}</span>
                    <span class="line-chevron">{isOpen ? "⌃" : "⌄"}</span>
                  </div>
                  {#if isOpen}
                    <div class="git-line-detail">
                      <div class="worktree-detail">
                        <span>{worktree.path}</span>
                        {#if worktree.prunable_reason}<small>{worktree.prunable_reason}</small>{/if}
                      </div>
                      <div class="worktree-actions">
                      <button type="button" class="secondary" onclick={() => openWorktree(worktree.path)}>
                        {t("git.worktree.open")}
                      </button>
                      <button
                        type="button"
                        class="secondary danger"
                        onclick={() => removeWorktree(repo.repo, worktree)}
                        disabled={worktree.main || worktreeBusy !== null}
                      >
                        {t("git.worktree.remove")}
                      </button>
                      {#if worktree.prunable}
                        <button
                          type="button"
                          class="secondary danger"
                          onclick={() => removeWorktree(repo.repo, worktree, true)}
                          disabled={worktree.main || worktreeBusy !== null}
                        >
                          {t("git.worktree.force_remove")}
                        </button>
                      {/if}
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </section>
        {/each}
      {/if}
    </div>
  {:else if activeTab === "history" && commits.length === 0}
    <div class="empty">{t("commits.empty")}</div>
  {:else if activeTab === "history"}
    <ul class="commits" onscroll={handleHistoryScroll}>
      {#each commits as commit (commit.repo + ":" + commit.sha)}
        {@const isActiveCommit = selectedCommitKey === commitKey(commit)}
        <li>
          <div
            class="commit-row"
            class:active={isActiveCommit}
            role="button"
            tabindex="0"
            onclick={() => selectCommit(commit)}
            onkeydown={(e) => handleCommitKeydown(e, commit)}
          >
            <div class="row1">
              <span class="repo">{commit.repo}</span>
              <code class="sha">{commit.short_sha}</code>
              <span class="subject">{commit.subject}</span>
            </div>
            <div class="row2">
              <span class="author">{commit.author}</span>
              <span class="dot">·</span>
              <span class="date">{formatDate(commit.date)}</span>
              {#if commit.links.length > 0}
                <span class="dot">·</span>
                <span class="linked-label">{t("commits.linked")}</span>
                {#each commit.links as link (link.kind + ":" + link.id)}
                  <span class="link link-{link.kind}">{linkLabel(link)}</span>
                {/each}
              {/if}
            </div>
          </div>
          {#if isActiveCommit}
            <div class="commit-files">
              {#if commitFilesLoading}
                <div class="commit-files-state">{t("commits.files_loading")}</div>
              {:else if commitFilesError}
                <div class="commit-files-state error-text">{commitFilesError}</div>
              {:else if commitFiles.length === 0}
                <div class="commit-files-state">{t("commits.files_empty")}</div>
              {:else}
                <div class="commit-files-head">{t("commits.files_changed", { count: commitFiles.length })}</div>
                {#each commitFiles as file (file.path)}
                  {@const displayPath = splitPath(file.path)}
                  {@const oldDisplayPath = file.old_path ? splitPath(file.old_path) : null}
                  <button
                    type="button"
                    class="commit-file-row"
                    onclick={() => openCommitFileDiff(commit, file)}
                    oncontextmenu={(e) => showFileContextMenu(e, commit.repo, file.path)}
                    title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}
                  >
                    <span class="kind kind-{file.kind}">{kindLabel(file.kind)}</span>
                    <span class="path">
                      {#if oldDisplayPath}
                        <span class="dir">{oldDisplayPath.dir}</span><span class="file-name old-name">{oldDisplayPath.name}</span>
                        <span class="arrow">→</span>
                      {/if}
                      <span class="dir">{displayPath.dir}</span><span class="file-name">{displayPath.name}</span>
                    </span>
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </li>
      {/each}
      <li class="history-sentinel">
        {#if historyLoadingMore}
          <span>{t("git.history.loading_more")}</span>
        {:else if historyHasMore}
          <button type="button" class="secondary" onclick={loadMoreHistory}>{t("git.history.load_more")}</button>
        {:else}
          <span>{t("git.history.end")}</span>
        {/if}
      </li>
    </ul>
  {/if}
{/snippet}

{#if contextMenu}
  <div
    class="context-menu"
    style:left={`${contextMenu.x}px`}
    style:top={`${contextMenu.y}px`}
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each contextMenu.items as item}
      <button
        type="button"
        role="menuitem"
        class:danger={item.danger}
        disabled={item.disabled}
        onclick={() => { closeContextMenu(); item.action(); }}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
      {@render body()}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 860px;
    width: 92%;
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-block { display: flex; align-items: center; gap: 14px; min-width: 0; }
  h2 { margin: 0; font-size: 16px; color: var(--text-primary); }
  .tabs { display: flex; gap: 4px; }
  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .tab.active { background: var(--accent-bg); color: var(--accent-text); border-color: var(--border-subtle); }
  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--warning-bg);
    color: var(--warning);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
  }
  .badge.muted { background: var(--bg-hover); color: var(--text-muted); }
  .header-actions { display: flex; gap: 4px; }
  .refresh, .close {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .close { border: none; font-size: 18px; }
  .refresh:hover { background: var(--bg-hover); color: var(--text-primary); }
  .error, .info { padding: 8px 18px; font-size: 12px; }
  .error { background: var(--warning-bg); color: var(--warning); }
  .info { background: var(--success-bg); color: var(--success); }
  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 210px;
    padding: 4px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
  }
  .context-menu button {
    width: 100%;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    padding: 7px 9px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .context-menu button:hover:not(:disabled),
  .context-menu button:focus-visible {
    background: var(--bg-hover);
  }
  .context-menu button:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  .context-menu button.danger {
    color: var(--danger);
  }
  .loading, .empty {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .changes-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .changes-list, .commits {
    overflow-y: auto;
    min-height: 0;
  }
  .branch-list-view,
  .worktrees-view {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg-muted);
  }
  .git-repo-list {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-surface);
    overflow: hidden;
  }
  .git-repo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-muted);
  }
  .git-repo-title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .git-repo-title strong {
    color: var(--text-primary);
    font-size: 12px;
  }
  .git-repo-title span {
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .git-repo-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .remote-note {
    max-width: 260px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.3;
    text-align: right;
  }
  .inline-create {
    display: grid;
    grid-template-columns: minmax(170px, 240px) auto;
    gap: 6px;
    align-items: center;
  }
  .inline-create input {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    padding: 5px 7px;
    font: inherit;
    font-size: 12px;
  }
  .branch-field {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .branch-field select,
  .branch-field input {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    padding: 5px 7px;
    font: inherit;
    font-size: 12px;
  }
  .branch-field.compact {
    flex: 0 0 150px;
  }
  .git-row-list {
    display: flex;
    flex-direction: column;
  }
  .git-line {
    min-height: 36px;
    display: grid;
    grid-template-columns: 18px minmax(120px, 1fr) minmax(160px, 1.2fr) auto 18px;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    user-select: none;
  }
  .worktree-line {
    grid-template-columns: 18px minmax(120px, 0.7fr) auto auto minmax(180px, 1.3fr) 18px;
  }
  .git-line:hover,
  .git-line.open {
    background: var(--bg-hover);
  }
  .git-line:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .git-line.active .branch-name {
    color: var(--accent-text);
  }
  .branch-marker {
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
  }
  .git-line.active .branch-marker {
    color: var(--accent);
  }
  .branch-name {
    min-width: 0;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-meta,
  .line-path {
    min-width: 0;
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .line-badge {
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 1px 6px;
    font-size: 10px;
  }
  .line-badge.warn {
    color: var(--warning);
    background: var(--warning-bg);
  }
  .line-chevron {
    color: var(--text-muted);
    text-align: right;
    font-size: 12px;
  }
  .git-line-detail {
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-muted);
    padding: 10px 12px 10px 36px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .branch-detail-actions {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }
  .branch-preview.inline {
    border-top: 0;
    padding-top: 0;
  }
  .branch-preview {
    border-top: 1px solid var(--border-subtle);
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .preview-head code,
  .preview-commit code,
  .worktree-line code {
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .preview-commits {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .preview-commit {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    color: var(--text-body);
  }
  .preview-commit span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview-more,
  .preview-state {
    color: var(--text-muted);
    font-size: 11px;
  }
  .preview-state.error-text {
    color: var(--danger);
  }
  .preview-files {
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
  }
  .preview-file-row {
    width: 100%;
    min-height: 28px;
    border: 0;
    border-bottom: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-body);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .preview-file-row:last-child {
    border-bottom: 0;
  }
  .preview-file-row:hover,
  .preview-file-row:focus-visible {
    background: var(--bg-hover);
  }
  .secondary {
    flex: 0 0 auto;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .secondary:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .secondary.danger {
    color: var(--danger);
  }
  .sync {
    flex: 0 0 auto;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .sync:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .sync:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 980px) {
    .git-repo-head,
    .git-repo-actions,
    .branch-detail-actions {
      align-items: stretch;
      flex-direction: column;
    }
    .inline-create {
      grid-template-columns: 1fr;
    }
    .git-line,
    .worktree-line {
      grid-template-columns: 18px minmax(0, 1fr) 18px;
      grid-auto-rows: auto;
      padding: 8px 10px;
    }
    .git-line .line-meta,
    .git-line .line-path,
    .git-line code,
    .git-line .line-badge {
      grid-column: 2;
    }
    .line-chevron {
      grid-column: 3;
      grid-row: 1;
    }
  }
  .changes-list {
    flex: 1 1 auto;
  }
  .changes-toolbar {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 0 18px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .worktree-add {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.7fr) auto;
    gap: 8px;
    align-items: end;
    padding: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .worktree-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .worktree-detail {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .worktree-detail span,
  .worktree-detail small {
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 980px) {
    .worktree-add {
      grid-template-columns: 1fr;
    }
    .worktree-actions {
      justify-content: flex-start;
    }
  }
  .repo-block { border-bottom: 1px solid var(--border-subtle); }
  .repo-row, .change-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 18px;
    font-size: 13px;
  }
  .repo-row { background: var(--bg-muted); color: var(--text-primary); font-weight: 600; }
  .repo-check {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .repo-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .repo-count {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-hover);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .repo-commit {
    flex: 0 0 auto;
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 8px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .repo-commit:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .repo-commit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .repo-error {
    color: var(--warning);
    padding: 8px 18px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .repo-error span {
    color: var(--text-muted);
  }
  .repo-error button {
    border: 1px solid var(--border-strong);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 3px 8px;
    font: inherit;
    cursor: pointer;
  }
  .repo-error button:hover {
    border-color: var(--accent);
  }
  .change-row {
    cursor: pointer;
    user-select: none;
  }
  .change-row:hover { background: var(--bg-hover); }
  .change-row:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .change-row.conflicted {
    color: var(--warning);
    cursor: not-allowed;
  }
  input[type="checkbox"] { flex: 0 0 auto; }
  .check-box {
    width: 13px;
    height: 13px;
    flex: 0 0 13px;
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    background: var(--bg-input);
    position: relative;
  }
  .check-box.checked {
    background: var(--accent);
    border-color: var(--accent);
  }
  .check-box.checked::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 1px;
    width: 4px;
    height: 7px;
    border: solid var(--accent-on);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  .kind {
    flex: 0 0 20px;
    text-align: center;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
  }
  .kind-added, .kind-untracked { color: var(--success); }
  .kind-modified, .kind-renamed { color: var(--warning); }
  .kind-deleted, .kind-conflicted { color: var(--danger); }
  .path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-body);
  }
  .dir {
    color: var(--text-muted);
  }
  .file-name {
    color: var(--text-primary);
    font-weight: 500;
  }
  .old-name {
    color: var(--text-muted);
    font-weight: 400;
  }
  .arrow {
    color: var(--text-muted);
    margin: 0 4px;
  }
  .commit-box {
    flex: 0 0 auto;
    border-top: 1px solid var(--border-default);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-muted);
  }
  textarea {
    width: 100%;
    min-height: 92px;
    resize: vertical;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 8px;
    font: inherit;
    font-size: 13px;
  }
  .primary {
    border: none;
    border-radius: 4px;
    background: var(--accent);
    color: var(--accent-on);
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .commit-actions {
    display: grid;
    grid-template-columns: auto auto minmax(160px, 1fr);
    gap: 8px;
    align-items: center;
  }
  .commit-actions .primary {
    min-width: 0;
  }
  @media (max-width: 760px) {
    .commit-actions {
      grid-template-columns: 1fr;
    }
  }
  .hint { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.4; }
  .commits {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    flex: 1;
  }
  .commits > li {
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
  }
  .history-sentinel {
    min-height: 44px;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 11px;
  }
  .commit-row {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 10px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .commit-row:hover,
  .commit-row.active {
    background: var(--bg-hover);
  }
  .commit-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .row1 { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .repo {
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
  }
  .sha {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-body);
    background: var(--bg-elevated);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .subject {
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .dot { opacity: 0.5; }
  .linked-label { font-style: italic; }
  .link {
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .link-task { background: var(--success-bg); color: var(--success); }
  .link-subtask { background: var(--warning-bg); color: var(--warning); }
  .link-claim { background: var(--accent-bg); color: var(--accent-text); }
  .commit-files {
    background: var(--bg-muted);
    border-top: 1px solid var(--border-subtle);
    padding: 6px 0;
  }
  .commit-files-head,
  .commit-files-state {
    color: var(--text-muted);
    font-size: 11px;
    padding: 4px 20px 6px 54px;
  }
  .commit-files-state.error-text {
    color: var(--danger);
  }
  .commit-file-row {
    width: 100%;
    min-height: 30px;
    border: 0;
    background: transparent;
    color: var(--text-body);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px 0 54px;
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }
  .commit-file-row:hover,
  .commit-file-row:focus-visible {
    background: var(--bg-hover);
  }
  .commit-file-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
