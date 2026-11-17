"use client"

import Link from "next/link"
import { Sparkles, Menu as MenuIcon, LogOut, Settings, User } from "lucide-react"

import { Coins } from "lucide-react"
import { useAuth } from "@/components/auth/auth-provider"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet"

const NAV_LINKS = [
  { label: "Community", href: "#community" },
  { label: "Pricing", href: "#pricing" },
  { label: "Docs", href: "#docs" },
]

export function SiteHeader() {
  const { user, isPending, openAuthDialog, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-(--r-sm) bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <span className="text-base font-semibold tracking-tight">Anything</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {isPending ? (
            <div className="h-11 w-44" aria-hidden />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="outline-none">
                <Avatar className="cursor-pointer">
                                    <AvatarFallback>
                    {(user.name ?? user.email).charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="mx-1 mb-1 flex items-center justify-between rounded-md bg-muted px-2 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Coins className="size-3.5" /> Credits
                  </span>
                  <span className="font-medium">{user.credits}</span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <User /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <Button
                variant="ghost"
                className="h-11 rounded-(--r-sm) px-6 text-base"
                onClick={() => openAuthDialog({ mode: "sign-in" })}
              >
                Sign in
              </Button>
              <Button
                className="h-11 rounded-(--r-sm) px-6 text-base"
                onClick={() => openAuthDialog({ mode: "sign-up" })}
              >
                Get started
              </Button>
            </div>
          )}

          <Sheet>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="md:hidden">
                  <MenuIcon />
                </Button>
              }
            />
            <SheetContent side="right" className="w-72">
              <div className="mt-8 flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {link.label}
                  </a>
                ))}
                {!user && (
                  <div className="mt-4 flex flex-col gap-2 px-3">
                    <Button
                      variant="outline"
                      className="h-11 rounded-(--r-sm) text-base"
                      onClick={() => openAuthDialog({ mode: "sign-in" })}
                    >
                      Sign in
                    </Button>
                    <Button
                      className="h-11 rounded-(--r-sm) text-base"
                      onClick={() => openAuthDialog({ mode: "sign-up" })}
                    >
                      Get started
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
