"use client";

import { LogOutIcon, VaultIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut, useAuth } from "@/lib/auth";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium tracking-tight"
          >
            <VaultIcon className="size-4 text-primary" />
            Data Room
          </Link>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

function UserMenu() {
  const state = useAuth();
  if (state.status !== "signedIn") return null;

  const { user } = state;
  const label = user.name ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-2 pl-1.5">
            <Avatar user={user} />
            <span className="max-w-40 truncate">{label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Avatar({
  user,
}: {
  user: { name: string | null; email: string; avatarUrl: string | null };
}) {
  if (user.avatarUrl) {
    return (
      // Google avatar URLs are already the right size and change per account, so
      // next/image would add a proxy round trip and a remote-host allowlist for no gain.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        className="size-5 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-accent text-[0.65rem] font-medium text-accent-foreground">
      {initial}
    </span>
  );
}
