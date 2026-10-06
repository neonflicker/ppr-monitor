import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import {
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeNotice,
} from "@/convex/lib/noticeRules";
import { useAdmin } from "@/hooks/use-admin";
import { errorMessage } from "@/lib/convex-errors";
import { useAction, useQuery } from "convex/react";
import { format } from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * ADMIN → NOTICE BOARD (§1–22).
 *
 * One database notice = one public bullet. Reads use api.notices.listAll
 * (same unauthenticated admin-read convention as sync.history); every write
 * goes through the noticeActions, which call requireAdmin server-side — no
 * new login system, the existing admin session token is reused.
 */

type NoticeRow = {
  _id: string;
  title?: string;
  content: string;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

type Editor = {
  id: string;
  title: string;
  content: string;
  active: boolean;
};

/** Live preview of exactly how the notice renders on the public dashboard. */
function NoticePreview({ title, content }: { title: string; content: string }) {
  // Blank input shows a calm placeholder; invalid input (e.g. too long) shows
  // the validation message. Never renders a malformed/empty bullet.
  const result = content.trim() ? normalizeNotice(title, content) : null;
  const error = result && !result.ok ? result.error : null;

  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Preview · public Notice Board
      </p>
      {error ? (
        <p className="mt-2 text-sm text-destructive">{error}</p>
      ) : result && result.ok ? (
        <p className="mt-2 flex gap-2 text-sm leading-relaxed">
          <span aria-hidden="true" className="shrink-0 text-primary">
            •
          </span>
          <span className="min-w-0 break-words whitespace-pre-line">
            {result.title && <span className="font-semibold">{result.title} — </span>}
            {result.content}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Type the notice to see how it will appear on the dashboard.
        </p>
      )}
    </div>
  );
}

