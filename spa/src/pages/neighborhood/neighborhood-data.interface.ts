/**
 * One block on the neighborhood map, with exactly the fields
 * `GET /hood/:id/blocks` returns and the map draws.
 */
export interface NeighborhoodBlock {
  id: number,
  name: string,
  /** The 1-30 cell this block occupies in the map grid. */
  location: number
}

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
  blocks?: NeighborhoodBlock[],
  /** The MAP-1 resolved background URL for this hood. Empty until it loads. */
  effectiveUrl?: string
}
