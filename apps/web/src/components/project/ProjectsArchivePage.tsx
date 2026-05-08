import { A } from "@solidjs/router";
import { For, Show, createMemo, createResource } from "solid-js";
import { fetchArchivedProjects, fetchProjects } from "../../api";
import type { ProjectListItem } from "../../api/types";

function getStatus(item: ProjectListItem): string {
  const value = item.frontmatter?.status;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function ProjectGroup(props: { title: string; items: ProjectListItem[] }) {
  return (
    <section class="projects-archive-group">
      <h2>{props.title}</h2>
      <Show
        when={props.items.length > 0}
        fallback={<div class="projects-archive-empty">No projects</div>}
      >
        <ul>
          <For each={props.items}>
            {(project) => (
              <li>
                <A href={`/projects/${encodeURIComponent(project.id)}`}>
                  <span class="id">{project.id}</span>
                  <span class="title">{project.title}</span>
                </A>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}

export function ProjectsArchivePage() {
  const [archived] = createResource(fetchArchivedProjects);
  const [projects] = createResource(fetchProjects);

  const cancelled = createMemo(() =>
    (projects() ?? []).filter((item) => getStatus(item) === "cancelled")
  );

  return (
    <div class="projects-archive-page">
      <header>
        <h1>Archive</h1>
        <A href="/projects">Back to Projects</A>
      </header>
      <ProjectGroup title="Archived" items={archived() ?? []} />
      <ProjectGroup title="Cancelled" items={cancelled()} />
      <style>{`
        .projects-archive-page { padding: 20px; max-width: 960px; margin: 0 auto; }
        .projects-archive-page header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
        .projects-archive-group { border:1px solid var(--border-color); border-radius:10px; padding:12px; margin-bottom:14px; }
        .projects-archive-group h2 { margin:0 0 10px; font-size:16px; }
        .projects-archive-group ul { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
        .projects-archive-group li a { display:flex; gap:10px; text-decoration:none; color:var(--text-primary); padding:8px; border-radius:8px; }
        .projects-archive-group li a:hover { background: var(--bg-subtle); }
        .projects-archive-group .id { color: var(--text-tertiary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        .projects-archive-empty { color: var(--text-secondary); font-size: 13px; }
      `}</style>
    </div>
  );
}
