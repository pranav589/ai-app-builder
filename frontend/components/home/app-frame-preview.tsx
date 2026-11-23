import {
  Activity,
  Bell,
  ChefHat,
  Flame,
  Home,
  Plus,
  Receipt,
  Search,
  User,
  Wallet,
} from "lucide-react"

function Phone({
  className = "",
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={`w-[240px] shrink-0 rounded-[36px] border border-border bg-card p-2.5 shadow-[0_30px_60px_-20px_rgba(17,17,17,0.25),0_0_0_1px_rgba(17,17,17,0.04)] ${className}`}
    >
      <div className="overflow-hidden rounded-[28px] bg-(--surface)">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-foreground/10" />
        {children}
      </div>
    </div>
  )
}

function Row({
  icon: Icon,
  title,
  meta,
  done,
}: {
  icon: typeof Flame
  title: string
  meta: string
  done?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-background p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-9 items-center justify-center rounded-xl ${
            done ? "bg-primary text-primary-foreground" : "bg-(--surface) text-foreground"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <div className="text-left">
          <p className="text-[13px] font-medium leading-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground">{meta}</p>
        </div>
      </div>
      <span
        className={`size-4 rounded-full border ${
          done ? "border-primary bg-primary" : "border-border"
        }`}
      />
    </div>
  )
}

export function AppFramePreview() {
  return (
    <div className="relative">
      <div className="flex items-end justify-center gap-5 [mask-image:linear-gradient(to_bottom,black_70%,transparent)] sm:gap-8">
        <Phone className="mb-0 hidden translate-y-10 md:block">
          <div className="space-y-2.5 p-4 pb-20">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold tracking-tight">Wallet</p>
              <Search className="size-4 text-muted-foreground" />
            </div>
            <div className="rounded-2xl bg-foreground p-4 text-background">
              <p className="text-[11px] opacity-60">Total balance</p>
              <p className="mt-1 text-2xl font-medium tracking-tight">$4,820.50</p>
            </div>
            <Row icon={Receipt} title="Groceries" meta="Today, 9:12" />
            <Row icon={Wallet} title="Salary" meta="Yesterday" done />
            <Row icon={Receipt} title="Gym" meta="Mon" />
          </div>
        </Phone>

        <Phone>
          <div className="space-y-2.5 p-4 pb-20">
            <div className="flex items-center justify-between">
              <div className="text-left">
                <p className="text-[11px] text-muted-foreground">Good evening</p>
                <p className="text-base font-semibold tracking-tight">Your streaks</p>
              </div>
              <span className="flex size-8 items-center justify-center rounded-full bg-background shadow-sm">
                <Bell className="size-3.5" />
              </span>
            </div>
            <Row icon={Flame} title="Morning run" meta="12 day streak" done />
            <Row icon={Activity} title="Read 10 pages" meta="4 day streak" />
            <Row icon={Flame} title="Meditate" meta="2 day streak" />
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-[13px] font-medium text-primary-foreground shadow-sm"
            >
              <Plus className="size-3.5" /> New habit
            </button>
          </div>
        </Phone>

        <Phone className="hidden translate-y-10 md:block">
          <div className="space-y-2.5 p-4 pb-20">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold tracking-tight">Recipes</p>
              <User className="size-4 text-muted-foreground" />
            </div>
            <div className="flex h-24 items-end rounded-2xl bg-background p-3 shadow-sm">
              <div className="text-left">
                <p className="text-[13px] font-medium">Weeknight pasta</p>
                <p className="text-[11px] text-muted-foreground">25 min · 4 servings</p>
              </div>
            </div>
            <Row icon={ChefHat} title="Shakshuka" meta="20 min" />
            <Row icon={ChefHat} title="Miso soup" meta="10 min" />
            <Row icon={Home} title="Grocery list" meta="12 items" done />
          </div>
        </Phone>
      </div>
    </div>
  )
}
