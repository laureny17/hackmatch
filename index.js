import { createApp, ref, computed, watch } from 'vue'
import { GraffitiDecentralized } from '@graffiti-garden/implementation-decentralized'
import { GraffitiPlugin, useGraffitiSession, useGraffitiDiscover } from '@graffiti-garden/wrapper-vue'

import NavBar            from './components/NavBar.js'
import FeedPage          from './components/FeedPage.js'
import ConversationsPage from './components/ConversationsPage.js'
import ProfilePage       from './components/ProfilePage.js'

import { HACKMATCH_CHANNEL, PROFILE_SCHEMA } from './constants.js'

const App = {
  components: { NavBar, FeedPage, ConversationsPage, ProfilePage },

  setup() {
    const session = useGraffitiSession()
    const currentPath = ref(window.location.hash.replace(/^#/, '') || '/profile')

    function normalizePath(path) {
      if (!path || path === '/') return '/profile'
      return path.startsWith('/') ? path : '/' + path
    }

    function syncRoute() {
      currentPath.value = normalizePath(window.location.hash.replace(/^#/, ''))
    }

    window.addEventListener('hashchange', syncRoute)
    if (!window.location.hash || window.location.hash === '#/') {
      window.location.hash = '#/profile'
    } else {
      syncRoute()
    }

    // ── Check if current user has a complete profile ──────────────────
    const { objects: profileObjects, isFirstPoll: profileLoading } = useGraffitiDiscover(
      () => session.value ? [HACKMATCH_CHANNEL] : [],
      PROFILE_SCHEMA,
      session,
    )

    const myProfile = computed(() =>
      profileObjects.value
        .filter(p => p.actor === session.value?.actor)
        .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null
    )

    const profileComplete = computed(() => !!myProfile.value)

    // ── Local cache so we don't flash loading states on return visits ──
    const CACHE_KEY = 'hm_profile_complete'
    const cachedComplete = ref(localStorage.getItem(CACHE_KEY) === '1')

    // Effective complete: trust live data once loaded, fall back to cache while still loading
    const effectiveComplete = computed(() =>
      profileComplete.value || (cachedComplete.value && profileLoading.value)
    )

    // Only ever write '1' — never write '0' (avoids race where poll finishes before objects arrive)
    watch(profileComplete, complete => {
      if (complete) {
        localStorage.setItem(CACHE_KEY, '1')
        cachedComplete.value = true
      }
    })

    const lockedPage  = ref(null)

    const routeChatId = computed(() => {
      const match = currentPath.value.match(/^\/messages\/(.+)$/)
      return match ? decodeURIComponent(match[1]) : null
    })

    const routedPage = computed(() => {
      if (currentPath.value.startsWith('/messages')) return 'conversations'
      if (currentPath.value.startsWith('/profile')) return 'profile'
      return 'feed'
    })

    const currentPage = computed(() => {
      return routedPage.value
    })

    // Clear everything on logout
    watch(() => session.value, s => {
      if (!s) {
        navigate('profile')
        localStorage.removeItem(CACHE_KEY)
        localStorage.removeItem('hm_profile_form')
        cachedComplete.value = false
      }
    })

    // Unlock locked page once profile is confirmed
    watch(effectiveComplete, complete => {
      if (complete && lockedPage.value) {
        goTo(pagePath(lockedPage.value))
        lockedPage.value  = null
      }
    })

    function pagePath(page) {
      if (page === 'conversations') return '/messages'
      if (page === 'profile') return '/profile'
      return '/feed'
    }

    function goTo(path) {
      window.location.hash = '#' + path
      currentPath.value = path
    }

    function navigate(page) {
      lockedPage.value = null
      if ((page === 'feed' || page === 'conversations') && !effectiveComplete.value) {
        lockedPage.value = page
        return
      }
      goTo(pagePath(page))
    }

    // ── Cross-page conversation opening ───────────────────────────────
    // When Feed emits 'open-conversation', store actor + optional message
    // and switch to conversations page.
    const pendingConvActor   = ref(null)
    const pendingConvMessage = ref(null)
    const unreadCounts = ref({ active: 0, archived: 0 })

    function openConversation(actorId, firstMessage) {
      pendingConvActor.value   = actorId
      pendingConvMessage.value = firstMessage ?? null
      navigate('conversations')
    }

    function clearPending() {
      pendingConvActor.value   = null
      pendingConvMessage.value = null
    }

    function updateUnreadCounts(counts) {
      unreadCounts.value = counts
    }

    return {
      session, currentPath, currentPage, lockedPage, routedPage, routeChatId,
      profileComplete: effectiveComplete, navigate,
      pendingConvActor, pendingConvMessage,
      openConversation, clearPending, unreadCounts, updateUnreadCounts,
    }
  },

  template: `
    <NavBar
      :currentPage="currentPage"
      :profileComplete="profileComplete"
      :unreadCount="unreadCounts.active"
      @navigate="navigate"
    />

    <main>
      <!-- Locked page message (only shown after load completes) -->
      <div v-if="lockedPage" class="lock-screen">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">Profile Incomplete</div>
        <div class="lock-desc">
          Complete your profile first to access
          <strong>{{ lockedPage === 'feed' ? 'Feed' : 'Messages' }}</strong>.
          All fields are required.
        </div>
        <button class="btn btn-primary" @click="navigate('profile')">
          Set Up Profile →
        </button>
      </div>

      <template v-else>
        <FeedPage
          v-if="routedPage === 'feed'"
          @open-conversation="actor => openConversation(actor)"
        />

        <!-- v-show (not v-if) keeps ConversationsPage always mounted so its
             Graffiti discover hooks run in the background and unread counts
             are available before the user first navigates to Messages. -->
        <ConversationsPage
          v-show="routedPage === 'conversations'"
          :openWithActor="pendingConvActor"
          :openWithMessage="pendingConvMessage"
          :routeChatId="routeChatId"
          @clear-pending="clearPending"
          @update-unread-counts="updateUnreadCounts"
        />

        <ProfilePage
          v-if="routedPage === 'profile'"
          @profile-saved="navigate('feed')"
          @navigate="navigate"
        />
      </template>
    </main>
  `,
}

createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
    // Swap to GraffitiLocal for offline testing:
    // graffiti: new GraffitiLocal(),
  })
  .mount('#app')
