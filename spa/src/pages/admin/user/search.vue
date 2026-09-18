<template>
  <div class="grid grid-cols-1 w-full place-items-center">
    <div class="text-center w-full text-5xl mb-1">Citizen Search</div>
  <div class="grid grid-cols-2 w-4/6 justify-items-center">
    <div>
    Username Search: 
    <input class="text-black" type="text" v-model="search" @input="searchUsers"/>
    </div>
    <div>
    View Amount:
    <select v-model.number="limit" @change="searchUsers">
      <option value=10>10</option>
      <option value=20>20</option>
      <option value=50>50</option>
      <option value=100>100</option>
    </select>
    </div>
  </div>
    <div class="grid-cols-1 w-4/6 justify-items-center text-center">
      Total Count: {{ this.totalCount }}
    </div>
  <div class="grid grid-cols-5 text-center w-4/6"
       :class="{'grid-cols-7': accessLevel.includes('admin')}">
    <div class="border-white border w-full pl-1">ID</div>
    <div class="col-span-2 border-white border w-full pl-1">Username</div>
    <div class="col-span-2 border-white border w-full pl-1">Last Login</div>
    <div class="border-white border w-full pl-1"></div>
  </div>
  <div
      class="grid grid-cols-5 w-4/6"
      v-for="(id) in users"
      :key="id.id"
      :class="{'grid-cols-7': accessLevel.includes('admin')}">
    <div class="border-white border w-full pl-1 text-center">{{ id.id }}</div>
    <div class="col-span-2 border-white border w-full pl-1">
      <router-link :to="'/admin/member/user/'+id.id">
      {{ id.username }}
      </router-link>
    </div>
    <div class="col-span-2 border-white border w-full pl-1">{{ new Date(id.last_daily_login_credit)
        .toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
          timeZone: 'America/Detroit',
        }) }}</div>
        <div class="border-white border w-full pl-1">
          <button class="btn-ui" style="background-color: darkred; width: 60px;"
        v-if="accessLevel.includes('admin')" @click="confirmRemoval(id.id, id.username)">Delete</button>
        </div>
  </div>
  <div v-if="showRemovalModal">
    <div class="fixed inset-0 z-50 flex justify-center items-center">
      <div class="flex flex-col w-2/6 max-w-5xl rounded-lg shadow-lg bg-red-300 text-red-800">
        <div class="p-5">
          <div class="flex justify-between items-start">
            <h3 class="text-2xl font-semibold">Delete Account</h3>
            <button class="p-1 leading-none" @click="closeRemovalModal">
              <div class="text-xl font-semibold h-6 w-6">
                <span>x</span>
              </div>
            </button>
          </div>
        </div>
        <div class="p-6">
          <p>
            Permanently delete {{ removalUsername }}'s account?
            This action cannot be undone.
          </p>
          <label class="block mt-3 mb-1" for="removal-reason">
            Reason (required)
          </label>
          <textarea id="removal-reason"
                    class="text-black w-full"
                    v-model="removalReason"
                    rows="3"
                    maxlength="255"
                    placeholder="Why is this account being removed?"></textarea>
          <div class="font-bold mt-1" v-if="modalError">
            {{ modalError }}
          </div>
        </div>
        <div class="p-6 flex justify-end items-center">
          <button class="btn pr-1" @click="closeRemovalModal">Cancel</button>
          <button class="btn" @click="deleteAccount">Confirm</button>
        </div>
      </div>
    </div>
    <div class="opacity-50 fixed inset-0 z-60 bg-black"></div>
  </div>
      <div class="grid grid-cols-2 w-4/6 justify-items-center">
        <div class="p-1 text-right w-full">
          <button
              class="bg-gray-300 text-black w-4/6"
              @click="back"
              v-show="offset != 0">
            BACK
          </button>
        </div>
        <div class="p-1 text-left w-full">
          <button
              class="bg-gray-300 text-black w-4/6"
              @click="next"
              v-show="this.offset + this.limit <= this.totalCount">
            NEXT
          </button>
        </div>
      </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "UserSearch",
  data: () => {
    return {
      totalCount: 0,
      users: [],
      search: "",
      limit: 10,
      offset: 0,
      showNext: true,
      error: null,
      showRemovalModal: false,
      removalId: null,
      removalUsername: "",
      removalReason: "",
      modalError: "",
    };
  },
  props: [
    "accessLevel",
  ],
  methods: {
    async getUsers(): Promise<any> {
      try {
        return this.$http.get(
          "/admin/usersearch/", {
            limit: this.limit,
            offset: this.offset,
            search: this.search,
          },
        ).then((response) => {
          this.users = response.data.results.users;
          this.totalCount = response.data.results.total[0].count;
        });
      } catch (error) {
        this.error = error;
      }
    },
    async searchUsers(): Promise<any> {
      this.offset = 0;
      try {
        return this.$http.get(
          "/admin/usersearch/", {
            limit: this.limit,
            offset: this.offset,
            search: this.search,
          },
        ).then((response) => {
          this.users = response.data.results.users;
          this.totalCount = response.data.results.total[0].count;
        });
      } catch (error) {
        this.error = error;
      }
    },
    async next() {
      this.offset = this.offset + this.limit;
      await this.getUsers();
    },
    async back() {
      this.offset = this.offset - this.limit;
      await this.getUsers();
      this.showNext = true;
    },
    // Replaces window.confirm: account removal now owes an operator reason
    // (CTBL-0025, baseline section 11), and a native confirm box cannot collect
    // one. The confirmation itself is unchanged -- it is still one deliberate
    // step before an irreversible delete.
    confirmRemoval(id, username) {
      this.removalId = id;
      this.removalUsername = username;
      this.removalReason = "";
      this.modalError = "";
      this.showRemovalModal = true;
    },
    closeRemovalModal() {
      this.showRemovalModal = false;
      this.removalId = null;
      this.removalUsername = "";
      this.removalReason = "";
      this.modalError = "";
    },
    async deleteAccount(): Promise <void> {
      const reason = this.removalReason.trim();
      if (!reason) {
        this.modalError = "Please enter a reason";
        return;
      }
      const id = this.removalId;
      this.closeRemovalModal();
      try {
        await this.$http.post("/admin/remove-account", {
          id: id,
          reason: reason,
        });
        this.error = "Account successfully deleted.";
        await this.getUsers();
      } catch {
        this.error = "Account removal failed.";
      }
    },
  },
  async created() {
    await this.getUsers();
  },
});
</script>
