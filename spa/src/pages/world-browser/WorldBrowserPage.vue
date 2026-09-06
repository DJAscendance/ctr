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
        v-if="loaded"
        :place="place"
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
import Vue from "vue";

import * as avatarsDataJson from "../../libs/data/avatars.json";
import * as worldDataJson from "../../libs/data/worlds.json";
import Chat from "../../components/Chat.vue";
import {
  debugMsg,
  environment,
} from "@/helpers";
import {
  isOutlands,
  outlandsTeamOfAvatar,
  OUTLANDS_SPAWNS,
} from "@/libs/outlands";
import { WorldBrowserData } from "./world-browser-data.interface";

export default Vue.extend({
  name: "WorldBrowserPage",
  components: { Chat },
  data: (): WorldBrowserData => {
    return {
      loaded: false,
      worldsData: worldDataJson,
      avatarsData: avatarsDataJson,
      browser: null,
      uniqValue: 0,
      place: undefined,
      position: [0, 0, 0],
      rotation: [0, 0, 0, 0],
      // ProximitySensor for the scene that is currently loaded
      proximitySensor: null,
      users: {},
      ROTATE180: null,
      TYPES: {},
      sharedEvent: null,
      eventNodeMap: null,
      sharedObjects: [],
      sharedObjectsMap: undefined,
      /*
       * Incremented once per loadAndJoinPlace(). Three watchers can start a
       * place load, and on a direct page load two of them fire, so two runs are
       * in flight at once. Every step that outlives an await compares its own
       * generation against this before touching the scene or the object list,
       * so a superseded run cannot populate the world that replaced it.
       */
      worldGeneration: 0,
      /** Guards the one-time bind in start3DSocketListeners(). */
      socket3dListenersBound: false,
      showUpdateWarning: false,
      mainComponent: null,
      force2d: false,
      /*
       * TEMPORARY Outlands compatibility. True when Outlands was asked for by
       * a member who has not picked a side yet, which keeps the entrance
       * screen up and stops ne_game.wrl from loading at all.
       */
      outlandsTeamNeeded: false,
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
    /*
     * Loads the placement list for the current place.
     *
     * The shop branch used to push straight onto this.sharedObjects after its
     * await. `push` re-reads the property when it runs, so when two place loads
     * overlapped the earlier run's rows landed in the later run's array and the
     * shop rendered every mall object twice. The list is built locally and
     * assigned once instead, which is what the object_instance branch always
     * did, and the assignment is skipped outright if a newer load has started.
     */
    async getPlace(generation: number): Promise<void> {
      this.debugMsg("get place");
      document.title = `${this.$store.data.place.name  } - Cybertown`;
      let objects = [];
      try {
        if(this.$store.data.place.type === "shop"){
          const objectResponse = await this.$http.get(`/mall/objects/${this.$store.data.place.id}`);
          objects = objectResponse.data.objects.filter(obj => obj.status === 1);
        } else {
          const objectResponse = await this.$http.get(`/place/${  this.$store.data.place.id 
          }/object_instance`);
          objects = objectResponse.data.object_instance;
        }
      } catch(e) {
        console.error(e);
      }
      if (generation !== this.worldGeneration) {
        return;
      }
      this.sharedObjects = objects;
    },
    async loadAndJoinPlace(): Promise<void> {
      // Claim this run. Anything below that survives an await belongs to an old
      // world once a newer run has claimed a higher generation.
      const generation = ++this.worldGeneration;
      this.loaded = false;
      this.force2d = false;

      if (this.$store.data.place) this.$socket.leaveRoom(this.$store.data.place.id);
      await this.getPlace(generation);
      if (generation !== this.worldGeneration) {
        return;
      }

      if(this.$store.data.place.slug === "clubdir"){
        this.force2d = true;
      }

      /*
       * TEMPORARY Outlands compatibility - X_ITE 16.2.0 migration only.
       *
       * Outlands takes a member's side from the avatar they wear, and a member
       * with no side is parked under the map by the world itself. The
       * historical entry page made them pick a side before the world loaded,
       * so the entrance screen stands in for it here. See @/libs/outlands.
       */
      this.outlandsTeamNeeded = false;
      if (isOutlands(this.$store.data.place)
          && !outlandsTeamOfAvatar(this.$store.data.user && this.$store.data.user.avatar)) {
        this.outlandsTeamNeeded = true;
        this.force2d = true;
      }

      if(this.$route.params.username){
        if(this.$store.data.place.assets_dir === null) {
          this.force2d = true;
        }
      }

      if(this.browser) {
        const browser = X3D.getBrowser(this.browser);
        browser.replaceWorld(null);
      }
      if(this.$store.data.view3d && !this.force2d) {
        const browser = await this.startX3D();
        if (generation !== this.worldGeneration) {
          return;
        }
        this.loaded = true;
        this.startX3DListeners(browser, generation);
        this.applyTemporaryOutlandsSpawn(browser);
      } else {

        if(this.outlandsTeamNeeded){
          this.mainComponent = () => import(
            "@/components/place/outlands/entrance.vue"
          );
        } else if(this.$store.data.place.type === "shop"){
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
      this.joinPlace();
    },
    async unloadPlace(): Promise<void> {
      if (this.$store.data.place) this.$socket.leaveRoom(this.$store.data.place.id);
      const browser = X3D.getBrowser(this.browser);
      browser.replaceWorld(null);
    },
    async joinPlace(): Promise<void> {
      await this.$socket.joinRoom(this.$store.data.place.id, this.$store.data.user.token);
      this.debugMsg("joined room success", this.$store.data.place.id);
      if(this.$store.data.view3d){
        // The viewpoint is not necessarily bound yet when the room is joined, so
        // fall back to the last sensor reading rather than dereferencing null.
        const { viewpointPosition, viewpointOrientation } = X3D.getBrowser(this.browser);
        const pos = viewpointPosition
          ? [viewpointPosition.x, viewpointPosition.y, viewpointPosition.z]
          : this.position;
        const rot = viewpointOrientation
          ? [
            viewpointOrientation.x,
            viewpointOrientation.y,
            viewpointOrientation.z,
            viewpointOrientation.angle,
          ]
          : this.rotation;
        this.$socket.emit("AV", { detail: { pos, rot } });
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
       * The four floats are read straight off the field objects. X_ITE 4 and 15
       * kept the numbers on an internal `_value` holder whose members were the
       * underscored `x_` / `y_` / `z_`; 16.2.0 removed it, so `dropPosition._value`
       * is undefined and reading `.x_` off it threw before the request was ever
       * sent. `.x` / `.y` / `.z` / `.angle` are the accessors on every version,
       * which is what saveObjectLocation below has always used.
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
         * so Object.values() lifted the numbers out of it in field order; on
         * 16.2.0 the holder is gone and Object.values() on the field itself
         * returns an empty array, which made every beam land at the origin.
         * The angle is dropped because SFRotation is rebuilt from the axis
         * below and the beam faces the target on its own.
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
    async onAvatarAdded(event): Promise<void> {
      const ROTATE180 = new X3D.SFRotation(0, 1, 0, Math.PI);

      const unique = (prefix) => {
        this.uniqValue += 1;
        return prefix + this.uniqValue.toString();
      };

      const loadInlineAsync = (browser, url) => {
        browser.endUpdate();
        //todo: error coming from here about 'url' = ''
        const inline = browser.currentScene.createNode("Inline");
        inline.url = new X3D.MFString(url);
        const loadSensor = browser.currentScene.createNode("LoadSensor");
        loadSensor.watchList[0] = inline;
        const callbackKey = {};
        const promise = new Promise((resolve, reject) => {
          loadSensor.addFieldCallback(callbackKey, "isLoaded", (value) => {
            loadSensor.removeFieldCallback(callbackKey, "isLoaded");
            if (value) {
              resolve(inline);
            } else {
              reject(inline);
            }
          });
        });
        browser.beginUpdate();
        return promise;
      };

      const browser = X3D.getBrowser(this.browser);

      if (!this.users[event.id]) {
        this.users[event.id] = {};
      }

      if (
        !this.users[event.id].loading &&
        !this.users[event.id].loaded
      ) {
        const { directory, filename } = event.avatar;
        const avURL = `/assets/avatars/${directory}/${filename}`;

        this.users[event.id].loading = true;
        loadInlineAsync(browser, avURL).then((avInline) => {
          const uniqueID = unique("Av-");
          browser.currentScene.updateImportedNode(avInline, "Avatar", uniqueID);
          const avImport = browser.currentScene.getImportedNode(uniqueID);
          browser.currentScene.addRootNode(avInline);
          this.users[event.id].loading = false;
          this.users[event.id].loaded = true;
          this.users[event.id]["inline"] = avInline;
          this.users[event.id]["import"] = avImport;

          if (this.users[event.id]["inline"]) {
            if (
              this.users[event.id].transform &&
              this.users[event.id].transform.pos
            ) {
              this.users[event.id]["import"].set_position = new X3D.SFVec3f(
                ...this.users[event.id].transform.pos,
              );
            }
            if (
              this.users[event.id].transform &&
              this.users[event.id].transform.rot
            ) {
              this.users[event.id]["import"].rotation = ROTATE180.multiply(
                new X3D.SFRotation(...this.users[event.id].transform.rot),
              );
            }
          }
        });
      }
    },
    onAvatarMoved(event): void {
      const ROTATE180 = new X3D.SFRotation(0, 1, 0, Math.PI);
      const browser = X3D.getBrowser(this.browser);

      if (!this.users[event.id]) {
        this.users[event.id] = {};
      }

      if (!this.users[event.id].transform) {
        this.users[event.id].transform = {};
      }

      if (event.pos) {
        this.users[event.id].transform.pos = event.pos;
      }
      if (event.rot) {
        this.users[event.id].transform.rot = event.rot;
      }

      if (this.users[event.id]["inline"]) {
        if (this.users[event.id].transform.pos) {
          this.users[event.id]["import"].set_position = new X3D.SFVec3f(
            ...this.users[event.id].transform.pos,
          );
        }
        if (this.users[event.id].transform.rot) {
          this.users[event.id]["import"].rotation = ROTATE180.multiply(
            new X3D.SFRotation(...this.users[event.id].transform.rot),
          );
        }

        if (typeof event.gesture === "number") {
          this.users[event.id]["import"][
            `set_gesture${  event.gesture.toString()}`
          ] = browser.getCurrentTime();
        }
      }
    },
    onAvatarRemoved(event): void {
      const { id } = event;

      if (this.users[id].inline) {
        X3D.getBrowser(this.browser)
          .currentScene
          .removeRootNode(this.users[id].inline);
      }

      if (this.users[id].import) {
        this.users[id].import.dispose();
      }

      delete this.users[id];
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
      this.TYPES = {
        bool: {
          toJSON: (e) => e,
          fromJSON: (e) => e,
        },
        color: {
          toJSON: (color) => ({
            r: color.r,
            g: color.g,
            b: color.b,
          }),
          fromJSON: (color) => new X3D.SFColor(color.r, color.g, color.b),
        },
        float: {
          toJSON: (e) => e,
          fromJSON: (e) => e,
        },
        int32: {
          toJSON: (e) => e,
          fromJSON: (e) => e,
        },
        rotation: {
          toJSON: (rotation) => ({
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            angle: rotation.angle,
          }),
          fromJSON: (rotation) =>
            new X3D.SFRotation(
              rotation.x,
              rotation.y,
              rotation.z,
              rotation.angle,
            ),
        },
        string: {
          toJSON: (e) => e,
          fromJSON: (e) => e,
        },
        time: {
          toJSON: (e) => e,
          fromJSON: (e) => e,
        },
        vec2f: {
          toJSON: (vec2f) => ({ x: vec2f.x, y: vec2f.y }),
          fromJSON: (vec2f) => new X3D.SFVec2f(vec2f.x, vec2f.y),
        },
        vec3f: {
          toJSON: (vec3f) => ({
            x: vec3f.x,
            y: vec3f.y,
            z: vec3f.z,
          }),
          fromJSON: (vec3f) => new X3D.SFVec2f(vec3f.x, vec3f.y, vec3f.z),
        },
      };
      try {
        sharedZone = X3D.getBrowser().currentScene.getNamedNode("SharedZone");
      } catch (e) {
        return;
      }

      this.eventNodeMap = new Map();

      for (const eventNode of Array.from<any>(sharedZone.events)) {
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
    },
    /*
     * Binds the 3D socket handlers exactly once.
     *
     * This runs on every place load, and the socket wrapper only exposes `on`,
     * so each load used to add another set of handlers that was never removed.
     * The handlers dispatch through `this`, so one registration serves every
     * world the component ever loads.
     */
    start3DSocketListeners(): void {
      if (this.socket3dListenersBound) {
        return;
      }
      this.socket3dListenersBound = true;
      this.$socket.on("AV", event => this.onAvatarMoved(event));
      this.$socket.on("AV:del", event => this.onAvatarRemoved(event));
      this.$socket.on("AV:new", event => this.onAvatarAdded(event));
      this.$socket.on("SE", event => this.onSharedEvent(event));
    },
    /*
     * Publish the member's chosen avatar as the browser's avatar identity.
     *
     * blaxxun Contact took this from the `vrmlmyavatar` client parameter, which
     * Cybertown wrote per place - ne_game/enter3D.tmpl mapped the team the
     * member picked on the Outlands entry page to one of five avatar URLs.
     * CTR has no client parameter and one avatar selection for the whole city,
     * so the identity comes from the avatar the member is wearing.
     *
     * It is set before loadURL because a world's Scripts read it during their
     * own initialize(); ne_game.wrl's set_team runs three seconds after the
     * world starts and decides the member's team from this value alone.
     */
    applyAvatarIdentity(browser): void {
      const avatar = this.$store.data.user && this.$store.data.user.avatar;
      if (!avatar || !avatar.directory || !avatar.filename) {
        return;
      }
      const url = `${window.location.origin}/assets/avatars/${avatar.directory}/${avatar.filename}`;
      try {
        browser.setMyAvatarURL(url);
        browser.myAvatarName = this.$store.data.user.username || "";
      } catch (error) {
        console.warn("could not publish the avatar identity", error);
      }
    },
    /*
     * TEMPORARY Outlands compatibility - X_ITE 16.2.0 migration only.
     *
     * ne_game.wrl's `battle_view` Viewpoint is authored at 0 -1000 0 and is
     * the first Viewpoint in the file, so it is what the browser binds. That
     * is not a fault: it is where a member with no side has always waited
     * while `set_team` works out which side they are on and calls
     * `set_viewpoint()` to move them. The battle Script is not yet whole on
     * X_ITE 16, so on this branch nobody is ever moved off the parking spot.
     *
     * This bridge does the one thing a citizen needs in the meantime. It reads
     * the side off the avatar the member is wearing - the same rule set_team
     * uses - and binds a fresh Viewpoint at one of that side's own spawns.
     *
     * A fresh node is used on purpose. Writing a position into `battle_view`
     * would fight the camera offset the member has already built up falling
     * from the parking spot, because X_ITE keeps that offset per Viewpoint. A
     * newly created Viewpoint starts with no offset, so binding it puts the
     * camera exactly where the historical spawn says, and `jump TRUE` makes
     * the bind a move rather than an animation.
     *
     * The spawns are read out of the loaded world where possible, so this
     * cannot drift away from the content. The table in @/libs/outlands is a
     * copy of the same fields and is only a fallback.
     *
     * Full spawn ownership stays with the battle Script and returns to it in
     * the dedicated Outlands restoration lane. Nothing here handles matches,
     * respawn, the Game Master or scoring.
     */
    applyTemporaryOutlandsSpawn(browser: any): void {
      if (!isOutlands(this.$store.data.place)) {
        return;
      }
      const team = outlandsTeamOfAvatar(this.$store.data.user && this.$store.data.user.avatar);
      if (!team) {
        return;
      }
      try {
        const scene = browser.currentScene;
        if (!scene) return;

        const spawns = this.outlandsSpawnTable(scene, team);
        const index = Math.floor(spawns.position.length * Math.random());
        const position = spawns.position[index];
        const orientation = spawns.orientation[index];

        const viewpoint = scene.createNode("Viewpoint");
        viewpoint.description = "CTR temporary Outlands team spawn";
        viewpoint.position = new X3D.SFVec3f(position[0], position[1], position[2]);
        viewpoint.orientation = new X3D.SFRotation(
          orientation[0], orientation[1], orientation[2], orientation[3],
        );
        viewpoint.jump = true;
        scene.addRootNode(viewpoint);
        viewpoint.set_bind = true;

        /* A reading hook for the temporary-entry gate. It records what the
         * bridge aimed at; the gate still measures where the camera ended up. */
        (window as any).ctrTemporaryOutlandsSpawn = {
          team,
          index,
          position,
          orientation,
          source: spawns.source,
        };
      } catch (error) {
        console.warn("could not place the member at an Outlands team spawn", error);
      }
    },
    /*
     * TEMPORARY Outlands compatibility. The spawns belong to the world, so
     * they are read back out of `DEF battle Script`'s `red_view_pos` /
     * `blue_view_pos` fields when X_ITE will hand them over, and only fall
     * back to the copy in @/libs/outlands when it will not.
     */
    outlandsSpawnTable(scene: any, team: number): any {
      const fallback = Object.assign({ source: "libs/outlands" }, OUTLANDS_SPAWNS[team]);
      try {
        const battle = scene.getNamedNode("battle");
        if (!battle) return fallback;
        const prefix = team === 1 ? "red" : "blue";
        const position = Array.from(battle.getField(`${prefix}_view_pos`))
          .map((value: any) => [value.x, value.y, value.z]);
        const orientation = Array.from(battle.getField(`${prefix}_view_or`))
          .map((value: any) => [value.x, value.y, value.z, value.angle]);
        if (!position.length || position.length !== orientation.length) return fallback;
        return { position, orientation, source: "ne_game.wrl" };
      } catch (error) {
        return fallback;
      }
    },
    async startX3D(): Promise<any> {
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
      this.applyAvatarIdentity(browser);
      browser.loadURL(new X3D.MFString(this.worldUrl), new X3D.MFString());
      return new Promise((resolve, reject) => {
        /*
         * X_ITE keys browser callbacks by their first argument. A fresh {} on
         * every place load registered a new callback and kept every earlier
         * one, each holding the scene it was created for, so the tab died after
         * roughly fifty loads. Passing the component keys them all to one slot,
         * so the newest load replaces the previous one.
         */
        browser.addBrowserCallback(this, eventType => {
          switch (eventType) {
          case X3D.X3DConstants.INITIALIZED_EVENT:
            this.applyNavigationDefaults(browser);
            resolve(browser);
            break;
          case X3D.X3DConstants.CONNECTION_ERROR:
          case X3D.X3DConstants.INITIALIZED_ERROR:
            reject();
            break;
          }
        });
      });
    },
    /*
     * Blaxxun default: only the Walk and Fly viewers are offered.
     *
     * This used to be done by the bxx_speed_avatar patch, which rewrote the
     * NavigationInfo field default. X_ITE 15 no longer exposes that default,
     * so the value is set on the node instead. A NavigationInfo authored in
     * the scene still wins, matching the old patch's behaviour.
     */
    applyNavigationDefaults(browser: any): void {
      try {
        const scene = browser.currentScene;
        if (!scene) return;

        const authored = scene.rootNodes.some(
          (node: any) => node && node.getNodeTypeName && node.getNodeTypeName() === "NavigationInfo",
        );
        if (authored) return;

        const navInfo = scene.createNode("NavigationInfo");
        navInfo.type = ["WALK", "FLY"];
        scene.addRootNode(navInfo);
      } catch (error) {
        console.warn("could not apply navigation defaults", error);
      }
    },
    startX3DListeners(browserbak: any, generation: number): void {
      const browser = X3D.getBrowser();
      /*
       * The ProximitySensor is what feeds this.position / this.rotation to the
       * avatar socket messages. It belongs to the scene that is loaded right now,
       * so it is stored on the component and replaced on every world load.
       *
       * This used to also install viewpointPosition / viewpointOrientation getters
       * onto the browser *prototype*, closing over the sensor of whichever scene
       * happened to load first. The install was guarded by an "already defined"
       * check, so after the first world the getters kept reading a sensor that had
       * been disposed by replaceWorld(). bxx_auth.js already defines both accessors
       * against the live viewpoint, so the prototype patch is gone. getTime is set
       * there too (bxx_auth.js:10), so that assignment is gone as well.
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
      this.proximitySensor = prox;
      this.sharedObjectsMap = new Map();
      /*
       * The delay is still needed: INITIALIZED_EVENT fires before the scene's
       * EXTERNPROTOs have finished loading, and createProto("SharedObject")
       * against externprotos/shared_xite.wrl throws until that resolves. X_ITE
       * 15 exposes no "externprotos ready" callback, so the wait stays until
       * one exists.
       *
       * It does mean this callback can outlive its world. addSharedObject reads
       * browser.currentScene when it runs, not when the timer was set, so a
       * stale timer would otherwise pour its objects into whichever world had
       * replaced this one. The generation check is what prevents that.
       */
      setTimeout(() => {
        if (generation !== this.worldGeneration) {
          return;
        }
        this.sharedObjects.forEach((object) => {
          this.addSharedObject(object, browser);
        });
      }, 2000);

      this.startSharedEvents();
      this.start3DSocketListeners();
      this.loaded = true;
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
      this.$socket.emit("AV", {
        pos: this.position,
      });
    },
    rotation() {
      this.$socket.emit("AV", {
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
    /* TEMPORARY Outlands compatibility: the entrance screen wears the avatar
     * that carries the member's side, and the world can be loaded once it has. */
    this.$root.$on("outlands-team-selected", this.loadAndJoinPlace);
  },
  beforeDestroy() {
    this.$root.$off("outlands-team-selected", this.loadAndJoinPlace);
  },
  async beforeCreate() {
    await this.$socket.start();
  },
});
</script>

<style>
  .update-warning a {
    cursor: pointer;
  }

  /*
   * X3D.createBrowser() returns an <x3d-canvas> element that is appended to #world
   * at runtime. X_ITE 15 leaves it at the HTML default 300x150 instead of filling
   * its parent, which drew the scene into a small box in the corner. index.scss
   * carries the same rule globally; this keeps it with the component that creates
   * the element. Not a scoped block on purpose - the element is appended by hand
   * and so never receives the scope attribute.
   */
  #world x3d-canvas {
    display: block !important;
    width: 100% !important;
    height: 100% !important;
  }
</style>
