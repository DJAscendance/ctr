<template>
  <div class="h-full w-full bg-black flex flex-col">
    <div class="flex items-center update-warning bg-lines p-1" v-if="showUpdateWarning">
      <strong>
        New Update Available!
        &nbsp;
        <a @click="reloadWindow">
          Please Reload
        </a>
      </strong>
    </div>
    <div id="world" class="world w-full flex-1" style="" v-show="this.$store.data.view3d && !force2d"></div>
    <div v-show="!this.$store.data.view3d || force2d" class="w-full flex-1">
      <component :is="mainComponent"></component>
    </div>
    <div class="flex flex-none h-1/3 bg-chat">
      <chat
        ref="chat"
        v-if="chatReady"
        :place="place"
        :presence-store="presenceStore"
        :shared-event="sharedEvent"
        :shared-objects="sharedObjects"
        :clickId="clickId"
        @move-object="moveObject"
        @beam-to="beamTo"
        @drop-object="dropObject"
        @pickup-object="pickupObject"
        @add-pet="addPet"
        @pet-beam="beamPet"
      ></chat>
    </div>
  </div>
</template>

<script lang="ts">
// X_ITE publishes its runtime as the browser global X3D; it is loaded from the
// CDN in spa/public/index.html, not imported, so declare it for the linter.
/* global X3D */

import Vue from "vue";

import * as avatarsDataJson from "../../libs/data/avatars.json";
import * as worldDataJson from "../../libs/data/worlds.json";
import Chat from "../../components/Chat.vue";
import {
  debugMsg,
  environment,
} from "@/helpers";
import { PresenceStore, Presence, presenceKey, isSelfPresence, isPresenceEventForRoom, avTransformPayload } from "@/presence";
import { RemoteMemberRegistry } from "@/remote-members";
import { createSharedEventCodecs } from "@/helpers/shared-event.helper";
import { sharedEventNodes } from "../../libs/shared-events";
import { releaseWorldScripts } from "@/libs/world-scripts";
import { WorldBrowserData } from "./world-browser-data.interface";

