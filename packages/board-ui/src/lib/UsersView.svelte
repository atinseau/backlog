<script lang="ts">
  // Workspace-scoped human collaborators (not AI agents). Shown as its
  // own left-panel section so the Agents view stays focused on
  // executors. Invited users land in `pending` with an invitation
  // token; once they confirm via a link they flip to `active` and can
  // be picked as the assignee on a sub-task alongside AI agents.
  //
  // Email delivery is not wired in v1 — the invitation link is shown
  // inline so the inviter can share it manually.
  import { deleteUser, fetchUsers, inviteUser, patchUser, refreshUserInvitation } from "./api.js";
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
  let copiedId = $state<string | null>(null);

  // Inline invitation form state. Null until the user clicks the
  // "Invite" button.
  let inviteForm = $state<{ email: string; display_name: string; role: UserRole } | null>(null);
  let inviting = $state(false);

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

  function startInvite() {
    inviteForm = { email: "", display_name: "", role: "member" };
  }

  async function submitInvite() {
    if (!inviteForm) return;
    const email = inviteForm.email.trim();
    if (!email) return;
    inviting = true;
    try {
      const input: Parameters<typeof inviteUser>[0] = { email, role: inviteForm.role };
      if (inviteForm.display_name.trim()) input.display_name = inviteForm.display_name.trim();
      await inviteUser(input);
      inviteForm = null;
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      inviting = false;
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

  async function resend(user: UserSummary) {
    busyId = user.id;
    try {
      await refreshUserInvitation(user.id);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  // Build the confirmation URL the recipient has to hit to flip
  // pending → active. We embed the token + workspace id so the link
  // works even if the user hasn't picked the workspace in the UI yet.
  function invitationUrl(user: UserSummary): string {
    if (!user.invitation_token) return "";
    const url = new URL(window.location.href);
    url.hash = `#/invitation/confirm?token=${encodeURIComponent(user.invitation_token)}`;
    return url.toString();
  }

  async function copyInviteLink(user: UserSummary) {
    const link = invitationUrl(user);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      copiedId = user.id;
      setTimeout(() => {
        if (copiedId === user.id) copiedId = null;
      }, 1500);
    } catch {
      // Clipboard blocked — fall back to selecting the input text via
      // a hidden textarea would be overkill here. The link is visible
      // inline, the user can manually select it.
    }
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
        onclick={startInvite}
        disabled={inviteForm !== null}
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

  {#if inviteForm}
    <div class="invite-form">
      <div class="invite-grid">
        <label class="field">
          <span class="lbl">{t("users_view.invite_email")}</span>
          <input
            type="email"
            placeholder={t("users_view.invite_email_placeholder")}
            value={inviteForm.email}
            oninput={(e) => (inviteForm!.email = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="field">
          <span class="lbl">{t("users_view.invite_name")}</span>
          <input
            placeholder={t("users_view.invite_name_placeholder")}
            value={inviteForm.display_name}
            oninput={(e) => (inviteForm!.display_name = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="field narrow">
          <span class="lbl">{t("users_view.invite_role")}</span>
          <select
            value={inviteForm.role}
            onchange={(e) => (inviteForm!.role = (e.currentTarget as HTMLSelectElement).value as UserRole)}
          >
            <option value="owner">{t("users_view.role_owner")}</option>
            <option value="admin">{t("users_view.role_admin")}</option>
            <option value="member">{t("users_view.role_member")}</option>
            <option value="guest">{t("users_view.role_guest")}</option>
          </select>
        </label>
      </div>
      <div class="invite-actions">
        <button class="btn-secondary" onclick={() => (inviteForm = null)} type="button">
          {t("users_view.invite_cancel")}
        </button>
        <button
          class="btn-primary"
          onclick={submitInvite}
          disabled={inviting || !inviteForm.email.trim()}
          type="button"
        >{inviting ? "…" : t("users_view.invite_submit")}</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">{t("agents_view.loading")}</div>
  {:else if users.length === 0 && !inviteForm}
    <div class="loading">{t("users_view.empty")}</div>
  {:else}
    <ul class="users">
      {#each users as user (user.id)}
        <li class:status-pending={user.status === "pending"} class:status-removed={user.status === "removed"}>
          <div class="row-main">
            <div class="ident">
              <strong>{user.display_name}</strong>
              <span class="email">{user.email}</span>
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
              {#if user.status === "pending"}
                <button
                  class="btn-secondary"
                  type="button"
                  onclick={() => resend(user)}
                  disabled={busyId === user.id}
                >{t("users_view.invitation_resend")}</button>
              {/if}
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
                  title={t("users_view.delete_confirm", { name: user.display_name })}
                >{t("users_view.delete_button")}</button>
              {/if}
            </div>
          </div>

          {#if user.status === "pending" && user.invitation_token}
            <div class="invite-link">
              <span class="lbl">{t("users_view.invitation_link")}</span>
              <code class="link">{invitationUrl(user)}</code>
              <button class="btn-secondary" type="button" onclick={() => copyInviteLink(user)}>
                {copiedId === user.id ? t("users_view.invitation_copied") : t("users_view.invitation_copy")}
              </button>
              <p class="hint">
                {t("users_view.invitation_pending_hint")}
                {#if user.invitation_expires_at}
                  · {t("users_view.invitation_expires", { when: formatDate(user.invitation_expires_at) })}
                {/if}
              </p>
            </div>
          {/if}

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

  .invite-link {
    background: var(--bg-elevated);
    border: 1px dashed var(--border-strong);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  }
  .invite-link .lbl { flex-basis: 100%; }
  .invite-link .link {
    flex: 1; min-width: 240px;
    background: var(--bg-input);
    color: var(--text-secondary);
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    flex-basis: 100%;
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
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
