import Vue from "vue";
import {
    clampMovementSpeed,
    MOVEMENT_SPEED_STORAGE_KEY,
} from "./helpers/movement-speed.helper";

/** Represents the shape of user data object on the global app store */
export interface User {
    id?: number;
    avatar?: {
        id: string;
        name: string;
        filename: string;
        gestures: string[];
    };
    roleName?: string;
    username?: string;
    token?: string;
    admin?: boolean;
    hasHome?: boolean;
    chatdefault?: number;
    firstname?: string;
}

/**
 * The gameplay avatar an Outlands visit is being played with.
 *
 * Deliberately NOT part of {@link User}: it is temporary gameplay state, not
 * the citizen's identity. It is never written to localStorage, never sent to
 * the server as an avatar change, and it is gone on a reload - which returns
 * the citizen to the Outlands entrance to choose again. Only the Outlands
 * runtime reads it; everywhere else the citizen is their own avatar.
 */
export interface OutlandsAvatar {
    id: number;
    filename: string;
    directory: string;
    team: number;
}

export interface Place {
    assets_dir?: string;
    block?: any;
    hood?: any;
    colony?: any;
    created_at?: string;
    description?: string;
    id?: number | string;
    map_background_index?: string;
    map_icon_index?: string;
    member_id?: number;
    name?: string;
    slug?: string;
    status?: number;
    type?: string;
    updated_at?: string;
    world_filename?: string;
}

/** Represents the shape of the global app store object */
export interface AppStore {
    data: {
        bid: number;
        loading: boolean;
        isUser: boolean;
        x3dReady: boolean;
        user: User;
        view3d: boolean;
        place: Place;
        outlandsAvatar: OutlandsAvatar | null;
        /**
         * Local-only walk-speed preference. Never sent to the server: a guest,
         * or a citizen on a fresh device, must move at the CTR default without
         * an account record to read, so this lives in localStorage exactly like
         * `token` does, not on the {@link User}.
         */
        movementSpeedMultiplier: number;
    };
    methods: {
        destroySession: () => void;
        setToken: (token: string) => void;
        setView3d: (value: boolean) => void;
        setPlace: (value: Place) => void;
        setUser: (userData: object) => void;
        setBid: (bid: number) => void;
        /*
         * `unknown`, not `number`: the raw DOM string off a slider or a number
         * box arrives here untouched, and `clampMovementSpeed` below is the one
         * place that decides what a value means. Parsing at each call site is
         * how two controls drift apart.
         */
        // eslint-disable-next-line no-unused-vars
        setMovementSpeedMultiplier: (value: unknown) => void;
        /* Base no-unused-vars cannot see TS type params; same as the five above. */
        // eslint-disable-next-line no-unused-vars
        setOutlandsAvatar: (avatar: OutlandsAvatar | null) => void;
    };
}

const appStore = Vue.observable<AppStore>({
    data: {
        bid: 0,
        loading: false,
        isUser: false,
        x3dReady: false,
        view3d: false,
        user: {
            token: localStorage.getItem("token"),
        },
        place: {},
    outlandsAvatar: null,
        movementSpeedMultiplier: clampMovementSpeed(localStorage.getItem(MOVEMENT_SPEED_STORAGE_KEY)),
    },
    methods: {
        destroySession() {
            localStorage.removeItem("token");
            appStore.data.user = {};
            appStore.data.isUser = false;
      appStore.data.outlandsAvatar = null;
        },
        setToken(token: string): void {
            appStore.data.user.token = token;
            localStorage.setItem("token", token);
        },
        setView3d(value: boolean): void {
            appStore.data.view3d = value;
        },
        setPlace(placeData: Place): void {
            appStore.data.place = placeData;
        },
        setUser(userData: User): void {
            if (
                typeof userData.avatar !== "undefined" &&
                typeof userData.avatar.gestures === "string" &&
                userData.avatar.gestures !== ""
            ) {
                userData.avatar.gestures = JSON.parse(userData.avatar.gestures);
            }
            appStore.data.user = { ...appStore.data.user, ...userData };
            if (appStore.data.user.chatdefault === 1) {
                appStore.data.view3d = true;
            }
        },
        setBid(bid: number): void {
            localStorage.setItem("bid", bid.toString());
        },
        /**
         * Clamps before it ever reaches state or storage, so a corrupt or
         * out-of-range value (including one edited directly into localStorage)
         * can never propagate to the viewer.
         */
        setMovementSpeedMultiplier(value: unknown): void {
            const clamped = clampMovementSpeed(value);
            appStore.data.movementSpeedMultiplier = clamped;
            localStorage.setItem(MOVEMENT_SPEED_STORAGE_KEY, clamped.toString());
        },
    /*
     * Puts on, or takes off, the Outlands gameplay avatar. In memory only:
     * no localStorage, no cookie, no token, and nothing merged into
     * `data.user`, so the citizen's identity and their own avatar are
     * untouched and another tab of the same account never sees this.
     */
    setOutlandsAvatar(avatar: OutlandsAvatar | null): void {
      appStore.data.outlandsAvatar = avatar;
    },
    },
});
export default appStore;
