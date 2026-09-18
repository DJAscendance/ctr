<template>
  <div>
    <div v-if="error">
      <div class="text-red-600">
        {{ error }}
      </div>
    </div>

    <div v-if="!error && roles.length > 0">
      <table>
        <tbody>
          <tr>
            <td class="px-4 py-2 font-bold text-center">Role</td>
            <td class="px-4 py-2 font-bold text-center">Place</td>
            <td />
          </tr>

          <tr
            class="hover:bg-gray-600"
            v-for="id in roles"
            :key="id"
          >
            <td class="border text-white px-4 py-2">
              {{ id.name }}
            </td>

            <td class="border text-white px-4 py-2">
              <span v-if="id.place === null">City Wide</span>
              <span v-else>{{ id.place }}</span>
            </td>

            <td class="border text-red-500 px-4 py-2">
              <button
                v-if="canFireRole(id.name)"
                class="border text-white px-4 py-2 bg-red-900"
                @click="openFireModal(id)"
              >
                Fire
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showFireModal">
      <div class="fixed inset-0 z-50 flex justify-center items-center">
        <div
          class="
            flex flex-col w-2/6 max-w-5xl rounded-lg
            shadow-lg bg-red-300 text-red-800
          "
        >
          <div class="p-5">
            <div class="flex justify-between items-start">
              <h3 class="text-2xl font-semibold">
                Terminate User?
              </h3>

              <button
                class="p-1 leading-none"
                @click="closeFireModal"
              >
                <div class="text-xl font-semibold h-6 w-6">
                  <span>x</span>
                </div>
              </button>
            </div>
          </div>

          <div class="p-6">
            <p>
              Are you sure you want to terminate this user?
            </p>

            <label
              class="block mt-3 mb-1"
              for="fire-reason"
            >
              Reason (required)
            </label>

            <textarea
              id="fire-reason"
              class="text-black w-full"
              v-model="reason"
              rows="3"
              maxlength="255"
              placeholder="Why is this role being removed?"
            ></textarea>

            <div
              class="text-red-800 font-bold mt-1"
              v-if="modalError"
            >
              {{ modalError }}
            </div>
          </div>

          <div class="p-6 flex justify-end items-center">
            <button
              class="btn pr-1"
              @click="closeFireModal"
            >
              Cancel
            </button>

            <button
              class="btn"
              @click="fireUser"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>

      <div class="opacity-50 fixed inset-0 z-60 bg-black"></div>
    </div>
  </div>
</template>

<script>
export default {
  name: "UserFireRoles",

  data() {
    return {
      error: "",
      fireId: null,
      firePlace: null,
      fireRoleName: null,
      loaded: false,
      modalError: "",
      reason: "",
      roles: [],
      showFireModal: false,
      canManageSecurityRoles: false,
    };
  },

  props: ["accessLevel"],

  methods: {
    async getSecurityRolePermission() {
      try {
        const response =
          await this.$http.get("/member/can-manage-security-roles");

        this.canManageSecurityRoles = response.data.canManage;
      } catch (error) {
        this.canManageSecurityRoles = false;
      }
    },

    canFireRole(roleName) {
      if (this.accessLevel.includes("admin")) {
        return true;
      }

      if (!this.canManageSecurityRoles) {
        return false;
      }

      const securityRoles = [
        "Security Captain",
        "Security Lieutenant",
        "Security Sergeant",
        "Security Officer",
        "Security Advisor",
        "Jail Guard",
      ];

      return securityRoles.includes(roleName);
    },

    openFireModal(role) {
      this.fireId = role.id;
      this.firePlace = role.place_id;
      this.fireRoleName = role.name;
      this.reason = "";
      this.modalError = "";
      this.showFireModal = true;
    },

    closeFireModal() {
      this.showFireModal = false;
      this.reason = "";
      this.modalError = "";
    },

    async fireUser() {
      // The API refuses a role change without an operator reason (CTBL-0025,
      // baseline section 11). The modal stays open and says so rather than
      // sending a request that cannot succeed, and never supplies its own text.
      const reason = this.reason.trim();

      if (!reason) {
        this.modalError = "Please enter a reason";
        return;
      }

      this.showFireModal = false;

      try {
        await this.$http.post("/admin/firerole", {
          member_id: this.$route.params.id,
          role_id: this.fireId,
          place_id: this.firePlace,
          reason: reason,
        });

        this.reason = "";
        await this.getRoles();
      } catch (error) {
        this.error =
          "There was an error while terminating role";
      }
    },

    async getRoles() {
      this.error = "";

      try {
        const response =
          await this.$http.get(
            `/member/roles/${this.$route.params.id}`,
          );

        this.roles = response.data.roles;
      } catch (error) {
        this.error = error;
      }
    },
  },

  async mounted() {
    await this.getSecurityRolePermission();

    if (
      !this.accessLevel.includes("admin") &&
      !this.canManageSecurityRoles
    ) {
      this.$router.push({ name: "restrictedaccess" });
      return;
    }

    await this.getRoles();
  },
};
</script>
