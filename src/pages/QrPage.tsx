import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { shortUrlFor } from "@/lib/utils";
import type { LinkDTO } from "@shared/types";
import { Button } from "@/components/ui/button";
import { QrStudio } from "@/components/QrStudio";

export function QrPage() {
  const { id } = useParams<{ id: string }>();
  const [link, setLink] = useState<LinkDTO | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .get<{ link: LinkDTO }>(`/links/${id}`)
      .then((r) => setLink(r.link))
      .catch(() => setNotFound(true));
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
      <RouterLink
        to={link ? `/links/${link.id}` : "/dashboard"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </RouterLink>

      <div>
        <h1 className="display text-2xl sm:text-3xl">QR code</h1>
        {link && (
          <p className="mt-1 text-sm text-muted-foreground">
            {shortUrlFor(link.slug)}
          </p>
        )}
      </div>

      {link && <QrStudio url={shortUrlFor(link.slug)} downloadName={link.slug} />}
    </div>
  );
}
