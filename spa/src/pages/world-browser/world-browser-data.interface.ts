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
}
