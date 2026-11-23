"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function WorkspaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-medium tracking-[-0.03em]">We couldn&apos;t load your workspace</h1>
      <p className="max-w-md text-muted-foreground">
        This is usually a brief connection problem and your project is safe. Try again in a moment.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset} className="h-11 rounded-(--r-md) px-6 text-base">
          Try again
        </Button>
        <Button variant="outline" className="h-11 rounded-(--r-md) px-6 text-base" nativeButton={false} render={<Link href="/" />}>
          Back to home
        </Button>
      </div>
    </div>
  )
}
