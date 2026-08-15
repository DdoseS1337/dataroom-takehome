"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

/**
 * Naming a room, a folder, or an existing item — the same interaction every time: a
 * name, a conflict rule, one error line. One dialog rather than three files that drift
 * apart.
 *
 * A duplicate name blocks with an inline error and a suggestion rather than silently
 * appending a suffix: in due diligence, `MSA.pdf` quietly becoming `MSA (1).pdf` means
 * someone opens the wrong document and nobody finds out. See docs/data-model.md.
 *
 * When renaming, pass `key={initialName}` so a completed rename resets the field to the
 * new name — the component holds the draft in state, and props alone would not.
 */
export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  initialName = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  /** Pre-fills the field; the extension is left out of the initial selection. */
  initialName?: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Escape and the backdrop close the dialog even mid-request. Without this, the
  // rejection lands after the clear and the next open shows a stale conflict message
  // over an empty field.
  const dismissed = useRef(false);
  /** The stem is selected once, on the first focus — not every time the field regains
   * it, which would fight the user trying to click into the middle of a word. */
  const selected = useRef(false);

  function reset(next: boolean) {
    if (!next) {
      dismissed.current = true;
      selected.current = false;
      setName(initialName);
      setError(null);
      setSuggestion(null);
      setPending(false);
    }
    onOpenChange(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Enter a name.");
      return;
    }
    // Nothing to save. Sending it would succeed and read as a change that happened.
    if (trimmed === initialName) {
      reset(false);
      return;
    }

    dismissed.current = false;
    setPending(true);
    setError(null);
    setSuggestion(null);

    try {
      await onSubmit(trimmed);
      reset(false);
    } catch (caught) {
      if (dismissed.current) return;
      setPending(false);
      if (caught instanceof ApiError && caught.code === "NAME_CONFLICT") {
        setError(caught.message);
        // The server names the candidate it would try next; the local fallback covers
        // an older API answering without one.
        setSuggestion(
          typeof caught.details?.suggestion === "string"
            ? caught.details.suggestion
            : nextAvailable(trimmed),
        );
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Something went wrong. Please try again.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent>
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="name-prompt">{label}</Label>
            <Input
              id="name-prompt"
              autoFocus
              autoComplete="off"
              maxLength={200}
              value={name}
              placeholder={placeholder}
              aria-invalid={error !== null}
              aria-describedby={error ? "name-prompt-error" : undefined}
              onFocus={(event) => {
                if (selected.current || initialName === "") return;
                selected.current = true;
                event.target.setSelectionRange(0, stemLength(initialName));
              }}
              onChange={(event) => {
                setName(event.target.value);
                if (error) setError(null);
              }}
            />
            {error && (
              <p
                id="name-prompt-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
                {suggestion && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => {
                        setName(suggestion);
                        setError(null);
                        setSuggestion(null);
                      }}
                    >
                      Use “{suggestion}” instead
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** `Legal` becomes `Legal (2)`; `Legal (2)` becomes `Legal (3)`. */
function nextAvailable(name: string): string {
  const match = /^(.*) \((\d+)\)$/.exec(name);
  if (match) return `${match[1]} (${Number(match[2]) + 1})`;
  return `${name} (2)`;
}

/**
 * How much of a filename to select on open — everything before the extension, the way
 * every desktop file manager does it. Typing then replaces the part being changed
 * without taking `.pdf` with it, and nothing stops someone who does want it gone.
 */
function stemLength(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
