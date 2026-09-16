import {
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getPreviewEntry, previewHeaders } from "@areca-cms/site-sdk";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { ArticleView } from "../../../components/article-view.tsx";
import type { Article } from "../../../lib/content.ts";

const previewSearchSchema = z.object({
  token: z.string().min(1),
});

const loadPreview = createServerFn({
  method: "GET",
  strict: { output: false },
})
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const headers = previewHeaders();
    setResponseHeader("X-Robots-Tag", headers["X-Robots-Tag"]);
    setResponseHeader("Cache-Control", headers["Cache-Control"]);
    try {
      const preview = await getPreviewEntry({ token: data.token });
      return { ok: true as const, preview };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch preview";
      return { ok: false as const, error: message };
    }
  });

export const Route = createFileRoute("/__preview/$collection/$slug")({
  validateSearch: (search) => previewSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    return loadPreview({ data: { token: deps.token } });
  },
  head: () => ({
    meta: [
      { title: "Preview - Acme" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PreviewPage,
  errorComponent: PreviewError,
});

function PreviewPage() {
  const { collection } = Route.useParams();
  const result = Route.useLoaderData();

  if (!result) {
    return (
      <PreviewMessage title="Preview unavailable" body="No preview data" />
    );
  }

  if (!result.ok) {
    return <PreviewMessage title="Preview unavailable" body={result.error} />;
  }

  if (collection !== "articles") {
    return (
      <PreviewMessage
        title="Preview unavailable"
        body={`Collection "${collection}" is not rendered on this site.`}
      />
    );
  }

  return <ArticleView article={result.preview.entry as Article} preview />;
}

function PreviewError({ error }: ErrorComponentProps) {
  const body =
    error instanceof Error ? error.message : "Failed to load preview";
  return <PreviewMessage title="Preview unavailable" body={body} />;
}

function PreviewMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <p className="mb-6 rounded-md border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-semibold tracking-wide text-amber-950">
        PREVIEW - draft content
      </p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-3 text-zinc-600">{body}</p>
    </div>
  );
}
