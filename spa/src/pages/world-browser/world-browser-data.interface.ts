import { PresenceStore } from "@/presence";
import { RemoteMemberRegistry } from "@/remote-members";

export interface WorldBrowserData {
    loaded: boolean;
    chatReady: boolean;
    presenceStore: PresenceStore;
    remoteMembers: RemoteMemberRegistry | null;
    loadGeneration: number;
    sharedEventListenerRegistered: boolean;
    worldsData: any;
    avatarsData: any;
    browser: any;
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
    /** The Jail's server-side answer about this citizen, or null outside the Jail. */
    jailStanding: { inmate: boolean; staff: boolean; jailPlaceId: number | null } | null;
    /** Whether the staff door has put this citizen on the cell side of the force field. */
    insideJailCells: boolean;
    /** Outlands asked for, no side worn yet: the historical entrance is up. */
    outlandsTeamNeeded: boolean;
    pet: any;
    clickId: string;
    /** Walk-speed panel: open state and its position inside the world area. */
    walkSpeedOpen: boolean;
    walkSpeedLeft: number;
    walkSpeedTop: number;
    /** Last right-click point inside #world, in viewport coordinates. */
    walkSpeedPointer: { x: number; y: number } | null;
    /** The X_ITE browser the walk-speed menu entry is already installed on. */
    walkSpeedMenuBrowser: any;
}
