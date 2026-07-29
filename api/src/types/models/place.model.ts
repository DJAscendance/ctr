import { Model } from './model';

/** Defines a Place object as stored in the db */
export interface Place extends Model {
  id: number;
  assets_dir?: string;
  /** Administrator-controlled metadata. Never written by an Information editor. */
  description?: string;
  /**
   * Manager/owner-authored public content shown by the Information window.
   * Sanitized on write against the shared allowlist; never written by an
   * administrator surface.
   */
  information?: string;
  name: string;
  slug?: string;
  status: number;
  world_filename?: string;
  type: string;
  map_background_icon?: number;
  map_background_index?: number | null;
  map_icon_index?: number;
  private?: boolean;
  member_id: number;
}
