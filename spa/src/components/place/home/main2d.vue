<template>
  <div class="text-center p-3">
    <!-- property/present.tmpl -->
    <h3><strong>Welcome to {{ $store.data.place.name }}</strong></h3>

    <!--
      The information column and its table are the ORIGINAL pre-image structure,
      restored verbatim from 0c6db9e: `flex flex-auto w-2/3` holding a `w-full`
      table whose cells carry no padding of their own.

      That last part is load-bearing. This table uses automatic layout, which
      distributes spare width between the columns in proportion to their content
      widths - so cell padding does not merely add a gutter, it is amplified by
      the distribution. An earlier attempt here added `pr-8` and `whitespace-nowrap`
      to the label cells and pushed the value column out to ~33% of the width,
      where live CTR sits at ~20%. The classic spacing comes from the automatic
      distribution alone; anything added to a cell moves it off.

      The image lives in the remaining third (below) rather than being inserted
      into this table, so the first two columns are sized exactly as they were
      before the image feature existed.
    -->
    <div class="flex flex-row" >
      <div class="flex flex-auto w-2/3">
        <table class="w-full">
          <tr>
            <td class="w-130 font-bold text-left">
              Resident
            </td>
            <td class="text-left">
              {{ memberInfo.username }}
            </td>
          </tr>

          <tr>
            <td class="font-bold text-left">
              Name
            </td>
            <td class="text-left">
              {{ memberInfo.firstName }} {{ memberInfo.lastName }}
            </td>
          </tr>
          <tr v-if="parseInt(this.$store.data.user.id) == parseInt(this.$store.data.place.member_id)
          || this.$store.data.user.admin">
            <td class="font-bold text-left">
              Email
            </td>
            <td class="text-left">
              {{ memberInfo.email }}
            </td>
          </tr>

          <tr>
            <td class="font-bold text-left">
              Immigration
            </td>
            <td class="text-left">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.immigrationDate | dateFormatFilter }}
            </td>
          </tr>
          
          <tr v-if="canAdmin && this.$store.data.place.block">
            <td class="font-bold text-left">
              Last Access
            </td>
            <td class="text-left">
              <!-- format Saturday, October 9 1999 -->
              {{ memberInfo.lastAccess | dateFormatFilter }}
            </td>
          </tr>

          <tr>
            <td class="font-bold text-left">
              Experience
            </td>
            <td class="text-left">
              {{ memberInfo.xp }}
            </td>
          </tr>

          <tr v-if="parseInt(this.$store.data.user.id) === parseInt(this.$store.data.place.member_id)">
            <td class="font-bold text-left">
              Money
            </td>
            <td class="text-left">
               {{ memberInfo.walletBalance }}cc
            </td>
          </tr>

          <!--
          <tr>
            <td class="font-bold text-left">
              Home Page
            </td>
            <td class="text-left">
              <a href="<$HPG>" target="external"><$HPG></a>
            </td>
          </tr>
          -->
        </table>

      </div>
      <!--
        The image occupies the remaining third of the row - the space the classic
        layout already left empty beside the resident details - and is centred in
        it, which is where live CTR draws it.

        `w-1/3` rather than a fixed pixel column ON PURPOSE. A fixed-width flex
        sibling takes its width out of the row before the information column is
        sized, so its exact value silently decides how wide the table is and
        therefore how the first two columns come out. Expressing it as the
        complement of `w-2/3` means the information column is the same two thirds
        it was before the image feature existed, whatever the window width.

        pt-2 gives the image clearance from the page title. Nothing here adds
        padding that could reach the table.
      -->
      <div
        class="flex-none w-1/3 flex flex-col items-center justify-start text-center pt-2"
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
