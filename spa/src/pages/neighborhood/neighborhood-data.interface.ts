export interface NeighborhoodData {
  loaded: boolean,
  hood?: {
    name: string,
    assets_dir: string,
    id: string,
    world_filename: string,
    slug: string
  },
  colony?: {
    name: string,
    assets_dir: string,
    id: string,
    world_filename: string,
    slug: string
  },
  blocks?: [],
  /** The MAP-1 resolved background URL for this hood. Empty until it loads. */
  effectiveUrl?: string
}