export default Vue.extend({
  name: "WorldBrowserPage",
  components: { Chat },
  data: (): WorldBrowserData => {
    return {
      loaded: false,
      chatReady: false,
      presenceStore: new PresenceStore(),
      // The Outlands-facing view of presenceStore: remote citizens only, keyed by
      // logical presence key, plus the node<->citizen binding a weapon ray needs.
      // It owns no state of its own - presenceStore stays authoritative.
      remoteMembers: null,
      loadGeneration: 0,
      sharedEventListenerRegistered: false,
      worldsData: worldDataJson,
      avatarsData: avatarsDataJson,
      browser: null,
      place: undefined,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 0],
      users: {},
      ROTATE180: null,
      TYPES: {},
      sharedEvent: null,
      eventNodeMap: null,
      sharedObjects: [],
      sharedObjectsMap: undefined,
      showUpdateWarning: false,
      mainComponent: null,
      force2d: false,
      pet: null,
      clickId: null,
    };
  },
  methods: {
    addPet(data): void {
      let userPosition = this.position;
      let userRotation = this.rotation;
      let distance = 5;
      const pos = new X3D.SFVec3f(...userPosition);
      const rot = new X3D.SFRotation(...userRotation);
      const pos_offset = rot.multVec(new X3D.SFVec3f(0-1.5, 0, -distance));
      pos_offset.y = 0;
      const newPosition = pos.add(pos_offset);
      const newOrientation = new X3D.SFRotation(0, 1, 0, Math.atan2(pos_offset.x, pos_offset.z));
      let petData = {
        url: data.url,
        name: data.name,
        id: data.id,
        position: newPosition,
        rotation: newOrientation,
      };
      setTimeout(() => {
        this.loadPetData(petData);
      }, 2000)
    },
    loadPetData(data) {
      const browser = X3D.getBrowser(this.browser);
      const pet = browser.currentScene.createProto("SharedObject");
      pet.name = data.name;
      pet.id = data.id;
      pet.translation = new X3D.SFVec3f(
        data.position.x,
        data.position.y,
        data.position.z,
      );
      pet.rotation = new X3D.SFRotation(
        data.rotation.x,
        data.rotation.y,
        data.rotation.z,
        data.rotation.angle + 3.15,
      );
      const inline = browser.currentScene.createNode("Inline");
      inline.url = new X3D.MFString(data.url);
      pet.children[0] = inline;
      browser.currentScene.addRootNode(pet);
      this.pet = pet;
    },
    beamPet(data){
      X3D.getBrowser(this.browser).currentScene.removeRootNode(this.pet);
      let userPosition = this.position;
      let userRotation = this.rotation;
      let distance = 4;
      const pos = new X3D.SFVec3f(...userPosition);
      const rot = new X3D.SFRotation(...userRotation);
      const pos_offset = rot.multVec(new X3D.SFVec3f(0, 0, -distance));
      pos_offset.y = 0;
      const newPosition = pos.add(pos_offset);
      const newOrientation = new X3D.SFRotation(0, 1, 0, Math.atan2(pos_offset.x, pos_offset.z));
      let petData = {
        url: data.url,
        name: data.name,
        id: data.id,
        position: newPosition,
        rotation: newOrientation,
      };
      this.loadPetData(petData);
    },
    addSharedObject(obj, browser): void {
      obj.url = `/assets/object/${obj.directory}/${obj.filename}`;
      if (obj.position == null) {
        obj.position = {
          x: 0,
          y: 0,
          z: 0,
        };
      } else {
        obj.position = JSON.parse(obj.position);
      }

      if (obj.rotation == null) {
        obj.rotation = {
          x: 0,
          y: 0,
          z: 0,
          angle: 0,
        };
      } else {
        obj.rotation = JSON.parse(obj.rotation);
      }

      const sharedObject = browser.currentScene.createProto("SharedObject");
      sharedObject.name = obj.name;
      sharedObject.id = obj.id;
      sharedObject.translation = new X3D.SFVec3f(
        obj.position.x,
        obj.position.y,
        obj.position.z,
      );
      sharedObject.rotation = new X3D.SFRotation(
        obj.rotation.x,
        obj.rotation.y,
        obj.rotation.z,
        obj.rotation.angle,
      );
      const inline = browser.currentScene.createNode("Inline");
      inline.url = new X3D.MFString(obj.url);
      sharedObject.children[0] = inline;
      browser.currentScene.addRootNode(sharedObject);
      sharedObject.addFieldCallback({}, "newPosition", (pos) => {
        this.saveObjectLocation(obj.id);
      });
      sharedObject.addFieldCallback({}, "newRotation", (rot) => {
        this.saveObjectLocation(obj.id);
      });
      sharedObject.addFieldCallback({}, "touchTime", (_t) => {
        if(obj.id){
          if(obj.id === this.clickId){
            this.clickId = null;
          } else {
            this.clickId = obj.id;
          }
        } else {
          this.clickId = null;
        }
      });
      this.sharedObjectsMap.set(obj.id, sharedObject);
    },
    debugMsg,
    async getPlace(): Promise<void> {
      this.debugMsg("get place");
      document.title = `${this.$store.data.place.name  } - Cybertown`;
      let objectResponse = null;
      this.sharedObjects = [];
      try {
        if(this.$store.data.place.type === "shop"){
          const objectResponse = await this.$http.get(`/mall/objects/${this.$store.data.place.id}`);
          objectResponse.data.objects.forEach(obj => {
            if(obj.status === 1){
              this.sharedObjects.push(obj);
            }
          });
        } else {
          objectResponse = await this.$http.get(`/place/${  this.$store.data.place.id 
          }/object_instance`);
          this.sharedObjects = objectResponse.data.object_instance;
        }
      } catch(e) {
        console.error(e);
      }
    },
    async loadAndJoinPlace(): Promise<void> {
      // Bumped once per call, so a load superseded by a later one (rapid
      // repeated navigation) can tell its own now-stale continuations not
      // to touch state a newer load already owns.
      const generation = ++this.loadGeneration;

      this.loaded = false;
      this.chatReady = false;
      this.force2d = false;

      if (this.$store.data.place) this.$socket.leaveRoom(this.$store.data.place.id);
      // Fresh presence state and avatar tracking per place - nothing from
      // the previous room's roster/avatars should leak into the one we're
      // about to join, and stale `loading`/`loaded` flags for a presence
      // key seen in a previous room must not suppress a real render here.
      this.presenceStore = new PresenceStore();
      this.clearRenderedPresences();
      this.attachRemoteMembers();
      await this.getPlace();
      if (this.loadGeneration !== generation) return;

      if(this.$store.data.place.slug === "clubdir"){
        this.force2d = true;
      }

      if(this.$route.params.username){
        if(this.$store.data.place.assets_dir === null) {
          this.force2d = true;
        }
      }

      // Room membership (JOIN) and Chat readiness no longer wait on X_ITE -
      // only avatar rendering needs the 3D scene to exist. AV/AV:new/AV:del
      // events for this room can now arrive before X_ITE initializes; they
      // flow into presenceStore (see startSocketListeners) and are drained
      // into the scene once it's ready (see startAvatarRenderer).
      try {
        await this.joinPlace();
      } catch (err) {
        console.error("Failed to join place:", err);
        return;
      }
      if (this.loadGeneration !== generation) return;
      this.chatReady = true;

      if(this.$store.data.view3d && !this.force2d) {
        /*
         * The old world is not replaced here. X_ITE 16.2.0 keeps one active
         * replaceWorld slot: startX3D()'s loadURL() chains into its own
         * replaceWorld(scene), which evicts whatever is waiting in that slot
         * and rejects it with "Replacing world aborted.". An explicit
         * replaceWorld(null) on this path was always the evicted one, so every
         * 3D-to-3D change raised that rejection for a replacement that bought
         * nothing - loadURL's own replacement tears the old world down. The 2D
         * branch below still needs it, because nothing supersedes it there.
         */
        /*
         * A world that genuinely fails is reported, not swallowed and not left
         * unhandled. loadAndJoinPlace is called from route and store watchers
         * that do not await it, so a rejection escaping here becomes an
         * unhandled promise rejection and the member is left on a blank page
         * with nothing in the console naming the world. A supersession is not a
         * failure and never reaches this branch - startX3D resolves those.
         */
        let browser;
        try {
          browser = await this.startX3D(generation);
        } catch (error) {
          console.error("the world failed to load", error);
          return;
        }
        if (this.loadGeneration !== generation) return;
        // A superseded run settles with null rather than a browser.
        if (!browser) return;
        this.startX3DListeners(browser, generation);
        this.loaded = true;
      } else {
        /*
         * Leaving 3D with no world load behind it. This is the teardown the 3D
         * branch above hands to loadURL; on this path there is no loadURL, so
         * the old world is only released if it is asked for here.
         */
        if(this.browser) {
          const browser = X3D.getBrowser(this.browser);
          /* The 3D branch releases the outgoing world inside startX3D(), before
           * its loadURL. This branch has no loadURL, so the same release is
           * asked for here - and, like there, before the world is replaced,
           * while browser.currentScene still names it. */
          this.releaseWorldScriptState(browser);
          browser.replaceWorld(null);
        }

        if(this.$store.data.place.type === "shop"){
          this.mainComponent = () => import(
            "@/components/place/mall/main2d.vue"
          );
        } else if(this.$store.data.place.type === "club"){
          this.mainComponent = () => import(
            "@/components/place/club/main2d.vue"
          );
        } else {
          this.mainComponent = () => import(
            `@/components/place/${this.$store.data.place.slug}/main2d.vue`
          );
        }
        this.loaded = true;
      }
    },
    async unloadPlace(): Promise<void> {
      ++this.loadGeneration;
      if (this.$store.data.place) this.$socket.leaveRoom(this.$store.data.place.id);
      this.presenceStore = new PresenceStore();
      this.clearRenderedPresences();
      this.attachRemoteMembers();
      if (this.browser) {
        const browser = X3D.getBrowser(this.browser);
        /* Before the replacement, not after: releaseWorldScriptState names the
         * outgoing world through browser.currentScene, and replaceWorld has
         * already put an empty scene there by the time it returns. */
        this.releaseWorldScriptState(browser);
        browser.replaceWorld(null);
      }
    },
    async joinPlace(): Promise<void> {
      await this.$socket.joinRoom(this.$store.data.place.id, this.$store.data.user.token);
      this.debugMsg("joined room success", this.$store.data.place.id);
    },
    /** Announces our own current viewpoint once X_ITE has one to report. Also
     * replayed after a reconnect resync so a restarted socket server relearns
     * our real stationary position without waiting for us to move. */
    sendInitialViewpoint(): void {
      if(this.$store.data.view3d){
        const { viewpointPosition, viewpointOrientation } = X3D.getBrowser(this.browser);
        // Emit the transform TOP-LEVEL (pos/rot), matching the movement watchers
        // and what the server (`msg.pos`/`msg.rot`) and peers (`onPresenceMoved`)
        // actually consume. A `detail`-wrapped payload is silently ignored by
        // both, so a reconnect-driven resend would never restore a stationary
        // user's position on peers (they'd wait for real movement).
        this.$socket.sendAv(avTransformPayload(
          [viewpointPosition.x, viewpointPosition.y, viewpointPosition.z],
          [viewpointOrientation.x, viewpointOrientation.y, viewpointOrientation.z, viewpointOrientation.angle],
        ), { reliable: true }); // one-shot recovery packet - must not be dropped
      }
    },
    moveObject(objectId): void {
      this.sharedObjectsMap.get(objectId).startMove = true;
    },
    async dropObject(objectId): Promise<void> {
      const browser = X3D.getBrowser();
      const d = 4;
      const pos = new X3D.SFVec3f(...this.position);
      const rot = new X3D.SFRotation(...this.rotation);
      const pos_offset = rot.multVec(new X3D.SFVec3f(0, 0, -d));
      pos_offset.y = 0;
      const dropPosition = pos.add(pos_offset);
      const dropRotation= new X3D.SFRotation(0, 1, 0, Math.atan2(pos_offset.x, pos_offset.z));
      /*
       * Read through the public accessors, not through an internal holder.
       * X_ITE 4 and 15 kept the numbers on an internal `_value` holder whose
       * members were the underscored `x_` / `y_` / `z_`; 16.2.0 removed it, so
       * `dropPosition._value` is undefined and every coordinate would be sent
       * as null. `.x` / `.y` / `.z` / `.angle` are the accessors on every
       * version, and they are what the saved placement is read back through.
       */
      const request = await this.$http.post(`/object_instance/${  objectId  }/drop`, {
        placeId: this.$store.data.place.id,
        position: {
          x: dropPosition.x,
          y: dropPosition.y,
          z: dropPosition.z,
        },
        rotation: {
          x: dropRotation.x,
          y: dropRotation.y,
          z: dropRotation.z,
          angle: dropRotation.angle + Math.PI,
        },
      });
      this.sharedObjects.push(request.data.object_instance);
      this.addSharedObject(request.data.object_instance, browser);
      this.$socket.emit("SO", {
        event: "add",
        objectId: objectId,
      });
    },
    async pickupObject(objectId): Promise<void> {
      // update db location
      await this.$http.post(`/object_instance/${  objectId  }/pickup`);

      // remove to the scene 
      if(this.$store.data.view3d) {
        const browser = X3D.getBrowser();
        const object = this.sharedObjectsMap.get(objectId);
        browser.currentScene.removeRootNode(object);
        this.sharedObjectsMap.delete(objectId);
      }
    
      this.sharedObjects = this.sharedObjects.filter(obj => obj.id != objectId);
      this.$socket.emit("SO", {
        event: "remove",
        objectId: objectId,
      });
    },
    beamTo(id): void {
      let target;
      let position;
      let rotation;
      let objectSelected = false;
      // Checks to see if the id only consists of numbers 
      // This identifies object_instance selection from user av selection.
      // Object_instance id's only use numbers while user av id's use letters and numbers.
      if(/^[0-9]+$/.test(id)){
        objectSelected = true;
        target = this.sharedObjectsMap.get(id);
        /*
         * Same removed `_value` holder as dropObject. It used to be enumerable,
         * so Object.values() read the components straight off it; on 16.2.0 it
         * does not exist and both lists came back empty, which beamed the
         * citizen to nowhere.
         *
         * The angle is dropped here because the SFRotation is rebuilt from the
         * axis below - that is what the trailing pop() used to do.
         */
        position = [target.translation.x, target.translation.y, target.translation.z];
        rotation = [target.rotation.x, target.rotation.y, target.rotation.z];
      } else {
        target = this.users[id];
        position = target.transform.pos;
        rotation = target.transform.rot;
      }
      if(target && position && rotation) {
        let distance;
        const browser = X3D.getBrowser(this.browser);
        if(!browser.currentScene) {
          return;
        }
        try {
          if(objectSelected === true){
            distance = browser.currentScene?.getNamedNode("SharedZone")?.beamToDistance ?? -4; 
          } else {
            distance = browser.currentScene?.getNamedNode("SharedZone")?.beamToDistance ?? 3;
          }
          
        } catch(e) {
          distance = 3;
        }
        const pos = new X3D.SFVec3f(...position);
        const rot = new X3D.SFRotation(...rotation);
        const pos_offset = rot.multVec(new X3D.SFVec3f(0, 0, -distance));
        pos_offset.y = 0;
        const viewpoint = browser.currentScene.createNode("Viewpoint");
        browser.currentScene.addRootNode(viewpoint);
        viewpoint.position = pos.add(pos_offset);
        // orientation math:
        // The destination avatar is, relative to us, at the negation of pos_offset
        // Math.atan2(y, x) gives the angle to face (x, y) if 0 angle is facing x
        // We want x = our -z to be 0 and y = our left = our -x. So, Math.atan(-x, -z)
        // Negating pos_offset gives Math.atan2(pos_offset.x, pos_offset.z)
        viewpoint.orientation = new X3D.SFRotation(0, 1, 0, Math.atan2(pos_offset.x, pos_offset.z));
        viewpoint.set_bind = true;
        viewpoint.addFieldCallback({}, "isBound", (value) => {
          if(!value) {
            browser.currentScene.removeRootNode(viewpoint);
            viewpoint.dispose();
          }
        });
      }
    },
    /**
     * Renders a presence's avatar for the first time. Called both when
     * draining presenceStore at X_ITE-ready time and for live "add" events
     * that arrive afterward - either way the presence object already
     * carries whatever transform is currently known, so there's no need to
     * wait for a separate "moved" event to position it correctly.
     */
    async renderPresenceAdded(presence: Presence): Promise<void> {
      const key = presenceKey(presence.memberId, presence.presenceId);
      const ROTATE180 = new X3D.SFRotation(0, 1, 0, Math.PI);

      /*
       * Build one remote citizen's scene graph and wait for its model.
       *
       * The LoadSensor this used to watch is X3D-only, and X_ITE 16 refuses it
       * in a VRML97 scene, so there is no VRML97-legal load event left to use -
       * Inline exposes neither isLoaded nor loadState. The Inline is therefore
       * attached, which is what starts the fetch, and its own scene is polled
       * for content. The wait is bounded: a model that never arrives settles as
       * a failure rather than leaving the citizen half-added.
       */
      const loadInlineAsync = (browser, url, onAttached) => {
        const inline = browser.currentScene.createNode("Inline");
        inline.url = new X3D.MFString(url);

        /*
         * The citizen goes into the scene inside a Collision node with `collide`
         * FALSE, not as a bare root node.
         *
         * X_ITE's WALK viewer collides the local camera against every solid
         * thing in the scene, and a remote citizen added as a root Inline is one
         * of them. Two citizens on the same spawn viewpoint therefore stand
         * inside one another and neither can walk forward. The Mall and the Club
         * have no RandomEntry script, so there every pair of citizens shares the
         * spawn and this is not a matter of luck.
         *
         * `collide FALSE` takes the subtree out of the collision test and
         * nothing else: the citizen is still drawn, still moved by their
         * presence transform, and - because the wrapper is the node this page
         * binds to their presence key - still found by a ray. The Inline is
         * attached only through the wrapper, which is enough to start the fetch.
         */
        const collision = browser.currentScene.createNode("Collision");
        collision.collide = false;
        collision.children = [inline];
        browser.currentScene.addRootNode(collision);
        // The nodes exist and are attached now; the caller records them straight
        // away so a citizen who leaves mid-load can still be cleaned up.
        if (onAttached) onAttached({ collision, inline });

        /* The loaded content sits on the concrete node behind X_ITE 16's SAI
         * facade, found by capability rather than by symbol position, the same
         * way bxx_rayhit.js reaches a node's geometry. */
        const concrete = (node) => {
          for (const symbol of Object.getOwnPropertySymbols(node)) {
            const value = node[symbol];
            if (value && typeof value === "object"
              && typeof value.getInternalScene === "function") return value;
          }
          return null;
        };

        const internal = concrete(inline);
        return new Promise<any>((resolve, reject) => {
          if (!internal) {
            reject(new Error("Inline has no reachable internal scene"));
            return;
          }
          let waited = 0;
          const step = 100;
          const limit = 20000;
          const tick = () => {
            const scene = internal.getInternalScene();
            if (scene && scene.rootNodes && scene.rootNodes.length) {
              resolve({ inline, collision, scene });
              return;
            }
            waited += step;
            if (waited >= limit) {
              reject(new Error(`avatar model did not load: ${url}`));
              return;
            }
            setTimeout(tick, step);
          };
          setTimeout(tick, step);
        });
      };

      const browser = X3D.getBrowser(this.browser);

      if (!this.users[key]) {
        this.users[key] = {};
      }

      if (this.users[key].loading || this.users[key].loaded) {
        return;
      }

      if (presence.pos || presence.rot) {
        this.users[key].transform = {
          pos: presence.pos,
          rot: presence.rot,
        };
      }

      const { directory, filename } = presence.avatar;
      const avURL = `/assets/avatars/${directory}/${filename}`;

      this.users[key].loading = true;
      /*
       * The wrapper is in the scene from the moment loadInlineAsync builds it -
       * attaching it is what starts the fetch - so the entry has to know about
       * it before the model arrives. Recorded here rather than on resolve,
       * because a citizen who leaves (or a world that changes) while their model
       * is still in flight would otherwise be cleaned up against an entry that
       * names no node, and the half-built wrapper would stay in the scene for
       * the life of the world.
       */
      loadInlineAsync(browser, avURL, (nodes) => {
        if (this.users[key]) Object.assign(this.users[key], nodes);
      }).then(({ inline: avInline, scene: avScene, collision }) => {
        // The presence may have left (authoritative reconciliation removed
        // it) or already been rendered by a racing call while this model
        // was in flight - in either case `this.users[key]` is no longer the
        // same "still loading" entry we started with, so the completed
        // model must never be left in the scene.
        if (!this.users[key] || this.users[key].loading !== true) {
          this.detachRemoteNodes(browser, { collision, inline: avInline });
          return;
        }
        /*
         * The node that carries the citizen: their position, their facing and
         * their gestures.
         *
         * This used to be reached with updateImportedNode(inline, "Avatar") /
         * getImportedNode. X3D's IMPORT only binds to a node the inlined scene
         * has EXPORTed, and EXPORT is X3D syntax that no VRML97 avatar can
         * carry - so X_ITE 16 hands back a stub. The stub has the right shape,
         * accepts `set_position` without complaint, and drops it: every citizen
         * in the room would stand at the world origin, whatever their presence
         * transform said.
         *
         * The avatar's own scene is reachable, so the node is taken from there
         * instead: the DEF'd `Avatar` when the file has one, and the scene's
         * first root node otherwise, which is the same node in an avatar whose
         * whole content is one Avatar PROTO instance.
         */
        const avatarNode = (() => {
          try {
            const named = avScene.getNamedNode("Avatar");
            if (named) return named;
          } catch (error) { /* not every avatar DEFs it */ }
          return avScene.rootNodes[0];
        })();
        this.users[key].loading = false;
        this.users[key].loaded = true;
        this.users[key]["inline"] = avInline;
        this.users[key]["collision"] = collision;
        this.users[key]["import"] = avatarNode;
        /*
         * Tell the registry which scene node now stands for this citizen. A ray
         * comes back as a node, not as an id, and this is the only place that
         * mapping can be recorded truthfully - at the moment the node is
         * actually attached to the scene.
         *
         * It is the COLLISION WRAPPER that is bound, not the Inline inside it.
         * bxx_rayhit.js builds its hit path out of what a grouping node's
         * `children` field hands back, and X_ITE 16 hands back a fresh wrapper
         * object each time rather than the node this page holds, so an Inline
         * one level down is no longer the same object the registry was keyed
         * on. A root node is: the wrapper comes back out of `scene.rootNodes`
         * as itself, and it stands for the citizen exactly as the bare Inline
         * used to.
         *
         * The key is the PRESENCE key, `memberId:presenceId` - never the
         * username. Two tabs of one member share a username and must resolve to
         * two different presences, so the username cannot be the identity.
         */
        if (this.remoteMembers) this.remoteMembers.bindRemoteNode(key, collision);
        if (typeof browser.registerBlaxxunAvatar === "function") {
          browser.registerBlaxxunAvatar(collision, key);
        }

        if (this.users[key]["inline"]) {
          if (
            this.users[key].transform &&
            this.users[key].transform.pos
          ) {
            this.users[key]["import"].set_position = new X3D.SFVec3f(
              ...this.users[key].transform.pos,
            );
          }
          if (
            this.users[key].transform &&
            this.users[key].transform.rot
          ) {
            this.users[key]["import"].rotation = ROTATE180.multiply(
              new X3D.SFRotation(...this.users[key].transform.rot),
            );
          }
        }
      }).catch((error) => {
        /* A citizen whose model never arrived is not left half-added: the flag
         * goes back so a later add for the same presence can try again, and the
         * empty wrapper does not stay in the scene. */
        console.warn("could not load a citizen's avatar", error);
        if (this.users[key]) {
          this.users[key].loading = false;
        }
      });
    },
    /**
     * Takes one citizen's nodes back out of the scene that owns them.
     *
     * What is attached is the collision wrapper - the `Collision { collide
     * FALSE }` that keeps a remote citizen out of the local WALK test - and the
     * Inline hangs below it, so removing the wrapper removes both. An entry
     * that predates the wrapper still carries only the Inline and is detached
     * the old way.
     *
     * Never throws: a node whose scene is already gone can fail to detach, and
     * one bad entry must not stop the rest of the room being cleaned up.
     */
    detachRemoteNodes(browser: any, entry: any): void {
      if (!entry || !browser) return;
      const attached = entry.collision || entry.inline;
      if (attached) {
        try {
          if (typeof browser.unregisterBlaxxunAvatar === "function") {
            browser.unregisterBlaxxunAvatar(attached);
          }
          if (browser.currentScene) browser.currentScene.removeRootNode(attached);
        } catch (error) {
          console.warn("could not detach a citizen's nodes", error);
        }
      }
      if (entry.import && typeof entry.import.dispose === "function") {
        try {
          entry.import.dispose();
        } catch (error) {
          console.warn("could not dispose a citizen's avatar node", error);
        }
      }
    },
    /**
     * Drops every rendered citizen at a world change.
     *
     * The world being left takes its citizens with it: every node in `users`
     * belongs to the scene that is about to be replaced, and every registry
     * binding points into it. The registry cannot be repaired citizen by
     * citizen on the way out, because a client that leaves the old room never
     * receives the other citizens' later removals - it has already left the
     * room that would have carried them. The whole set has to go with the
     * world.
     */
    clearRenderedPresences(): void {
      const browser = this.browser ? X3D.getBrowser(this.browser) : null;
      for (const key of Object.keys(this.users)) {
        this.detachRemoteNodes(browser, this.users[key]);
        delete this.users[key];
      }
    },
    /** Updates an already-known presence's rendered position/rotation. */
    renderPresenceUpdated(presence: Presence): void {
      const key = presenceKey(presence.memberId, presence.presenceId);
      const ROTATE180 = new X3D.SFRotation(0, 1, 0, Math.PI);

      if (!this.users[key]) {
        // An update arrived before this presence was ever added (e.g. a
        // transform update racing the initial render) - render it fresh
        // instead of silently dropping it.
        this.renderPresenceAdded(presence);
        return;
      }

      if (!this.users[key].transform) {
        this.users[key].transform = {};
      }

      if (presence.pos) {
        this.users[key].transform.pos = presence.pos;
      }
      if (presence.rot) {
        this.users[key].transform.rot = presence.rot;
      }

      if (this.users[key]["inline"]) {
        if (this.users[key].transform.pos) {
          this.users[key]["import"].set_position = new X3D.SFVec3f(
            ...this.users[key].transform.pos,
          );
        }
        if (this.users[key].transform.rot) {
          this.users[key]["import"].rotation = ROTATE180.multiply(
            new X3D.SFRotation(...this.users[key].transform.rot),
          );
        }
      }
    },
    /** Removes a presence's rendered avatar, if it was ever rendered. */
    renderPresenceRemoved(key: string): void {
      // Released first and unconditionally: a citizen with no `users` entry may
      // still hold a binding from a render that was in flight, and a ray must
      // never resolve to somebody who has left.
      if (this.remoteMembers) this.remoteMembers.unbindNode(key);
      if (!this.users[key]) return;

      this.detachRemoteNodes(
        this.browser ? X3D.getBrowser(this.browser) : null,
        this.users[key],
      );

      delete this.users[key];
    },
    /**
     * Gestures are momentary triggers, not persistent state, so they don't
     * belong in presenceStore's latest-state model - they're only ever
     * forwarded live, and simply dropped if the avatar isn't rendered yet
     * rather than buffered and replayed once it is.
     */
    applyGesture(key: string, gesture: number): void {
      const avatar = this.users[key];
      if (!avatar || !avatar.loaded || !avatar.import) return;
      avatar.import[`set_gesture${gesture.toString()}`] =
        X3D.getBrowser(this.browser).getCurrentTime();
    },
    onSharedEvent(event): void {
      for (const node of this.eventNodeMap.get(event.name)) {
        node[`${event.type  }FromServer`] = this.TYPES[event.type].fromJSON(
          event.value,
        );
      }
    },
    async onSharedObjectEvent(event): Promise<void> {
      if(this.$store.data.view3d){
        const browser = X3D.getBrowser();
        this.sharedObjects.forEach(sharedObject => {
          const object = this.sharedObjectsMap.get(sharedObject.id);
          browser.currentScene.removeRootNode(object);
          this.sharedObjectsMap.delete(sharedObject.id);
        });
        this.sharedObjects = [];
        const objectInstanceResponse = await this.$http.get(`/place/${  this.$store.data.place.id 
        }/object_instance`);
        this.sharedObjects = objectInstanceResponse.data.object_instance;
        this.sharedObjectsMap = new Map();
        this.sharedObjects.forEach((object) => {
          this.addSharedObject(object, browser);
        });
      } else {
        this.sharedObjects = [];
        const objectInstanceResponse = await this.$http.get(`/place/${  this.$store.data.place.id 
        }/object_instance`);
        this.sharedObjects = objectInstanceResponse.data.object_instance;
      }
    },
    /**
     * True when a room-scoped presence event (AV / AV:new / AV:del) is tagged
     * for the room this page is currently in. An untagged or mismatched event
     * (e.g. one still in flight from a room we've navigated away from) is
     * rejected so it can't mutate the current room's presence store.
     */
    isForActiveRoom(event: { room?: string | number }): boolean {
      return isPresenceEventForRoom(event?.room, this.$store.data.place?.id);
    },
    /**
     * Authoritative snapshot of who's in the room right now. Sent on the
     * initial JOIN and again after a reconnect-driven rejoin, so reconciling
     * (rather than appending) resynchronizes the store after a drop without
     * duplicating roster entries or avatar loads.
     */
    onRoomState(event: { room: string | number; joinId?: string; presences: Presence[] }): void {
      // A ROOM_STATE for a room we're no longer in (e.g. a stale response
      // for a load superseded by a later navigation) must never overwrite
      // the current room's presence state.
      if (`${event.room}` !== `${this.$store.data.place?.id}`) return;
      // Reconcile only for the in-flight attempt: a stale ROOM_STATE from a
      // superseded/older attempt (same room, older joinId) must not re-reconcile.
      if (event.joinId !== this.$socket.pendingJoinId) return;
      this.presenceStore.reconcile(event.presences);
    },
    /** A peer joined the room - renderer-independent, may run before X_ITE exists. */
    onPresenceJoined(event): void {
      if (!this.isForActiveRoom(event)) return;
      if (typeof event.memberId === "undefined" || !event.presenceId) return;
      this.presenceStore.upsert({
        memberId: event.memberId,
        presenceId: event.presenceId,
        socketId: event.id,
        username: event.username,
        avatar: event.avatar,
      });
    },
    /** A peer left the room - removes them from the authoritative store. */
    onPresenceLeft(event): void {
      if (!this.isForActiveRoom(event)) return;
      if (typeof event.memberId === "undefined" || !event.presenceId) return;
      this.presenceStore.remove(presenceKey(event.memberId, event.presenceId));
    },
    /** A peer moved - updates the store; gestures are forwarded live only. */
    onPresenceMoved(event): void {
      if (!this.isForActiveRoom(event)) return;
      if (typeof event.memberId === "undefined" || !event.presenceId) return;
      const key = presenceKey(event.memberId, event.presenceId);
      this.presenceStore.updateTransform(key, event.pos, event.rot);
      if (typeof event.gesture === "number") {
        this.applyGesture(key, event.gesture);
      }
    },
    onVersion(event: { version: string }): void {
      if (event.version !== environment.packageVersion) {
        this.showUpdateWarning = true;
        console.error(
          "Socket server version mismatch:",
          `client: ${environment.packageVersion};`,
          `server: ${event.version}`,
        );
      }
    },
    reloadWindow(): void {
      window.location.reload();
    },
    async saveObjectLocation(objectId): Promise<void> {
      const obj = this.sharedObjectsMap.get(objectId);
      const location = {
        position: {
          x: obj.translation.x,
          y: obj.translation.y,
          z: obj.translation.z,
        },
        rotation: {
          x: obj.rotation.x,
          y: obj.rotation.y,
          z: obj.rotation.z,
          angle: obj.rotation.angle,
        },

      };
      if(this.$store.data.place.type === "shop"){
        await this.$http.post(`/mall/${  objectId  }/position`, location);
        /*
        /* This crashes the server.
        /*
        this.$socket.emit('SO', {
          event: 'move',
          objectId: objectId,
          detail: location
        });*/
      } else {
        await this.$http.post(`/object_instance/${  objectId  }/position`, location);
        this.$socket.emit("SO", {
          event: "move",
          objectId: objectId,
          detail: location,
        });
      }
    },
    sendSharedEvent(event): void {
      this.$socket.emit("SE", event.detail);
    },
    startSharedEvents(): void {
      let sharedZone;
      this.TYPES = createSharedEventCodecs(X3D);
      try {
        sharedZone = X3D.getBrowser().currentScene.getNamedNode("SharedZone");
      } catch (e) {
        return;
      }

      this.eventNodeMap = new Map();

      /*
       * A historical world may declare `exposedField MFNode events NULL`
       * (shopping.wrl does). blaxxun Contact read that as an empty list; X_ITE
       * 16 reads it as a one-item MFNode whose single entry is null, so the
       * loop below would call addFieldCallback on nothing and take down place
       * startup. sharedEventNodes drops the null entry rather than replacing
       * it: a world that declares no events genuinely has none.
       */
      for (const eventNode of sharedEventNodes(sharedZone.events)) {
        for (const typeName of Object.keys(this.TYPES)) {
          eventNode.addFieldCallback({}, `${typeName  }ToServer`, val => {
            // TODO: confirm validity of adding to possibly non-existent field
            this.sendSharedEvent({
              detail: {
                name: eventNode.name,
                type: typeName,
                value: this.TYPES[typeName].toJSON(val),
              },
            });
          });
        }

        if (!this.eventNodeMap.has(eventNode.name)) {
          this.eventNodeMap.set(eventNode.name, []);
        }
        this.eventNodeMap.get(eventNode.name).push(eventNode);
      }
    },
    async updateObject(object){
      const alteredSharedObjects = [];
      
      // Gets updated information for the object
      const updatedObject = await this.$http.get(`/object_instance/${ object.obj_id }/properties/`);
      const objectId = updatedObject.data.objectInstance[0].id;

      // Updates object list if the object is still in the same place
      // Removes the object if it is not in the same place
      if(updatedObject.data.objectInstance[0].place_id === this.$store.data.place.id){
        
        // Populates altered objects array with updated information
        this.sharedObjects.forEach((obj) => {
          if(obj.id === parseInt(object.obj_id) &&
            obj.place_id === this.$store.data.place.id){
            obj = updatedObject.data.objectInstance[0];
          }
          if(obj.place_id === this.$store.data.place.id){
            alteredSharedObjects.push(obj);
          }
        });
        this.sharedObjects = alteredSharedObjects;
      } else {
        this.sharedObjects = this.sharedObjects.filter(obj => {
          return obj.id !== parseInt(object.obj_id);
        });
        if(this.$store.data.view3d){
          const browser = X3D.getBrowser();
          const removeObject = this.sharedObjectsMap.get(objectId);
          browser.currentScene.removeRootNode(removeObject);
        }
        this.sharedObjectsMap.delete(objectId);
        this.$socket.emit("SO", {
          event: "remove",
          objectId: objectId,
        });
      }
    },
    startSocketListeners(): void {
      this.$socket.on("VERSION", event => this.onVersion(event));
      this.$socket.on("update-object", (object) => {
        if(object.place_id === this.$store.data.place.id){
          this.updateObject(object);
        }
      });
      this.$socket.on("SO", event => this.onSharedObjectEvent(event));
      // Presence/room-membership events are renderer-independent and must
      // be wired up here (mounted once), not gated behind X_ITE - they can
      // arrive as soon as JOIN succeeds, before any 3D scene exists.
      this.$socket.on("ROOM_STATE", event => this.onRoomState(event));
      this.$socket.on("AV:new", event => this.onPresenceJoined(event));
      this.$socket.on("AV:del", event => this.onPresenceLeft(event));
      this.$socket.on("AV", event => this.onPresenceMoved(event));
    },
    /**
     * SE (shared events) only makes sense once an X_ITE scene exists, so
     * its listener registration stays gated behind X_ITE readiness rather
     * than moving to the renderer-independent `startSocketListeners()`.
     * Any SE sent by a peer in the narrow window after our own JOIN but
     * before our X_ITE scene finishes loading is dropped: there is no
     * `eventNodeMap` yet to resolve it against (that's built from the
     * scene itself in `startSharedEvents()`), so it can't be meaningfully
     * buffered - loss here is accepted, matching SE's nature as a
     * momentary signal rather than durable state.
     *
     * This method is called once per 3D place load (from
     * `startX3DListeners`), so the registration itself is guarded to run
     * only once per component lifetime - `onSharedEvent` always reads the
     * live `this.eventNodeMap`, which `startSharedEvents()` does rebuild
     * per place, so one persistent listener is correct and avoids
     * accumulating a duplicate "SE" handler on every place visited.
     */
    start3DSocketListeners(): void {
      if (this.sharedEventListenerRegistered) return;
      this.sharedEventListenerRegistered = true;
      this.$socket.on("SE", event => this.onSharedEvent(event));
    },
    /** True if `presence` is this page's own local user. */
    isSelf(presence: Presence): boolean {
      return isSelfPresence(presence, this.$store.data.user.id, this.$socket.presenceId);
    },
    /**
     * Points the remote-member registry at the room's current presenceStore.
     *
     * A fresh store is built for every place load, and every node binding
     * belongs to the scene it was made in, so re-attaching here is what stops
     * world A's avatar nodes from still answering to a citizen in world B.
     * The registry reads identity lazily, so this is safe before login.
     */
    attachRemoteMembers(): void {
      if (!this.remoteMembers) {
        this.remoteMembers = new RemoteMemberRegistry(() => ({
          memberId: this.$store.data.user?.id,
          presenceId: this.$socket.presenceId,
        }));
      }
      this.remoteMembers.attach(this.presenceStore);
    },
    /**
     * Drains whatever presence state already accumulated in presenceStore
     * before X_ITE was ready, then subscribes for live updates. A presence
     * that both joined and left before this ever ran is simply never
     * rendered - it was removed from the store before `all()` was called.
     * The local user's own presence (present in the store since ROOM_STATE
     * includes self) is filtered out here - it must never be rendered as a
     * remote avatar.
     */
    startAvatarRenderer(): void {
      this.presenceStore.all()
        .filter(presence => !this.isSelf(presence))
        .forEach(presence => this.renderPresenceAdded(presence));
      this.presenceStore.subscribe(event => {
        if (this.isSelf(event.presence)) return;
        if (event.type === "add") this.renderPresenceAdded(event.presence);
        if (event.type === "update") this.renderPresenceUpdated(event.presence);
        if (event.type === "remove") this.renderPresenceRemoved(event.key);
      });
    },
    /*
     * X_ITE's own supersession messages.
     *
     * A world load that is still running when the next one starts is cancelled,
     * and X_ITE 16 reports that cancellation with one of TWO messages, chosen by
     * how far the superseded load had got:
     *
     *   "Loading of X3D file aborted."  - the file had not arrived yet, so the
     *     newer loadURL aborted the fetch.
     *   "Replacing world aborted."      - the file had arrived and its scene was
     *     already installed, but replaceWorld had not resolved: it only resolves
     *     once the world's own assets have finished draining, and the newer
     *     replaceWorld rejects whichever one is still waiting.
     *
     * The second window is the one an ordinary 3D-to-3D change lands in. The
     * scene's rootNodes are visible from the moment replaceWorld starts, so the
     * page (and a member) call the world "there" while its replaceWorld is still
     * pending; the next place then supersedes it. Measured on this stack the gap
     * between one replaceWorld settling and the next one starting is well under a
     * second, so any slower asset drain closes it.
     *
     * Both are cancellation signals, not load failures, and they are the only
     * messages that may be treated as such.
     */
    supersededWorldLoad(error: any): boolean {
      const message = error && error.message ? error.message : String(error);
      return message.indexOf("Loading of X3D file aborted.") !== -1
        || message.indexOf("Replacing world aborted.") !== -1;
    },
    /*
     * A supersession message on a run that is still the current one. Nothing
     * inside loadAndJoinPlace() can produce that, so it is a real fault and is
     * re-raised by the caller; it is only recorded here so a QA run can read
     * back which world it happened on.
     */
    recordUnexpectedLoadAbort(generation: number): void {
      (window as any).ctrUnexpectedWorldLoadAbort = {
        generation,
        loadGeneration: this.loadGeneration,
        url: this.worldUrl,
      };
      console.error("a current world load was aborted by nothing this page started");
    },
    async startX3D(generation: number): Promise<any> {
      if (!this.browser) {
        this.browser = X3D.createBrowser();
        document.querySelector("#world").appendChild(this.browser);
      }
      const browser = X3D.getBrowser(this.browser);
      /* Blaxxun let Scripts route the browser's own input events to
       * themselves. X_ITE rejects that, and the shim has to sit on the class
       * that owns addRoute, which is only reachable from a live browser. */
      if (typeof browser.installBlaxxunRouteShim === "function") {
        browser.installBlaxxunRouteShim();
      }
      /* And the route has to carry events, or historical worlds have no
       * keyboard controls. Bound once per browser, not once per world, so the
       * listener count stays flat as places are replaced. */
      if (typeof browser.installBlaxxunEventDelivery === "function") {
        browser.installBlaxxunEventDelivery();
      }
      /*
       * Whatever the outgoing world left on the BROWSER goes back now: its
       * event mask and its browser event route are browser-level state that
       * X_ITE does not hand back, because it never runs a VRML97 Script's
       * shutdown() on replaceWorld. Released here, before loadURL, so the
       * incoming world's own initialize() is what puts them back.
       */
      this.releaseWorldScriptState(browser);
      this.applyAvatarIdentity();
      /*
       * This run owns the promise loadURL hands back. Dropping it was the
       * defect: the browser callback below is keyed by the component, so a
       * second navigation replaces this run's callback, and INITIALIZED_EVENT
       * for this world is then delivered to the newer run instead. Without the
       * loadURL promise this run has no second way out and stays pending for
       * the life of the page, and so does the loadAndJoinPlace() awaiting it.
       */
      const load = browser.loadURL(new X3D.MFString(this.worldUrl), new X3D.MFString());
      return new Promise((resolve, reject) => {
        /*
         * One run, one settlement. Two independent paths can end this run -
         * the browser callback and the loadURL promise - and on a real load
         * failure X_ITE walks both: it calls INITIALIZED_ERROR first and then
         * rejects loadURL. Whichever arrives first is the answer.
         */
        let settled = false;
        const settleOnce = (settle, value = undefined) => {
          if (settled) return;
          settled = true;
          settle(value);
        };

        /*
         * X_ITE keys browser callbacks by their first argument. A fresh {} on
         * every place load registered a new callback and kept every earlier
         * one, each holding the scene it was created for, so the tab died after
         * roughly fifty loads. Passing the component keys them all to one slot,
         * so the newest load replaces the previous one. A superseded run must
         * therefore never remove it: the slot it would clear is the live run's.
         */
        browser.addBrowserCallback(this, eventType => {
          switch (eventType) {
          case X3D.X3DConstants.INITIALIZED_EVENT:
            this.resetGravity(browser);
            this.applyNavigationDefaults(browser);
            settleOnce(resolve, browser);
            break;
          case X3D.X3DConstants.CONNECTION_ERROR:
          case X3D.X3DConstants.INITIALIZED_ERROR:
            /* Named, because this rejection surfaces. Rejecting with no value
             * reported the failure as a bare `undefined`, which says nothing
             * about which world failed - and a world that fails to parse (a
             * content fault, not an engine one) is exactly the case somebody
             * reading the console needs to identify. */
            settleOnce(reject, new Error(`X_ITE could not initialize ${this.worldUrl}`));
            break;
          }
        });

        /* bxx_url.js suppresses a dead legacy navigation by returning a
         * resolved promise rather than calling through, so `load` is always
         * thenable even when no world was actually asked for. */
        Promise.resolve(load).then(
          () => {
            /*
             * The success path is the callback's: X_ITE calls INITIALIZED_EVENT
             * immediately before it resolves loadURL, so this run has already
             * settled. It only lands here unsettled if the world arrived for a
             * generation nobody is waiting on any more.
             */
            if (generation !== this.loadGeneration) settleOnce(resolve, null);
          },
          error => {
            /*
             * A cancellation has to prove itself twice: X_ITE's own supersession
             * message, and a generation that a later run has already claimed.
             * Anything else is a real failure and is re-raised, including an
             * abort reported while this run is still the current one, which
             * would mean something outside loadAndJoinPlace() is loading worlds.
             */
            if (this.supersededWorldLoad(error) && generation !== this.loadGeneration) {
              settleOnce(resolve, null);
              return;
            }
            if (this.supersededWorldLoad(error)) this.recordUnexpectedLoadAbort(generation);
            settleOnce(reject, error);
          },
        );
      });
    },
    /*
     * Gravity belongs to the world, not to the session.
     *
     * blaxxun's Browser.setGravity is a plain on/off switch, and X_ITE carries
     * gravity as the numeric "Gravity" browser option, which is a property of
     * the browser rather than of the scene. Four home templates switch it off
     * while a lift or a transport effect runs (worlds/007, /008, /009, /00a),
     * and a member who leaves one of them mid-effect - or whose effect Script
     * never delivers its closing event - used to carry weightlessness into
     * every world they visited afterwards.
     *
     * Every world therefore starts under normal gravity. A world that wants it
     * off switches it off itself, as those four do.
     */
    /*
     * Gives back what the outgoing world took, both from X_ITE and from the
     * browser. Called on every path that replaces a world, and always while the
     * outgoing scene is still the current one - after the replacement it can no
     * longer be named.
     *
     * The world's own Scripts go first. X_ITE does not dispose them on
     * `replaceWorld`, and each one that defines shutdown() is registered on the
     * window's `unload` event, which held the Script - and through it the whole
     * scene - for the life of the page. `releaseWorldScripts` runs X_ITE's own
     * `Script.dispose()` on them, which calls shutdown() and takes the listener
     * off the window; see @/libs/world-scripts.
     *
     * The browser state goes second, and stays. A Script writes two things onto
     * the browser that are not part of any scene: the blaxxun event mask, and
     * the route from the browser's `event_changed` into itself. A historical world's
     * shutdown() hands both back and now genuinely runs, but a world that never
     * defined shutdown() still cannot, so the sweep below is what guarantees the
     * next world does not inherit them.
     */
    releaseWorldScriptState(browser: any): void {
      try {
        releaseWorldScripts(browser.currentScene);
      } catch (error) {
        console.warn("could not release the previous world's scripts", error);
      }
      try {
        if (typeof browser.releaseBlaxxunWorldState === "function") {
          browser.releaseBlaxxunWorldState();
        }
      } catch (error) {
        console.warn("could not release the previous world's browser state", error);
      }
    },
    resetGravity(browser: any): void {
      try {
        if (typeof browser.setGravity === "function") {
          browser.setGravity(true);
        }
      } catch (error) {
        console.warn("could not reset gravity for the new world", error);
      }
    },
    /*
     * Blaxxun default: only the Walk and Fly viewers are offered.
     *
     * This used to be done by the bxx_speed_avatar patch, which rewrote the
     * NavigationInfo field default. X_ITE 16 no longer exposes that default,
     * so the value is set on the node instead. A NavigationInfo authored in
     * the scene still wins, matching the old patch's behaviour.
     */
    applyNavigationDefaults(browser: any): void {
      try {
        const scene = browser.currentScene;
        if (!scene) return;

        const authored = scene.rootNodes.some(
          (node: any) => node && node.getNodeTypeName
            && node.getNodeTypeName() === "NavigationInfo",
        );
        if (authored) return;

        const navInfo = scene.createNode("NavigationInfo");
        navInfo.type = ["WALK", "FLY"];
        scene.addRootNode(navInfo);
      } catch (error) {
        console.warn("could not apply navigation defaults", error);
      }
    },
    /*
     * Publishes the citizen's own avatar to the historical Browser surface.
     *
     * Historical worlds read Browser.myAvatarURL / myAvatarName back to decide
     * who the local member is. bxx_identity.js exposes those as a provider
     * seam rather than as plain slots, so Beta registers a reader here instead
     * of writing values in: the store is the single source of truth and a late
     * login still resolves, because the provider is called at read time.
     */
    applyAvatarIdentity(): void {
      try {
        if (!X3D.bxx || typeof X3D.bxx.setIdentityProvider !== "function") return;
        X3D.bxx.setIdentityProvider(() => {
          const user = this.$store.data.user;
          // The store's avatar type does not declare `directory`, but the row the
          // API returns carries it - the same field the remote-citizen render path
          // destructures off a presence avatar.
          const avatar: any = user && user.avatar;
          if (!avatar || !avatar.directory || !avatar.filename) return {};
          return {
            // Absolute, but never a hard-coded host: a historical world compares
            // this string, and the origin has to be whichever deployment is
            // serving the page.
            avatarURL:
              `${window.location.origin}/assets/avatars/${avatar.directory}/${avatar.filename}`,
            avatarName: user.username || "",
          };
        });
      } catch (error) {
        console.warn("could not publish the avatar identity", error);
      }
    },
    startX3DListeners(browserbak: any, generation: number): void {
      const browser = X3D.getBrowser();
      /*
       * The ProximitySensor is what feeds this.position / this.rotation to the
       * presence transform we publish. It belongs to the scene that is loaded
       * right now, so it is replaced on every world load.
       *
       * This used to also install viewpointPosition / viewpointOrientation
       * getters onto the browser *prototype*, closing over the sensor of
       * whichever scene happened to load first. The install was guarded by an
       * "already defined" check, so after the first world the getters kept
       * reading a sensor that had been disposed by replaceWorld(). bxx_auth.js
       * defines both accessors against the live viewpoint, so the prototype
       * patch is gone; getTime is set there too, so that assignment is gone as
       * well.
       *
       * Note that the two are NOT interchangeable: the sensor reports WORLD
       * space, which is what a peer needs to draw us, while bxx_auth's
       * accessors report the viewpoint-local values a historical Script
       * expects. Presence keeps using the sensor.
       */
      const prox = browser.currentScene.createNode("ProximitySensor");
      prox.size = new X3D.SFVec3f(1000000, 1000000, 1000000);
      prox.enabled = true;
      prox.addFieldCallback({}, "position_changed", (val) => {
        this.position = [val.x, val.y, val.z];
      });
      prox.addFieldCallback({}, "orientation_changed", (val) => {
        this.rotation = [val.x, val.y, val.z, val.angle];
      });
      browser.currentScene.addRootNode(prox);
      this.sharedObjectsMap = new Map();
      /*
       * The delay is still needed: INITIALIZED_EVENT fires before the scene's
       * EXTERNPROTOs have finished loading, and createProto("SharedObject")
       * against externprotos/shared_xite.wrl throws until that resolves. X_ITE
       * 16 exposes no "externprotos ready" callback, so the wait stays until
       * one exists.
       *
       * It does mean this callback can outlive its world. addSharedObject reads
       * browser.currentScene when it runs, not when the timer was set, so a
       * stale timer would otherwise pour its objects into whichever world had
       * replaced this one. The generation check is what prevents that.
       */
      setTimeout(() => {
        if (generation !== this.loadGeneration) {
          return;
        }
        this.sharedObjects.forEach((object) => {
          this.addSharedObject(object, browser);
        });
      }, 2000);

      this.startSharedEvents();
      this.start3DSocketListeners();
      this.startAvatarRenderer();
      this.loaded = true;
      this.sendInitialViewpoint();
    },
  },
  computed: {
    worldUrl(): string {
      const { assets_dir, world_filename } = this.$store.data.place;
      return `/assets/worlds/${assets_dir}${world_filename}`;
    },
  },
  watch: {
    "$store.data.x3dReady": function (to, from) {
      if (to && (this.$route.name === "world-browser" || this.$route.name === "user-home" || 
          to.name === "club-page")) {
        this.loadAndJoinPlace();
      }
    },
    "$store.data.view3d": function () {
      if (this.$route.name === "world-browser" || this.$route.name === "user-home"
          || this.$route.name === "club-page" && this.$store.data.x3dReady) {
        this.loadAndJoinPlace();
      }
    },

    $route(to, from) {
      if (
        (to.name === "world-browser" || to.name === "user-home" || to.name === "club-page")
        && this.$store.data.x3dReady
      ) {
        this.loadAndJoinPlace();
      } else if(
        (from.name === "world-browser" || from.name === "user-home" || from.name === "club-page")
        && this.$store.data.x3dReady
      ) {
        this.unloadPlace();
      }
    },
    place() {
      this.debugMsg("place changed");
    },
    position() {
      this.$socket.sendAv({
        pos: this.position,
      });
    },
    rotation() {
      this.$socket.sendAv({
        rot: this.rotation,
      });
    },
    sharedEvent: {
      handler() {
        if (this.sharedEvent) {
          this.$socket.emit("SE", this.sharedEvent.detail);
        }
      },
      deep: true,
      immediate: true,
    },
  },
  mounted() {
    this.startSocketListeners();
    // WorldBrowserPage is a v-show singleton (mounted once for the app's
    // lifetime), so this single subscription can't accumulate. On a
    // reconnect-driven resync, re-announce our current viewpoint so a
    // restarted socket server relearns our real position without waiting for
    // us to move (our own presence is otherwise absent from its fresh state).
    this.$socket.onLifecycle((event) => {
      if (event === "resynced") this.sendInitialViewpoint();
    });
  },
  beforeDestroy() {},
  async beforeCreate() {
    await this.$socket.start();
  },
});
</script>

<style>
  .update-warning a {
    cursor: pointer;
  }
</style>
