import { SiteHeader } from "@/components/home/site-header"
import { PromptBox } from "@/components/home/prompt-box"
import { AppGallery } from "@/components/home/app-gallery"
import { AppFramePreview } from "@/components/home/app-frame-preview"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />

      <main className="flex-1">
        <section className="relative overflow-hidden px-6 pt-24 pb-8 sm:pt-32 lg:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,color-mix(in_oklch,var(--action),transparent_90%),transparent_70%),radial-gradient(color-mix(in_oklch,var(--ink),transparent_90%)_1px,transparent_1px)] bg-[length:auto,24px_24px] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]"
          />

          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-background/80 py-1.5 pr-4 pl-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur">
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                New
              </span>
              Ship to iOS and Android from one prompt
            </span>

            <h1 className="text-5xl leading-[1.02] font-medium tracking-[-0.045em] text-balance sm:text-7xl">
              Turn an idea into a{" "}
              <span className="text-muted-foreground">mobile app</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Describe what you want. Our agent designs, builds and previews a
              real app you can install on your phone.
            </p>

            <div className="mt-12 w-full max-w-3xl">
              <PromptBox />
            </div>
          </div>

          <div className="mx-auto mt-20 max-w-5xl">
            <AppFramePreview />
          </div>
        </section>

        <AppGallery />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-10 sm:flex-row lg:px-10">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Anything. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <a href="#" className="transition-colors hover:text-foreground">Privacy</a>
            <a href="#" className="transition-colors hover:text-foreground">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
