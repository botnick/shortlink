import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Shared shell for every settings card: a title + description header and a body
 *  that shows a skeleton until the settings have loaded. The form passed as
 *  `children` is only rendered (and its draft state seeded) once data is in. */
export function SettingsCard({
  title,
  description,
  loading,
  skeleton,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  loading: boolean;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{loading ? (skeleton ?? <FormSkeleton />) : children}</CardContent>
    </Card>
  );
}

/** The default two-line loading placeholder used by most settings cards. */
function FormSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
