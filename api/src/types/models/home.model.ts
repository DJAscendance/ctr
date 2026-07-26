
/** Defines a Home stored in the db */
export interface Home {
  place_id: number,
  home_design_id: string,
  image?: string,
  /** Moderation state of the uploaded image: 'none' | 'pending' | 'approved' | 'rejected' */
  image_status?: string,
  image_checked_by?: number,
  image_checked_at?: Date,
  /** Unguessable token identifying the current image revision; binds approval to the exact
   * uploaded image a moderator reviewed. Null when there is no current image. */
  image_revision?: string,
}
