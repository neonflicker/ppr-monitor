import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Bell } from "lucide-react";

/**
 * NOTICE BOARD — public announcements maintained from the Admin panel
 * (Notice Board tab). One database notice = one bullet point, in the
 * admin-defined order.
 *
 * Deliberately props-free (§12): it takes no user/village/vaccinator scope,
 * so its content never changes with the dashboard filters, and reading it
 * requires no login — only admin *writes* are authenticated server-side.
 */
export default function NoticeBoard() {
  const notices = useQuery(api.notices.listActive, {});

  // Keep the card out of the layout until the query resolves — never show an
  // empty board while notices may still be loading.
  if (!notices) return null;

  return (
    <section
      aria-label="Notice board"
      className="rounded-md border border-border bg-card px-4 py-3"
    >
      <div className="flex items-center gap-2.5 border-b border-border pb-2">
        <span
          className="h-6 w-[3px] shrink-0 rounded-full bg-primary"
          aria-hidden="true"
        />
        <Bell className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-bold uppercase tracking-[0.18em]">
          NOTICE BOARD
        </h2>
      </div>

      <ul className="mt-3 space-y-2">
        {notices.length === 0 ? (
          <li className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <span aria-hidden="true">•</span>
            <span className="min-w-0 break-words">No current notices.</span>
          </li>
        ) : (
          notices.map((notice) => (
            <li key={notice._id} className="flex gap-2 leading-relaxed">
              <span
                className="shrink-0 text-lg font-bold text-primary"
                aria-hidden="true"
              >
                •
              </span>
              <span className="min-w-0 break-words whitespace-pre-line text-lg font-bold text-primary">
                {notice.title && (
                  <span className="font-bold">{notice.title} — </span>
                )}
                {notice.content}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
