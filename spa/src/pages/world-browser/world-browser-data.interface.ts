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
    // ProximitySensor for the scene that is currently loaded
    proximitySensor: any;
    users: any;
    ROTATE180: any;
    TYPES: any;
    sharedEvent: any;
    eventNodeMap: any;
    sharedObjects: any[];
    sharedObjectsMap: Map<any, any>;
    /** Identifies the active place load; see WorldBrowserPage.vue. */
    worldGeneration: number;
    /** True once the 3D socket handlers have been bound. */
    socket3dListenersBound: boolean;
    showUpdateWarning: boolean;
    mainComponent: any;
    force2d: boolean;
    /* TEMPORARY Outlands compatibility: the member has not picked a side yet,
     * so the entrance screen stays up and ne_game.wrl is not loaded. */
    outlandsTeamNeeded: boolean;
    pet: any;
    clickId: string;
}
