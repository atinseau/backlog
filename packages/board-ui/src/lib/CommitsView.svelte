<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { isMissingRepoPathError, relocateRepoPath } from "./repo-relocate.js";
  import {
    addGitWorktree,
    checkoutGitBranch,
    commitGitChanges,
    discardGitChanges,
    fetchCommits,
    fetchGitBranchPreview,
    fetchGitBranches,
    fetchGitChanges,
    fetchGitCommitFiles,
    fetchGitRemoteState,
    fetchGitWorktrees,
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
  let gitActionBusy = $state<"discard" | "stash" | null>(null);
  let syncingRepo = $state<string | null>(null);
  let branchBusy = $state<string | null>(null);
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

  async function load() {
    loading = true;
    try {
      const [nextRepos, nextCommits] = await Promise.all([
        fetchGitChanges(selectedRepoId),
        fetchCommits(100, selectedRepoId),
      ]);
      repos = nextRepos;
      commits = nextCommits;
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
      resetSelection(nextRepos);
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

  function worktreesFor(repoId: string): GitRepoWorktrees | null {
    return worktrees.find((entry) => entry.repo === repoId) ?? null;
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

  async function discardSelected() {
    await discardGroups(selectedPathGroups());
  }

  async function stashSelected() {
    await stashGroups(selectedPathGroups());
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

  async function mergeBranch(repoId: string) {
    const state = branchesFor(repoId);
    if (!state) return;
    const source = selectedMergeSource(state);
    if (!source) return;
    const preview = previewFor(state);
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

  function openPreviewFileDiff(preview: GitBranchPreview, file: GitCommitFileEntry) {
    onOpenDiff?.(preview.repo, file.path, null, preview.base, preview.source);
  }

  function worktreeBranchLabel(worktree: GitWorktreeEntry): string {
    if (worktree.branch) return worktree.branch;
    if (worktree.detached) return t("git.branch.detached");
    return t("git.worktree.no_branch");
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
      const relocated = await relocateRepoPath(repo.repo, repo.path);
      if (!relocated) return;
      info = t("repos_view.relocate_done", { repo: repo.repo });
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

  $effect(() => {
    selectedRepoId;
    void load();
  });

  $effect(() => {
    if (activeTab !== "branches") return;
    for (const state of branches) {
      if (state.error) continue;
      const source = selectedMergeSource(state);
      if (source) void loadMergePreview(state.repo, state.current_branch ?? "HEAD", source);
    }
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
      <button class="refresh" onclick={load} title="↻">↻</button>
      {#if !embedded}
        <button class="close" onclick={onClose}>✕</button>
      {/if}
    </div>
  </header>

  {#if error}<div class="error">{error}</div>{/if}
  {#if info}<div class="info">{info}</div>{/if}

  {#if !loading && activeTab === "branches" && branches.length > 0}
    <div class="branch-bar" aria-label={t("git.branch.section")}>
      {#each branches as state (state.repo)}
        {@const remote = remoteFor(state.repo)}
        {@const mergeSources = mergeOptions(state)}
        <section class="branch-card">
          <div class="branch-head">
            <div class="branch-meta">
              <span class="remote-repo">{state.repo}</span>
              <span class="branch-current">{state.current_branch ?? t("git.branch.detached")}</span>
              <span class="remote-state">{remoteText(remote)}</span>
            </div>
            <button
              type="button"
              class="sync"
              onclick={() => syncRepo(state.repo)}
              disabled={syncingRepo !== null || branchBusy !== null || !remote?.remote_url}
              title={remote?.remote_url ?? ""}
            >
              {syncingRepo === state.repo ? t("git.sync.running") : t("git.sync.button")}
            </button>
          </div>
          {#if state.error}
            <div class="repo-error">
              {#if isMissingRepoPathError(state.error)}
                <strong>{t("repos_view.missing_title", { repo: state.repo })}</strong>
                <span>{t("repos_view.missing_body", { path: state.path })}</span>
                <button type="button" onclick={() => handleRelocateRepo(state)}>
                  {t("repos_view.relocate")}
                </button>
              {:else}
                {state.error}
              {/if}
            </div>
          {:else}
            <div class="branch-controls">
              <label class="branch-field">
                <span>{t("git.branch.checkout")}</span>
                <select
                  value={state.current_branch ?? ""}
                  disabled={branchBusy !== null}
                  onchange={(e) => checkoutBranch(state.repo, e.currentTarget.value)}
                >
                  {#if !state.current_branch}
                    <option value="">{t("git.branch.detached")}</option>
                  {/if}
                  <optgroup label={t("git.branch.local")}>
                    {#each state.local as branch (branch.name)}
                      <option value={branch.name}>{branch.name}{branch.upstream ? ` · ${branch.upstream}` : ""}</option>
                    {/each}
                  </optgroup>
                  {#if state.remote.length > 0}
                    <optgroup label={t("git.branch.remote")}>
                      {#each state.remote as branch (branch.name)}
                        <option value={branch.name}>{branch.name}</option>
                      {/each}
                    </optgroup>
                  {/if}
                </select>
              </label>
              <label class="branch-field new-branch">
                <span>{t("git.branch.new")}</span>
                <input
                  value={newBranchByRepo[state.repo] ?? ""}
                  placeholder={t("git.branch.new_placeholder")}
                  disabled={branchBusy !== null}
                  oninput={(e) => setNewBranch(state.repo, e.currentTarget.value)}
                  onkeydown={(e) => { if (e.key === "Enter") void createBranch(state.repo); }}
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
              <div class="merge-control">
                <label class="branch-field">
                  <span>{t("git.branch.merge_source")}</span>
                  <select
                    value={selectedMergeSource(state)}
                    disabled={branchBusy !== null || mergeSources.length === 0}
                    onchange={(e) => setMergeSource(state.repo, e.currentTarget.value)}
                  >
                    {#each mergeSources as source (source)}
                      <option value={source}>{source}</option>
                    {/each}
                  </select>
                </label>
                <label class="branch-field strategy">
                  <span>{t("git.branch.strategy")}</span>
                  <select
                    value={mergeStrategyByRepo[state.repo] ?? "auto"}
                    disabled={branchBusy !== null || mergeSources.length === 0}
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
                  onclick={() => mergeBranch(state.repo)}
                  disabled={branchBusy !== null || mergeSources.length === 0 || previewFor(state) === null || Boolean(previewFor(state) && "loading" in previewFor(state)!)}
                >
                  {branchBusy === state.repo ? t("git.branch.running") : t("git.branch.merge")}
                </button>
              </div>
            </div>
            {@const preview = previewFor(state)}
            {#if preview}
              <div class="branch-preview">
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
            {/if}
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
              <div class="repo-row">
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
                  {#if isMissingRepoPathError(repo.status.error)}
                    <strong>{t("repos_view.missing_title", { repo: repo.repo })}</strong>
                    <span>{t("repos_view.missing_body", { path: repo.path })}</span>
                    <button type="button" onclick={() => handleRelocateRepo(repo)}>
                      {t("repos_view.relocate")}
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
          <section class="worktree-repo">
            <div class="worktree-repo-head">
              <div>
                <strong>{repo.repo}</strong>
                <span>{repo.path}</span>
              </div>
              <button type="button" class="secondary" onclick={() => pruneWorktrees(repo.repo)} disabled={worktreeBusy !== null}>
                {t("git.worktree.prune")}
              </button>
            </div>
            {#if repo.error}
              <div class="repo-error">
                {#if isMissingRepoPathError(repo.error)}
                  <strong>{t("repos_view.missing_title", { repo: repo.repo })}</strong>
                  <span>{t("repos_view.missing_body", { path: repo.path })}</span>
                  <button type="button" onclick={() => handleRelocateRepo(repo)}>
                    {t("repos_view.relocate")}
                  </button>
                {:else}
                  {repo.error}
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
              <div class="worktree-list">
                {#each repo.worktrees as worktree (worktree.path)}
                  <div class="worktree-row">
                    <div class="worktree-main">
                      <span class="branch-current">{worktreeBranchLabel(worktree)}</span>
                      {#if worktree.main}<span class="worktree-badge">{t("git.worktree.main")}</span>{/if}
                      {#if worktree.prunable}<span class="worktree-badge warn">{t("git.worktree.prunable")}</span>{/if}
                      <code>{worktree.head ? worktree.head.slice(0, 7) : "-------"}</code>
                      <button type="button" class="path-button" onclick={() => openWorktree(worktree.path)} title={worktree.path}>
                        {worktree.path}
                      </button>
                      {#if worktree.prunable_reason}<span class="worktree-reason">{worktree.prunable_reason}</span>{/if}
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
    <ul class="commits">
      {#each commits as commit (commit.repo + ":" + commit.sha)}
        {@const isActiveCommit = selectedCommitKey === commitKey(commit)}
        <li>
          <div
            class="commit-row"
            class:active={isActiveCommit}
            role="button"
            tabindex="0"
            onfocus={() => selectCommit(commit)}
            onmousedown={() => selectCommit(commit)}
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
                    onfocus={() => openCommitFileDiff(commit, file)}
                    onmousedown={() => openCommitFileDiff(commit, file)}
                    onclick={() => openCommitFileDiff(commit, file)}
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
    </ul>
  {/if}
{/snippet}

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
  .branch-bar {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-muted);
  }
  .branch-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-surface);
    padding: 8px;
    min-width: 0;
  }
  .branch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .branch-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .remote-repo {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 600;
  }
  .branch-current {
    max-width: 260px;
    color: var(--accent-text);
    background: var(--accent-bg);
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remote-state {
    color: var(--text-muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch-controls {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) minmax(230px, 1.2fr) minmax(300px, 1.5fr);
    gap: 8px;
    align-items: end;
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
  .new-branch {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "label label"
      "input button";
    align-items: end;
  }
  .new-branch span { grid-area: label; }
  .new-branch input { grid-area: input; }
  .new-branch button { grid-area: button; }
  .merge-control {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(130px, 1fr) minmax(110px, 0.8fr) auto;
    gap: 6px;
    align-items: end;
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
  .worktree-row code {
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
    .branch-controls {
      grid-template-columns: 1fr;
    }
    .merge-control {
      grid-template-columns: 1fr;
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
  .worktrees-view {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .worktree-repo {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-surface);
    overflow: hidden;
  }
  .worktree-repo-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-muted);
  }
  .worktree-repo-head div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .worktree-repo-head strong {
    font-size: 12px;
    color: var(--text-primary);
  }
  .worktree-repo-head span {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .worktree-add {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.7fr) auto;
    gap: 8px;
    align-items: end;
    padding: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .worktree-list {
    display: flex;
    flex-direction: column;
  }
  .worktree-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .worktree-row:last-child {
    border-bottom: 0;
  }
  .worktree-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }
  .worktree-actions {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .worktree-badge {
    border: 1px solid var(--border-subtle);
    border-radius: 999px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 1px 6px;
    font-size: 10px;
  }
  .worktree-badge.warn {
    color: var(--warning);
    background: var(--warning-bg);
  }
  .path-button {
    min-width: 0;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 0;
    background: transparent;
    color: var(--text-body);
    padding: 0;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }
  .path-button:hover {
    color: var(--accent);
  }
  .worktree-reason {
    color: var(--text-muted);
    font-size: 11px;
  }
  @media (max-width: 980px) {
    .worktree-add,
    .worktree-row {
      grid-template-columns: 1fr;
      flex-direction: column;
      align-items: stretch;
    }
    .worktree-actions {
      justify-content: flex-start;
      flex-wrap: wrap;
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
