import { Check, ChevronsUpDown, FolderPlus, Settings2 } from "lucide-react";
import type { ProjectDTO } from "@shared/types";
import { useConfig } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function Mark({ project, brand }: { project: ProjectDTO; brand: string }) {
  return project.logo ? (
    <img src={project.logo} alt="" className="size-5 shrink-0 rounded object-cover" />
  ) : (
    <span
      className="size-5 shrink-0 rounded ring-1 ring-inset ring-foreground/10"
      style={{ backgroundColor: project.color || brand }}
    />
  );
}

export function ProjectSwitcher({
  projects,
  selected,
  onSelect,
  onNew,
  onManage,
}: {
  projects: ProjectDTO[];
  selected: ProjectDTO | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onManage: () => void;
}) {
  const { config } = useConfig();
  const brand = config.brandColor;
  if (!selected) return null;

  // With a single project there's nothing to switch between, so the dropdown is
  // just noise. Show a plain label (tap it for settings) and keep New project
  // visible as its own quiet button.
  if (projects.length <= 1) {
    return (
      <div className="flex items-center gap-1">
        <Hint label="Project settings">
          <button
            type="button"
            onClick={onManage}
            className="flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent"
          >
            <Mark project={selected} brand={brand} />
            <span className="max-w-[42vw] truncate font-semibold sm:max-w-[16rem]">
              {selected.name}
            </span>
          </button>
        </Hint>
        <Hint label="New project">
          <Button variant="ghost" size="icon" onClick={onNew} aria-label="New project">
            <FolderPlus />
          </Button>
        </Hint>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto gap-2 px-2.5 py-1.5">
          <Mark project={selected} brand={brand} />
          <span className="max-w-[42vw] truncate font-semibold sm:max-w-[16rem]">
            {selected.name}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[60vh] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Projects</p>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => onSelect(p.id)} className="gap-2.5 py-2">
            <Mark project={p} brand={brand} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.isDefault && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                default
              </span>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">{p.linkCount}</span>
            {p.id === selected.id && <Check className="size-4 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNew} className="py-2">
          <FolderPlus /> New project
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onManage} className="py-2">
          <Settings2 /> Manage “{selected.name}”
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
