<script lang="ts">
  // Topbar profile dropdown — quick account actions without opening
  // a full modal. The detailed flows (signup, OAuth, billing) live in
  // ProfileView which this menu can open.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import { cloudLogout, type CloudStatus } from "./api.js";
  import { deriveInitials } from "./settings.svelte.js";

  interface Props {
    cloudStatus: CloudStatus | null;
    onOpenProfile: (mode: "signin" | "signup") => void;
    onOpenSettings: () => void;
    onChanged: () => void;
  }

  let { cloudStatus, onOpenProfile, onOpenSettings, onChanged }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  function toggle() {
    open = !open;
  }
  function close() {
    open = false;
  }

  function handleDocumentClick(e: MouseEvent) {
    if (!open) return;
    if (containerEl && !containerEl.contains(e.target as Node)) close();
  }
  function handleKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") close();
  }

  $effect(() => {
    if (open) {
      window.addEventListener("click", handleDocumentClick);
      window.addEventListener("keydown", handleKey);
    } else {
      window.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("keydown", handleKey);
    }
  });
  onDestroy(() => {
    window.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("keydown", handleKey);
  });


  async function logout() {
    close();
    await cloudLogout();
    onChanged();
  }
</script>

<div class="profile-menu" bind:this={containerEl}>
  <button
    class="avatar"
    class:signed-in={cloudStatus?.signed_in}
    onclick={toggle}
    title={cloudStatus?.user?.email ?? t("topbar.profile_signed_out")}
    aria-label={t("topbar.profile")}
    aria-expanded={open}
  >
    {#if cloudStatus?.signed_in && cloudStatus.user}
      <span class="initials">{deriveInitials(cloudStatus.user.email)}</span>
    {:else}
      <!-- Outline user icon — neutral signed-out state -->
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.5" r="2.75" stroke="currentColor" stroke-width="1.4" />
        <path d="M2.5 13.5c.7-2.4 3-3.5 5.5-3.5s4.8 1.1 5.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      </svg>
    {/if}
  </button>

  {#if open}
    <div class="dropdown" role="menu">
      {#if cloudStatus?.signed_in && cloudStatus.user}
        <div class="header-row">
          <div class="who">
            <span class="email" title={cloudStatus.user.email}>{cloudStatus.user.email}</span>
            <span class="plan plan-{cloudStatus.user.plan}">
              {t(`account.plan.${cloudStatus.user.plan}`)}
            </span>
          </div>
        </div>
        <div class="separator"></div>
        <button class="item" role="menuitem" onclick={() => { close(); onOpenProfile("signin"); }}>
          {t("profile.menu.manage")}
        </button>
        <button class="item" role="menuitem" onclick={() => { close(); onOpenSettings(); }}>
          ⚙ {t("profile.menu.settings")}
        </button>
        <div class="separator"></div>
        <button class="item danger" role="menuitem" onclick={logout}>
          {t("profile.menu.logout")}
        </button>
      {:else}
        <div class="header-row signed-out">
          <span>{t("topbar.profile_signed_out")}</span>
        </div>
        <div class="separator"></div>
        <button class="item primary" role="menuitem" onclick={() => { close(); onOpenProfile("signin"); }}>
          {t("profile.menu.signin")}
        </button>
        <button class="item" role="menuitem" onclick={() => { close(); onOpenProfile("signup"); }}>
          {t("profile.menu.signup")}
        </button>
        <div class="separator"></div>
        <button class="item" role="menuitem" onclick={() => { close(); onOpenSettings(); }}>
          ⚙ {t("profile.menu.settings")}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .profile-menu {
    position: relative;
    display: inline-flex;
  }
  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    padding: 0;
    margin-left: 4px;
    font-size: 12px;
    font-weight: 600;
    background: var(--bg-hover);
    color: var(--text-secondary);
    border: 1px solid var(--border-strong);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .avatar.signed-in {
    background: var(--success-bg);
    color: var(--success);
    border-color: var(--success);
  }
  .avatar:hover {
    box-shadow: 0 0 0 3px var(--accent-bg);
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: var(--shadow-modal);
    padding: 6px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 1px;
    color: var(--text-primary);
  }
  .header-row {
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .header-row.signed-out {
    text-align: center;
    font-style: italic;
  }
  .who { display: flex; flex-direction: column; gap: 4px; }
  .email {
    color: var(--text-primary);
    font-weight: 500;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plan {
    align-self: flex-start;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--bg-elevated);
    color: var(--text-body);
  }
  .plan.plan-pro { background: var(--accent-bg); color: var(--accent-text); }
  .separator {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 0;
  }
  .item {
    background: transparent;
    border: none;
    padding: 6px 10px;
    cursor: pointer;
    text-align: left;
    color: var(--text-body);
    font-size: 13px;
    border-radius: 4px;
  }
  .item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .item.primary { color: var(--accent); font-weight: 500; }
  .item.danger { color: var(--danger); }
  .item.danger:hover { background: var(--danger-bg); }
</style>