export default function NoticeManager() {
  const { token, expireSession } = useAdmin();
  const notices = useQuery(api.notices.listAll, {});
  const createNotice = useAction(api.noticeActions.createNotice);
  const updateNotice = useAction(api.noticeActions.updateNotice);
  const setActive = useAction(api.noticeActions.setNoticeActive);
  const deleteNotice = useAction(api.noticeActions.deleteNotice);
  const moveNotice = useAction(api.noticeActions.moveNotice);

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<NoticeRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Shared write path: admin session guard + error surfacing (§22). */
  const run = async (
    key: string,
    task: (adminToken: string) => Promise<unknown>,
    success?: string,
  ): Promise<boolean> => {
    if (!token) {
      expireSession();
      return false;
    }
    const adminToken = token;
    setBusyId(key);
    try {
      await task(adminToken);
      if (success) toast.success(success);
      return true;
    } catch (err) {
      const message = errorMessage(err);
      if (message.includes("SESSION_EXPIRED")) {
        expireSession();
        return false;
      }
      toast.error(message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const draftResult = draft.trim() ? normalizeNotice(undefined, draft) : null;
  const draftValid = draftResult !== null && draftResult.ok;

  const editResult = editing?.content.trim()
    ? normalizeNotice(editing.title, editing.content)
    : null;
  const editValid = editResult !== null && editResult.ok;

  const addNotice = () =>
    void run(
      "add",
      (t) => createNotice({ token: t, content: draft, active: true }),
      "Notice added",
    ).then((ok) => {
      if (ok) setDraft("");
    });

  const saveEdit = (editor: Editor) =>
    void run(
      "save",
      (t) =>
        updateNotice({
          token: t,
          id: editor.id,
          title: editor.title.trim() ? editor.title.trim() : undefined,
          content: editor.content,
          active: editor.active,
        }),
      "Notice updated",
    ).then((ok) => {
      if (ok) setEditing(null);
    });

  const toggleActive = (n: NoticeRow) =>
    void run(
      n._id,
      (t) => setActive({ token: t, id: n._id, active: !n.active }),
      n.active ? "Notice deactivated" : "Notice activated",
    );

  const move = (n: NoticeRow, direction: "up" | "down") =>
    void run(n._id, (t) =>
      moveNotice({ token: t, id: n._id, direction }),
    );

  const confirmDelete = (row: NoticeRow) =>
    void run(
      row._id,
      (t) => deleteNotice({ token: t, id: row._id }),
      "Notice deleted",
    );

  if (!notices) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- Header + add form ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
              <Bell className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle className="font-title text-lg tracking-tight">
                Notice Board
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Public announcements shown above Current Programme Progress.
                Only active notices are displayed.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="notice-content">Notice content</Label>
            <Textarea
              id="notice-content"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draftValid)
                  addNotice();
              }}
              placeholder="e.g. PPR vaccination programme is currently in progress."
              rows={3}
              maxLength={MAX_CONTENT_LENGTH}
              className="resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                Line breaks are preserved. A bullet is added automatically.
              </span>
              <span className="tabular-nums">
                {draft.length} / {MAX_CONTENT_LENGTH}
              </span>
            </div>
          </div>

          <NoticePreview title="" content={draft} />

          <Button onClick={addNotice} disabled={!draftValid || busyId !== null}>
            {busyId === "add" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add Notice
          </Button>
        </CardContent>
      </Card>

      {/* ---- List of notices ---- */}
      <Card className="border-border">
        <CardHeader className="space-y-0 pb-3">
          <CardTitle className="font-title text-lg tracking-tight">
            All notices ({notices.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {notices.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              No notices yet. Add the first notice above.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {notices.map((n, index) => (
                <li
                  key={n._id}
                  className="rounded-md border border-border bg-card px-3.5 py-3 sm:px-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                        {n.title && (
                          <span className="font-semibold">{n.title} — </span>
                        )}
                        {n.content}
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span
                          className={
                            n.active
                              ? "rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-primary"
                              : "rounded border border-border bg-muted px-1.5 py-0.5 font-semibold uppercase tracking-wide text-muted-foreground"
                          }
                        >
                          {n.active ? "Active" : "Inactive"}
                        </span>
                        <span className="tabular-nums">
                          #{index + 1} in display order
                        </span>
                        <span>
                          Updated {format(n.updatedAt, "d MMM yyyy, HH:mm")}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Move up"
                        title="Move up"
                        disabled={index === 0 || busyId !== null}
                        onClick={() => move(n, "up")}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label="Move down"
                        title="Move down"
                        disabled={
                          index === notices.length - 1 || busyId !== null
                        }
                        onClick={() => move(n, "down")}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId !== null}
                        onClick={() =>
                          setEditing({
                            id: n._id,
                            title: n.title ?? "",
                            content: n.content,
                            active: n.active,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId !== null}
                        onClick={() => toggleActive(n)}
                      >
                        <Power className="size-4" />
                        {n.active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        disabled={busyId !== null}
                        onClick={() => setDeleting(n)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---- Edit dialog (§20: live preview) ---- */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>Edit notice</DialogTitle>
                <DialogDescription>
                  Changes update the existing notice — no duplicate is
                  created.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-title">Title (optional)</Label>
                  <Input
                    id="edit-title"
                    value={editing.title}
                    onChange={(e) =>
                      setEditing({ ...editing, title: e.target.value })
                    }
                    placeholder="Shown in bold before the notice"
                    maxLength={MAX_TITLE_LENGTH}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-content">Notice content</Label>
                  <Textarea
                    id="edit-content"
                    value={editing.content}
                    onChange={(e) =>
                      setEditing({ ...editing, content: e.target.value })
                    }
                    rows={6}
                    maxLength={MAX_CONTENT_LENGTH}
                    className="resize-y"
                  />
                  <p className="text-right text-[11px] tabular-nums text-muted-foreground">
                    {editing.content.length} / {MAX_CONTENT_LENGTH}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="edit-active"
                    checked={editing.active}
                    onCheckedChange={(checked) =>
                      setEditing({ ...editing, active: checked === true })
                    }
                  />
                  <Label htmlFor="edit-active" className="cursor-pointer">
                    Active — show this notice on the public dashboard
                  </Label>
                </div>

                <NoticePreview title={editing.title} content={editing.content} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!editValid || busyId !== null}
                  onClick={() => saveEdit(editing)}
                >
                  {busyId === "save" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Save changes
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- Delete confirmation ---- */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this notice?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the notice from the database. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) void confirmDelete(deleting);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
