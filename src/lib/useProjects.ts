import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { ProjectDTO, ProjectListDTO } from "@shared/types";

const STORAGE_KEY = "shortlink:projectId";

/** Loads the user's projects and tracks the selected one (persisted locally). */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<ProjectListDTO>("/projects");
      setProjects(data.projects);
      setSelectedId((cur) =>
        cur && data.projects.some((p) => p.id === cur) ? cur : data.defaultProjectId,
      );
    } catch {
      // keep whatever we have
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedId) localStorage.setItem(STORAGE_KEY, selectedId);
  }, [selectedId]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return { projects, selected, selectedId, setSelectedId, loading, refresh };
}
