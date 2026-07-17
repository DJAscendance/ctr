<template>
  <div class="text-center p-3">
    <!-- property/present.tmpl -->
    <h3><strong>Welcome to {{ $store.data.place.name }}</strong></h3>

    <div class="flex flex-row" >
      <div class="flex flex-auto">
        <table>
          <tr>
            <td class="w-36 pr-4 font-bold text-left">
              Resident
            </td>
            <td class="text-left">
              {{ memberInfo.username }}
            </td>
          </tr>

          <tr>
            <td class="w-36 pr-4 font-bold text-left">
              Name
            </td>
            <td class="text-left">
              {{ memberInfo.firstName }} {{ memberInfo.lastName }}
            </td>
          </tr>
          <tr v-if="parseInt(this.$store.data.user.id) == parseInt(this.$store.data.place.member_id)
          || this.$store.data.user.admin">
            <td class="w-36 pr-4 font-bold text-left">
              Email
            </td>
            <td class="text-left">
              {{ memberInfo.email }}
            </td>
          </tr>

          <tr>
            <td class="w-36 pr-4 font-bold text-left">
              Immigration
            </td>
            <td class="text-left">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.immigrationDate | dateFormatFilter }}
            </td>
          </tr>
          
          <tr v-if="canAdmin && this.$store.data.place.block">
            <td class="w-36 pr-4 font-bold text-left">
              Last Access
            </td>
            <td class="text-left">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.lastAccess | dateFormatFilter }}
            </td>
          </tr>

          <tr>
            <td class="w-36 pr-4 font-bold text-left">
              Experience
            </td>
            <td class="text-left">
              {{ memberInfo.xp }}
            </td>
          </tr>

          <tr v-if="parseInt(this.$store.data.user.id) === parseInt(this.$store.data.place.member_id)">
            <td class="w-36 pr-4 font-bold text-left">
              Money
            </td>
            <td class="text-left">
               {{ memberInfo.walletBalance }}cc
            </td>
          </tr>

          <!--
          <tr>
            <td class="w-36 pr-4 font-bold text-left">
              Home Page
            </td>
            <td class="text-left">
              <a href="<$HPG>" target="external"><$HPG></a>
            </td>
          </tr>
          -->
        </table>

      </div>
      <div
        class="flex-none flex flex-col items-center justify-start text-center"
        style="width: 200px;"
      >
        <img
          v-if="homeImage"
          :src="'/assets/homes-uploads/' + homeImage"
          style="max-width: 200px; max-height: 200px;"
        />
        <small v-else><i>No image uploaded yet!</i></small>
      </div>
    </div>
    <storage :member_id="this.$store.data.place.member_id" v-if="showStorage"></storage>
  </div>
</template>

<script lang="ts">
import { dateFormatFilter } from '@/helpers/fiters';
import Vue from 'vue';
import Storage from "../../storage/Storage.vue";

export default Vue.extend({
  name: "HomeMain2d",
  components: { Storage },
  data: () => {
    return {
      memberInfo: {} as any,
      canAdmin: false,
      loaded: false,
      showStorage: false,
      homeImage: null,
    };
  },

  methods: {
    async getData() {
      this.showStorage = false;
      try {
        const response = await this.$http.get("/member/info/"+this.$store.data.place.member_id);
        this.memberInfo = response.data.memberInfo;
        if(this.$store.data.place.member_id === this.$store.data.user.id){
          this.showStorage = true;
        }
        const homeResponse = await this.$http.get(`/home/${this.memberInfo.username}`);
        this.homeImage = homeResponse.data.homeRecord?.image || null;
      } catch (error) {
        console.log(error);
      }
    },
    async checkAdmin() {
      try {
        await this.$http.get(
          `/block/${  this.$store.data.place.block.id  }/can_admin`,
        );
        this.canAdmin = true;
      } catch (e) {
        console.log(e);
      }
    },
  },
  mounted() {
    this.getData();
    this.checkAdmin();
  },
  watch: {
    "$store.data.place.block": {
      handler() {
        if (this.$route.params.username) {
          this.loaded = true;
          this.checkAdmin();
        }
      },
    },
  },
});
</script>
