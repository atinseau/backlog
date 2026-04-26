import { Command } from "commander";
import { findWorkspace } from "@backlog/config";
import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  removeProject,
  updateProject,
} from "@backlog/core";

function workspaceDir(): string {
  const workspace = findWorkspace();
  if (!workspace) {
    throw new Error("No .backlog workspace found. Run `backlog init` first.");
  }
  return workspace.backlogDir;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage projects (groups of repos)");

  project
    .command("add")
    .description("Create a project")
    .requiredOption("--slug <slug>", "Project slug (lowercase, alphanumeric, dashes)")
    .requiredOption("--name <name>", "Display name")
    .option("--description <text>", "Description")
    .option("--color <hex>", "Color (e.g. #7c3aed)")
    .option("--repo <repo>", "Repo ids (repeat for multiple)", collectValues, [])
    .option("--max-agents <n>", "Override max_agents for this project")
    .action((options: {
      slug: string;
      name: string;
      description?: string;
      color?: string;
      repo: string[];
      maxAgents?: string;
    }) => {
      const created = createProject(workspaceDir(), {
        slug: options.slug,
        name: options.name,
        ...(options.description ? { description: options.description } : {}),
        ...(options.color ? { color: options.color } : {}),
        repoIds: options.repo,
        ...(options.maxAgents ? { maxAgents: parseInt(options.maxAgents, 10) } : {}),
      });
      console.log(`Created project ${created.id} (${created.slug})`);
    });

  project
    .command("list")
    .description("List projects")
    .option("--all", "Include archived")
    .action((options: { all?: boolean }) => {
      const projects = listProjects(workspaceDir()).filter((p) => options.all || !p.archived);
      if (projects.length === 0) {
        console.log("No projects.");
        return;
      }
      for (const p of projects) {
        const archivedTag = p.archived ? " [archived]" : "";
        const repos = p.repo_ids.length > 0 ? ` repos=[${p.repo_ids.join(",")}]` : "";
        console.log(`${p.slug.padEnd(20)} ${p.name}${repos}${archivedTag}`);
      }
    });

  project
    .command("show <idOrSlug>")
    .description("Show one project")
    .action((idOrSlug: string) => {
      const p = getProject(workspaceDir(), idOrSlug);
      if (!p) {
        console.error(`Unknown project: ${idOrSlug}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(p, null, 2));
    });

  project
    .command("update <idOrSlug>")
    .description("Update project fields")
    .option("--name <name>")
    .option("--description <text>")
    .option("--clear-description")
    .option("--color <hex>")
    .option("--clear-color")
    .option("--repo <repo>", "Replace repo_ids (repeat)", collectValues, [] as string[])
    .option("--max-agents <n>", "Override max_agents for this project")
    .option("--clear-max-agents")
    .action((idOrSlug: string, options: {
      name?: string;
      description?: string;
      clearDescription?: boolean;
      color?: string;
      clearColor?: boolean;
      repo?: string[];
      maxAgents?: string;
      clearMaxAgents?: boolean;
    }) => {
      const input: Parameters<typeof updateProject>[2] = {};
      if (options.name !== undefined) input.name = options.name;
      if (options.description !== undefined) input.description = options.description;
      if (options.clearDescription) input.clearDescription = true;
      if (options.color !== undefined) input.color = options.color;
      if (options.clearColor) input.clearColor = true;
      if (options.repo && options.repo.length > 0) input.repoIds = options.repo;
      if (options.maxAgents !== undefined) input.maxAgents = parseInt(options.maxAgents, 10);
      if (options.clearMaxAgents) input.clearMaxAgents = true;
      const updated = updateProject(workspaceDir(), idOrSlug, input);
      console.log(`Updated project ${updated.slug}`);
    });

  project
    .command("archive <idOrSlug>")
    .description("Archive a project (keeps it in history)")
    .action((idOrSlug: string) => {
      const archived = archiveProject(workspaceDir(), idOrSlug);
      console.log(`Archived project ${archived.slug}`);
    });

  project
    .command("remove <idOrSlug>")
    .description("Delete a project (work items are detached)")
    .action((idOrSlug: string) => {
      const removed = removeProject(workspaceDir(), idOrSlug);
      console.log(`Removed project ${removed.slug}`);
    });
}
