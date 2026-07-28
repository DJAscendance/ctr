<template>
  <div class="text-center p-3">
    <!-- property/present.tmpl -->
    <h3><strong>Welcome to {{ $store.data.place.name }}</strong></h3>

    <!--
      `w-2/3` on the information column and `w-full` on the table are the classic
      geometry, restored. Adding the image column had replaced them with a
      shrink-to-fit div and a shrink-to-fit table, which collapsed the resident
      details into a narrow strip against the left edge: the label and value
      columns ended up ~120px apart instead of spreading across two thirds of the
      page the way live CTR does.

      With `w-full` back, the table's automatic layout distributes the spare width
      between the two columns again, which is what produces the classic
      separation - it is not a fixed label width, and pinning one (the `w-36` this
      replaces) is what broke it.
    -->
    <div class="flex flex-row" >
      <div class="flex flex-auto w-2/3">
        <table class="w-full">
          <tr>
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Resident
            </td>
            <td class="py-0.5 text-left align-top">
              {{ memberInfo.username }}
            </td>
          </tr>

          <tr>
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Name
            </td>
            <td class="py-0.5 text-left align-top">
              {{ memberInfo.firstName }} {{ memberInfo.lastName }}
            </td>
          </tr>
          <tr v-if="parseInt(this.$store.data.user.id) == parseInt(this.$store.data.place.member_id)
          || this.$store.data.user.admin">
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Email
            </td>
            <td class="py-0.5 text-left align-top">
              {{ memberInfo.email }}
            </td>
          </tr>

          <tr>
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Immigration
            </td>
            <td class="py-0.5 text-left align-top">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.immigrationDate | dateFormatFilter }}
            </td>
          </tr>
          
          <tr v-if="canAdmin && this.$store.data.place.block">
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Last Access
            </td>
            <td class="py-0.5 text-left align-top">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.lastAccess | dateFormatFilter }}
            </td>
          </tr>

          <tr>
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Experience
            </td>
            <td class="py-0.5 text-left align-top">
              {{ memberInfo.xp }}
            </td>
          </tr>

          <tr v-if="parseInt(this.$store.data.user.id) === parseInt(this.$store.data.place.member_id)">
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Money
            </td>
            <td class="py-0.5 text-left align-top">
               {{ memberInfo.walletBalance }}cc
            </td>
          </tr>

          <!--
          <tr>
            <td class="pr-8 py-0.5 font-bold text-left align-top whitespace-nowrap">
              Home Page
            </td>
            <td class="py-0.5 text-left align-top">
              <a href="<$HPG>" target="external"><$HPG></a>
            </td>
          </tr>
          -->
        </table>

      </div>
      <!--
        pl-6/pr-2/pt-2 keep the image off the resident details on one side and off
        the window edge on the other, and clear of the page title above it. Without
        them a 200x200 image sat flush against both the right and top edges, which
        is what made the restored image area feel bolted on rather than part of the
        page.

        232px = the 200px image plus that 24+8 of padding. Widths are border-box
        here, so leaving the column at 200 would have taken the padding OUT of the
        image's own space and pushed a full-width image back against the edge -
        the padding has to be added to the declared width, not absorbed by it.
      -->
      <div
        class="flex-none flex flex-col items-center justify-start text-center pl-6 pr-2 pt-2"
        style="width: 232px;"
      >
        <img
          v-if="homeImage"
          :src="'/assets/homes-uploads/' + homeImage"
          alt="Home image"
          style="max-width: 200px; max-height: 200px;"
        />
        <img
          v-else-if="homeImagePending"
          src="/assets/img/not-checked.gif"
          alt="Home image awaiting moderation"
          title="This image is awaiting review by a Block Leader."
          style="max-width: 200px; max-height: 200px;"
        />
        <small v-else><i>No image uploaded yet!</i></small>
      </div>
    </div>
    <!-- Object Storage Areas is a separate section, not a continuation of the
         identity fields; it needs a gap that the tightened layout had lost. -->
    <div class="mt-4" v-if="showStorage">
      <storage :member_id="this.$store.data.place.member_id"></storage>
    </div>
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
      homeImagePending: false,
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
        // The API only returns the real image once it has passed moderation; a pending
        // image is signalled via imagePending so we can show the "NOT CHECKED!" placeholder.
        this.homeImage = homeResponse.data.homeRecord?.image || null;
        this.homeImagePending = homeResponse.data.homeRecord?.imagePending || false;
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
