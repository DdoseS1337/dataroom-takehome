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
 * Creating a room and creating a folder are the same interaction — a name, a
 * conflict rule, one error line — so they share a dialog rather than two files that
 * drift apart.
 *
 * A duplicate name blocks with an inline error and a suggestion rather than silently
 * appending a suffix: in due diligence, `MSA.pdf` quietly becoming `MSA (1).pdf` means
 * someone opens the wrong document and nobody finds out. See docs/data-model.md.
 */
export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Escape and the backdrop close the dialog even mid-request. Without this, the
  // rejection lands after the clear and the next open shows a stale conflict message
  // over an empty field.
  const dismissed = useRef(false);

  function reset(next: boolean) {
    if (!next) {
      dismissed.current = true;
      setName("");
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
        setSuggestion(nextAvailable(trimmed));
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
