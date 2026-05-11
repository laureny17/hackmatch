import {
  avatarGradient,
  initials,
  trackColor,
  PROFILE_QUESTIONS,
} from "../constants.js";
import ProfileAvatar from "./ProfileAvatar.js";
import PhotoGallery from "./PhotoGallery.js";

export default {
  name: "HackerCard",
  components: { ProfileAvatar, PhotoGallery },
  props: {
    profile: { type: Object, required: true }, // Graffiti object
    isSelf: { type: Boolean, default: false },
    // in profile-modal mode: no reply/message buttons
    readOnly: { type: Boolean, default: false },
    conversationStarted: { type: Boolean, default: false },
  },
  emits: ["reply", "message", "hide"],

  setup(props) {
    return { avatarGradient, initials, trackColor, PROFILE_QUESTIONS };
  },

  computed: {
    v() {
      return this.profile.value;
    },
    grad() {
      return this.avatarGradient(this.profile.actor);
    },
    ini() {
      return this.initials(this.profile);
    },

    statusLabel() {
      if (this.v.status === "green")
        return `Looking for ${this.v.lookingForCount ?? "?"} teammate${(this.v.lookingForCount ?? 2) !== 1 ? "s" : ""}`;
      if (this.v.status === "yellow") return "Deciding on teammates";
      return "Team is full";
    },
  },

  template: `
    <div class="hacker-card">

      <!-- Header -->
      <div class="card-header">
        <ProfileAvatar
          :profile="profile"
          :actor="profile.actor"
          :initials="ini"
          :gradient="grad"
          size="lg"
          :showStatus="true"
        />
        <div class="card-info">
          <div class="card-name-row">
            <span class="card-name">{{ v.name?.first }} {{ v.name?.last }}</span>
            <span v-if="v.pronouns" class="card-pronouns">({{ v.pronouns }})</span>
            <span v-if="conversationStarted" class="conversation-badge">Conversation started</span>
          </div>
          <div class="card-meta">{{ v.major }} @ {{ v.school }} · {{ v.year }}</div>
          <div v-if="v.status" class="card-looking-for" :class="v.status">
            <template v-if="v.status === 'green'">Looking for {{ v.lookingForCount ?? '?' }} teammate{{ (v.lookingForCount ?? 2) !== 1 ? 's' : '' }}</template>
            <template v-else-if="v.status === 'yellow'">Deciding on teammates</template>
            <template v-else>Team is full</template>
          </div>
        </div>
      </div>

      <!-- Track tags -->
      <div class="track-tags" v-if="v.tracks?.length">
        <span
          v-for="t in v.tracks"
          :key="t"
          class="track-tag"
          :class="trackColor(t)"
        >{{ t }}</span>
      </div>

      <!-- Fields of interest -->
      <div class="track-tags fields-tags" v-if="v.fieldsOfInterest?.length">
        <span
          v-for="f in v.fieldsOfInterest"
          :key="f"
          class="track-tag field-tag"
        >{{ f }}</span>
      </div>

      <!-- Q&A -->
      <div class="qa-section">
        <div
          v-for="(q, i) in PROFILE_QUESTIONS"
          :key="i"
          class="qa-item"
        >
          <div class="qa-question">{{ q }}</div>
          <div class="qa-row">
            <div class="qa-answer">{{ v.answers?.['q' + (i+1)] }}</div>
            <button
              v-if="!readOnly && !isSelf && !conversationStarted"
              class="btn-reply has-tt"
              @click="$emit('reply', { profile, questionIdx: i })"
              title="Reply"
            >
              💬
              <span class="tt">Reply to this</span>
            </button>
          </div>
        </div>
      </div>

      <PhotoGallery :photos="v.gallery || []" />

      <!-- Footer -->
      <div v-if="!readOnly && !isSelf" class="card-footer">
        <button class="btn btn-message btn-sm" @click="$emit('message', profile)">
          💬 {{ conversationStarted ? 'Open chat' : 'Message' }}
        </button>
        <button class="btn-hide-person" @click="$emit('hide', profile.actor)" title="Hide from feed">
          Hide
        </button>
      </div>

    </div>
  `,
};
