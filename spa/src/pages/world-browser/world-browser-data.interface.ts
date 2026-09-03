export interface WorldBrowserData {
    loaded: boolean;
    worldsData: any;
    avatarsData: any;
    browser: any;
    uniqValue: number;
    place?: {
        name: string;
        assets_dir: string;
        id: string;
        world_filename: string;
        slug: string;
    };
    position: [number, number, number];
    rotation: [number, number, number, number];
    users: any;
    ROTATE180: any;
    TYPES: any;
    sharedEvent: any;
    eventNodeMap: any;
    sharedObjects: any[];
    sharedObjectsMap: Map<any, any>;
    showUpdateWarning: boolean;
    mainComponent: any;
    force2d: boolean;
    pet: any;
    clickId: string;
    /** OUTLANDS-2A. True while the Outlands entrance holds back the world. */
    showOutlandsEntrance: boolean;
    /** OUTLANDS-2A. The picked free-play avatar key, or `null` before a pick. */
    outlandsAvatarKey: string | null;
    /** OUTLANDS-2A. True while Outlands holds the 3D path open for itself. */
    force3d: boolean;
    /**
     * OUTLANDS-2B. Which Outlands path this visit is on, or `null` outside
     * Outlands. It chooses the world file and the socket session, and nothing
     * else reads it.
     */
    outlandsMode: "free" | "match" | null;
    /**
     * OUTLANDS-2B. The one generic refusal shown after a rejected match
     * password. Never carries a team, a hint or a server message.
     */
    outlandsMatchError: string;
    /** OUTLANDS-2B. True while a match password is being checked. */
    outlandsMatchBusy: boolean;
}
