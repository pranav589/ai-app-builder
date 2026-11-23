export type MyProject = {
  id: string
  name: string
  prompt: string | null
  status: string | null
  assetCount: number
  createdAt: string
  themeColor: string | null
  previewScreens: unknown
  isPublic: boolean
  publicSlug: string | null
}

export type PublicProject = {
  id: string
  name: string
  tagline: string | null
  themeColor: string | null
  previewScreens: unknown
  publicSlug: string
}
