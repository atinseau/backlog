<script lang="ts">
  // Project-scoped human collaborators (not AI agents). In a local
  // project this is only an assignable people list: real invitations
  // require Backlog Cloud because there is no shared local endpoint to
  // accept an invite from another machine.
  import { createUser, deleteUser, fetchUsers, patchUser } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { UserRole, UserSummary } from "./types.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  let users = $state<UserSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busyId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);

  // Inline local collaborator form state. Null until the user clicks
  // the "Add person" button.
  let addForm = $state<{ email: string; display_name: string; role: UserRole } | null>(null);
  let adding = $state(false);

  async function load() {
    loading = true;
    try {
      users = await fetchUsers();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function startAdd() {
    addForm = { email: "", display_name: "", role: "member" };
  }

  async function submitAdd() {
    if (!addForm) return;
    const email = normalizeEmail(addForm.email);
    if (!email) return;
    adding = true;
    try {
      const input: Parameters<typeof createUser>[0] = { email, role: addForm.role };
      if (addForm.display_name.trim()) input.display_name = addForm.display_name.trim();
      await createUser(input);
      addForm = null;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      adding = false;
    }
  }

  async function changeRole(user: UserSummary, role: UserRole) {
    if (role === user.role) return;
    busyId = user.id;
    try {
      await patchUser(user.id, { role });
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  async function handleDelete(user: UserSummary) {
    if (confirmingDeleteId !== user.id) {
      confirmingDeleteId = user.id;
      return;
    }
    confirmingDeleteId = null;
    busyId = user.id;
    try {
      await deleteUser(user.id);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
  }

  function displayName(user: UserSummary): string {
    return user.display_name?.trim() || user.email.split("@")[0] || user.email;
  }

  function mailtoHref(email: string): string {
    return `mailto:${encodeURIComponent(email)}`;
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  load();
</script>

{#snippet body()}
  <header>
    <div>
      <h2>{t("users_view.title")}</h2>
      <p class="subtitle">{t("users_view.subtitle")}</p>
    </div>
    <div class="header-actions">
      <button
        class="btn-primary"
        onclick={startAdd}
        disabled={addForm !== null}
        type="button"
      >+ {t("users_view.invite_button")}</button>
      {#if !embedded}
        <button class="close" onclick={onClose} aria-label="Close">✕</button>
      {/if}
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if addForm}
    <form class="invite-form" onsubmit={(e) => { e.preventDefault(); submitAdd(); }}>
      <div class="invite-grid">
        <label class="field">
          <span class="lbl">{t("users_view.invite_email")}</span>
          <input
            type="email"
            inputmode="email"
            autocomplete="email"
            autocapitalize="off"
            spellcheck="false"
            placeholder={t("users_view.invite_email_placeholder")}
            value={addForm.email}
            oninput={(e) => (addForm!.email = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="lbl">{t("users_view.invite_name")}</span>
          <input
            placeholder={t("users_view.invite_name_placeholder")}
            value={addForm.display_name}
            oninput={(e) => (addForm!.display_name = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="field narrow">
          <span class="lbl">{t("users_view.invite_role")}</span>
          <select
            value={addForm.role}
            onchange={(e) => (addForm!.role = (e.currentTarget as HTMLSelectElement).value as UserRole)}
          >
            <option value="owner">{t("users_view.role_owner")}</option>
            <option value="admin">{t("users_view.role_admin")}</option>
            <option value="member">{t("users_view.role_member")}</option>
            <option value="guest">{t("users_view.role_guest")}</option>
          </select>
        </label>
      </div>
      <div class="invite-actions">
        <button class="btn-secondary" onclick={() => (addForm = null)} type="button">
          {t("users_view.invite_cancel")}
        </button>
        <button
          class="btn-primary"
          disabled={adding || !normalizeEmail(addForm.email)}
          type="submit"
        >{adding ? "…" : t("users_view.invite_submit")}</button>
      </div>
    </form>
  {/if}

  {#if loading}
    <div class="loading">{t("agents_view.loading")}</div>
  {:else if users.length === 0 && !addForm}
    <div class="loading">{t("users_view.empty")}</div>
  {:else}
    <ul class="users">
      {#each users as user (user.id)}
        <li class:status-pending={user.status === "pending"} class:status-removed={user.status === "removed"}>
          <div class="row-main">
            <div class="ident">
              <strong>{displayName(user)}</strong>
              <a class="email" href={mailtoHref(user.email)} title={user.email}>{user.email}</a>
              <span class="status status-{user.status}">{t(`users_view.status_${user.status}`)}</span>
            </div>
            <div class="controls">
              <select
                value={user.role}
                disabled={busyId === user.id || user.status === "removed"}
                onchange={(e) => changeRole(user, (e.currentTarget as HTMLSelectElement).value as UserRole)}
                aria-label="Role"
              >
                <option value="owner">{t("users_view.role_owner")}</option>
                <option value="admin">{t("users_view.role_admin")}</option>
                <option value="member">{t("users_view.role_member")}</option>
                <option value="guest">{t("users_view.role_guest")}</option>
              </select>
              {#if confirmingDeleteId === user.id}
                <button class="btn-danger" type="button" onclick={() => handleDelete(user)} disabled={busyId === user.id}>
                  {t("users_view.delete_yes")}
                </button>
                <button class="btn-secondary" type="button" onclick={() => (confirmingDeleteId = null)}>
                  {t("users_view.delete_cancel")}
                </button>
              {:else}
                <button
                  class="btn-danger-outline"
                  type="button"
                  onclick={() => handleDelete(user)}
                  disabled={busyId === user.id}
                  title={t("users_view.delete_confirm", { name: displayName(user) })}
                >{t("users_view.delete_button")}</button>
              {/if}
            </div>
          </div>

          <div class="meta">
            <span>{t("users_view.invited_at", { when: formatDate(user.invited_at) })}</span>
            {#if user.confirmed_at}
              <span>· {t("users_view.confirmed_at", { when: formatDate(user.confirmed_at) })}</span>
            {/if}
          </div>
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
    position: fixed; inset: 0;
    background: var(--backdrop);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 760px;
    width: 92%;
    max-height: 88vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%; width: 100%;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 16px; }
  .subtitle { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
  .header-actions { display: inline-flex; align-items: center; gap: 8px; }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 20px;
    font-size: 12px;
    border-bottom: 1px solid var(--danger-bg);
  }
  .loading {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }

  .invite-form {
    margin: 12px 16px 16px;
    padding: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    border-radius: 6px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .invite-grid {
    display: grid;
    grid-template-columns: 1.4fr 1.2fr 0.8fr;
    gap: 10px;
  }
  .invite-actions { display: flex; justify-content: flex-end; gap: 8px; }

  .field { display: flex; flex-direction: column; gap: 3px; }
  .field.narrow { max-width: 150px; }
  .lbl {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .field input,
  .field select {
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    font: inherit;
    font-size: 13px;
    background: var(--bg-surface);
  }

  ul.users {
    list-style: none;
    margin: 0;
    padding: 12px 16px;
    display: flex; flex-direction: column; gap: 12px;
    overflow-y: auto;
    flex: 1;
  }
  ul.users li {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-surface);
    padding: 12px 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
  li.status-pending { border-color: var(--warning); }
  li.status-removed { opacity: 0.55; }

  .row-main {
    display: flex; align-items: center; gap: 10px;
    flex-wrap: wrap;
  }
  .ident {
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    flex: 1; min-width: 200px;
  }
  .ident strong { font-size: 14px; }
  .email { font-size: 12px; color: var(--text-muted); font-family: ui-monospace, monospace; }
  a.email {
    text-decoration: none;
  }
  a.email:hover {
    color: var(--accent);
    text-decoration: underline;
  }

  .status {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
  }
  .status-pending { background: var(--warning-bg); color: var(--warning); }
  .status-active  { background: var(--success-bg); color: var(--success); }
  .status-removed { background: var(--bg-hover); color: var(--text-muted); }

  .controls {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .controls select {
    padding: 4px 6px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    font-size: 12px;
    background: var(--bg-surface);
  }

  .meta {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: var(--bg-input);
    color: var(--text-body);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-secondary:hover { background: var(--bg-hover); }
  .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger {
    background: var(--danger);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-danger-outline {
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-danger-outline:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  .btn-danger-outline:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
