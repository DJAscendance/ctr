<template>
  <div class="w-full flex flex-col items-center">
    <div class="flex justify-center w-full mb-8">
      <img
        src="/assets/img/citizen-directory.jpg"
        alt="Citizen Directory"
        class="max-w-full h-auto"
      />
    </div>
    <div class="flex justify-center w-full mb-5">
      Search:
      <span class="mx-8">
        <input
          v-model="search"
          class="text-black"
          type="text"
          placeholder="Search Username"
          @keyup.enter="fetchCitizens"
        />
      </span>
      <button class="btn" @click="fetchCitizens">Search</button>
    </div>
    <div class="flex justify-center w-full mb-5">
      <button
        class="btn mr-4"
        :class="{ 'btn-disabled': offset === 0 }"
        :disabled="offset === 0"
        @click="prev"
      >
        Prev
      </button>
      <button
        class="btn ml-4"
        :class="{ 'btn-disabled': offset + limit >= citizensCount }"
        :disabled="offset + limit >= citizensCount"
        @click="next"
      >
        Next
      </button>
    </div>
    <div class="flex justify-center text-center w-full">
      <table class="w-2/3 border-double border-4 border-gray-400">
        <tr>
          <th class="border-double border-4 border-gray-400 font-chat">No</th>
          <th class="border-double border-4 border-gray-400 font-chat">Username</th>
          <th class="border-double border-4 border-gray-400 font-chat">Role</th>
          <th class="border-double border-4 border-gray-400 font-chat">Citizen Since</th>
          <th class="border-double border-4 border-gray-400 font-chat">Status</th>
        </tr>
        <tr v-for="(citizen, index) in citizens" :key="citizen.id">
          <td class="border-double border-4 border-gray-400">
            {{ offset + index + 1 }}
          </td>
          <td class="border-double border-4 border-gray-400">
            <router-link v-if="citizen.hasHome" :to="'/home/' + citizen.username">
              {{ citizen.username }}
            </router-link>
            <span v-else>{{ citizen.username }}</span>
          </td>
          <td class="border-double border-4 border-gray-400">
            {{ citizen.primaryRoleName || "Citizen" }}
          </td>
          <td class="border-double border-4 border-gray-400">
            {{ formatDate(citizen.immigrationDate) }}
          </td>
          <td class="border-double border-4 border-gray-400">
            <span :class="citizen.online ? 'text-green-500' : 'text-gray-400'">
              {{ citizen.online ? "Online" : "Offline" }}
            </span>
          </td>
        </tr>
      </table>
    </div>
  </div>
</template>

<script>
import Vue from "vue";

export default Vue.extend({
  name: "DirectoryPage",
  data: () => {
    return {
      citizens: [],
      citizensCount: 0,
      limit: 20,
      offset: 0,
      search: "",
    };
  },
  methods: {
    async fetchCitizens() {
      const response = await this.$http.get("/member/directory", {
        limit: this.limit,
        offset: this.offset,
        search: this.search,
      });
      this.citizens = response.data.citizens;
      this.citizensCount = response.data.total[0].count;
    },
    next() {
      this.offset += this.limit;
      this.fetchCitizens();
    },
    prev() {
      this.offset -= this.limit;
      this.fetchCitizens();
    },
    formatDate(value) {
      if (!value) return "";
      return new Date(value).toLocaleDateString();
    },
  },
  mounted() {
    this.fetchCitizens();
  },
});
</script>
