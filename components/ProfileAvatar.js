export default {
  name: "ProfileAvatar",
  props: {
    profile: { type: Object, default: null },
    actor: { type: String, default: "" },
    initials: { type: String, default: "?" },
    gradient: { type: String, default: "" },
    size: { type: String, default: "md" },
    showStatus: { type: Boolean, default: false },
    statusLabel: { type: String, default: "" },
  },

  computed: {
    avatarUrl() {
      return this.profile?.value?.avatar ?? null;
    },
    isInlineImage() {
      return !!this.avatarUrl && this.avatarUrl.startsWith("data:");
    },
    classes() {
      const base = ["profile-avatar", "profile-avatar-" + this.size];
      if (this.showStatus) base.push("status-ring-" + this.status);
      return base;
    },
    fallbackStyle() {
      return { background: this.gradient };
    },
    status() {
      return this.profile?.value?.status ?? "green";
    },
  },

  template: `
    <div class="profile-avatar-wrap">
      <div :class="classes" :style="!avatarUrl ? fallbackStyle : null">
        <img
          v-if="isInlineImage"
          class="profile-avatar-img"
          :src="avatarUrl"
          alt=""
        >
        <graffiti-get-media
          v-else-if="avatarUrl"
          v-slot="{ media }"
          :url="avatarUrl"
          :accept="{ types: ['image/*'] }"
        >
          <img v-if="media?.dataUrl" class="profile-avatar-img" :src="media.dataUrl" alt="">
        </graffiti-get-media>
        <span v-else>{{ initials }}</span>
      </div>
    </div>
  `,
};
