import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { BoardProjectDetailPage } from "../board/BoardProjectDetailPage";

function mapBoardToProjectsPath(to: string): string {
  return to.replace(/^\/board\/projects\//, "/projects/");
}

export function ProjectsDetailRouteAdapter() {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string; sliceId?: string }>();
  const [searchParams] = useSearchParams();
  return (
    <BoardProjectDetailPage
      projectId={params.projectId}
      sliceId={params.sliceId ?? null}
      tab={typeof searchParams.tab === "string" ? searchParams.tab : undefined}
      onBack={() => navigate("/projects")}
      onNavigate={(to, options) => {
        const next = mapBoardToProjectsPath(to);
        if (options) navigate(next, options);
        else navigate(next);
      }}
      onOpenProject={(id) => navigate(`/projects/${encodeURIComponent(id)}`)}
    />
  );
}
