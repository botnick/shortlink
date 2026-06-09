import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { BackLink } from "@/components/BackLink";
import { api } from "@/lib/api";
import type { LinkDTO, ProjectDTO, ProjectListDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { QrStudio } from "@/components/QrStudio";

export function QrPage() {
  const { id } = useParams<{ id: string }>();
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [ready, setReady] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    api
      .get<{ link: LinkDTO }>(`/links/${id}`)
      .then(async (r) => {
        if (!active) return;
        setLink(r.link);
        // Load the link's project so the QR can default to its brand presets.
        if (r.link.projectId) {
          try {
            const pl = await api.get<ProjectListDTO>("/projects");
            if (active) {
              setProject(pl.projects.find((p) => p.id === r.link.projectId) ?? null);
            }
          } catch {
            /* fall back to the global brand */
          }
        }
        if (active) setReady(true);
      })
      .catch(() => active && setNotFound(true));
    return () => {
      active = false;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Link not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <RouterLink to="/dashboard">Back to dashboard</RouterLink>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink to={link ? `/links/${link.id}` : "/dashboard"} />

      <div>
        <h1 className="display text-2xl sm:text-3xl">QR code</h1>
        {link && (
          <p className="mt-1 text-sm text-muted-foreground">
            {link.shortUrl}
            {project && <> · {project.name}</>}
          </p>
        )}
      </div>

      {ready && link && (
        <QrStudio
          url={link.shortUrl}
          downloadName={link.slug}
          project={project ?? undefined}
          linkId={link.id}
          initialConfig={link.qrConfig}
        />
      )}
    </div>
  );
}
