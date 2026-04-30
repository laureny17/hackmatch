export default {
  name: 'NavBar',
  props: {
    currentPage:     { type: String, required: true },
    profileComplete: { type: Boolean, default: false },
    unreadCount:     { type: Number, default: 0 },
  },
  emits: ['navigate'],
  data() {
    return { showLogoutConfirm: false }
  },
  template: `
    <nav class="app-nav">
      <div class="app-logo" @click="$emit('navigate', 'feed')">
        <div class="logo-spark">✦</div>
        HackMatch
      </div>

      <div class="nav-tabs" v-if="$graffitiSession.value">
        <button
          class="nav-tab"
          :class="{ active: currentPage === 'feed' }"
          @click="$emit('navigate', 'feed')"
        >
          🌐 Feed
        </button>

        <button
          class="nav-tab"
          :class="{ active: currentPage === 'conversations' }"
          @click="$emit('navigate', 'conversations')"
        >
          💬 Messages
          <span v-if="unreadCount > 0" class="nav-unread">{{ unreadCount }}</span>
        </button>

        <button
          class="nav-tab"
          :class="{ active: currentPage === 'profile' }"
          @click="$emit('navigate', 'profile')"
        >
          👤 Profile
        </button>
      </div>

      <div class="nav-right">
        <button
          v-if="!$graffitiSession.value"
          class="btn btn-primary btn-sm"
          @click="$graffiti.login()"
        >
          Log In
        </button>
        <button
          v-else
          class="btn btn-ghost btn-sm"
          @click="showLogoutConfirm = true"
        >
          Log Out
        </button>
      </div>

    </nav>

    <!-- Logout confirmation modal — teleported outside nav to avoid stacking context issues -->
    <Teleport to="body">
      <div v-if="showLogoutConfirm" class="overlay open" @click.self="showLogoutConfirm = false">
        <div class="modal modal-sm">
          <div class="modal-hdr">
            <div class="modal-title">Log out?</div>
            <button class="modal-close" @click="showLogoutConfirm = false">✕</button>
          </div>
          <p style="margin:0 0 20px;color:var(--text2);line-height:1.5">Your profile and messages are saved — you can always log back in.</p>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="showLogoutConfirm = false">Cancel</button>
            <button class="btn btn-primary btn-sm" @click="$graffiti.logout($graffitiSession.value); showLogoutConfirm = false">Log Out</button>
          </div>
        </div>
      </div>
    </Teleport>
  `,
}
