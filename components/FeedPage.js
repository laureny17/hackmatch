import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  HACKMATCH_CHANNEL,
  PROFILE_SCHEMA,
  CONVERSATION_SCHEMA,
  TRACKS,
  YEARS,
  PROFILE_QUESTIONS,
  conversationPairKey,
  conversationParticipantKey,
  conversationParticipants,
} from "../constants.js";
import HackerCard from "./HackerCard.js";

export default {
  name: "FeedPage",
  components: { HackerCard },
  emits: ["open-conversation"],

  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    // ── Feed profile cache (localStorage) — instant render on load ────
    const FEED_PROFILE_CACHE_KEY = 'hm_feed_profiles';
    function loadFeedProfileCache() {
      try { return JSON.parse(localStorage.getItem(FEED_PROFILE_CACHE_KEY) || '[]'); }
      catch { return []; }
    }
    const feedProfileCache = ref(loadFeedProfileCache());

    // Discover all public profiles
    const { objects: profileObjects, isFirstPoll: isLoading } =
      useGraffitiDiscover(
        [HACKMATCH_CHANNEL],
        PROFILE_SCHEMA,
        undefined, // public — no session needed
        true, // realtime polling
      );

    // Update feed cache whenever live profiles arrive
    watch(profileObjects, (profiles) => {
      if (!profiles.length) return;
      const byActor = new Map(feedProfileCache.value.map(p => [p.actor, p]));
      for (const p of profiles) {
        const c = byActor.get(p.actor);
        if (!c || p.value.published > c.value.published) {
          const { gallery, ...rest } = p.value; // skip gallery (too large for localStorage)
          byActor.set(p.actor, { actor: p.actor, value: rest });
        }
      }
      const next = [...byActor.values()].slice(0, 300);
      feedProfileCache.value = next;
      try { localStorage.setItem(FEED_PROFILE_CACHE_KEY, JSON.stringify(next)); } catch {}
    }, { immediate: true });

    const { objects: convObjects } = useGraffitiDiscover(
      () => (session.value ? [session.value.actor] : []),
      CONVERSATION_SCHEMA,
      session,
      true,
    );

    function getDeletedConversations() {
      try {
        return new Set(
          JSON.parse(localStorage.getItem("hm_deleted_conversations") || "[]"),
        );
      } catch {
        return new Set();
      }
    }
    function getDeletedChannelHistory() {
      try {
        return new Set(
          JSON.parse(
            localStorage.getItem("hm_deleted_channels_history") || "[]",
          ),
        );
      } catch {
        return new Set();
      }
    }
    function saveDeletedChannelHistory(s) {
      localStorage.setItem(
        "hm_deleted_channels_history",
        JSON.stringify([...s]),
      );
    }

    const deletedConversations = ref(getDeletedConversations());
    const deletedChannelHistory = ref(getDeletedChannelHistory());

    function refreshDeletedConversations() {
      deletedConversations.value = getDeletedConversations();
      deletedChannelHistory.value = getDeletedChannelHistory();
    }

    function onDeletedConversationsUpdated() {
      refreshDeletedConversations();
    }

    onMounted(() => {
      window.addEventListener(
        "hm-deleted-conversations-updated",
        onDeletedConversationsUpdated,
      );
      window.addEventListener("storage", onDeletedConversationsUpdated);
    });
    onUnmounted(() => {
      window.removeEventListener(
        "hm-deleted-conversations-updated",
        onDeletedConversationsUpdated,
      );
      window.removeEventListener("storage", onDeletedConversationsUpdated);
    });

    function convKey(conv) {
      const participants = conv.value.participants ?? [];
      if (participants.length < 2) return conv.value.channel;
      if (participants.length > 2) {
        return (
          conv.value.participantKey ?? conversationParticipantKey(participants)
        );
      }
      return conv.value.pairKey ?? conversationPairKey(...participants);
    }

    const latestConversationsByChannel = computed(() => {
      const byChannel = new Map();
      for (const conv of convObjects.value) {
        const channel = conv.value.channel;
        if (!channel) continue;
        const existing = byChannel.get(channel);
        if (!existing || conv.value.published > existing.value.published) {
          byChannel.set(channel, conv);
        }
      }
      return [...byChannel.values()];
    });

    // Deduplicate: one profile per actor (keep most recent), seed from cache
    const allProfiles = computed(() => {
      const myActor = session.value?.actor;
      const byActor = new Map();
      // Seed from cache first so profiles show instantly on load
      for (const p of feedProfileCache.value) {
        if (p.actor !== myActor) byActor.set(p.actor, p);
      }
      // Live data overrides cache
      for (const p of profileObjects.value) {
        if (p.actor === myActor) continue;
        const existing = byActor.get(p.actor);
        if (!existing || p.value.published > existing.value.published)
          byActor.set(p.actor, p);
      }
      return [...byActor.values()];
    });

    const myProfile = computed(() => {
      if (!session.value) return null;
      return (
        profileObjects.value
          .filter((p) => p.actor === session.value.actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null
      );
    });

    function currentParticipantsWith(actorId) {
      return conversationParticipants(
        session.value?.actor,
        actorId,
        myProfile.value?.value.confirmedTeammates ?? [],
      );
    }

    // ── Search + Filter ───────────────────────────────────────────────
    const searchQuery = ref("");
    const filters = ref({
      tracks: [],
      years: [],
      statuses: [],
      lookingForCount: "",
    });
    const showFilterModal = ref(false);

    // Temporary filter state inside the modal (committed on Apply)
    const pendingFilters = ref({
      tracks: [],
      years: [],
      statuses: [],
      lookingForCount: "",
    });
    function openFilter() {
      pendingFilters.value = {
        tracks: [...filters.value.tracks],
        years: [...filters.value.years],
        statuses: [...filters.value.statuses],
        lookingForCount: filters.value.lookingForCount,
      };
      showFilterModal.value = true;
    }
    function applyFilters() {
      filters.value = {
        tracks: [...pendingFilters.value.tracks],
        years: [...pendingFilters.value.years],
        statuses: [...pendingFilters.value.statuses],
        lookingForCount: pendingFilters.value.lookingForCount,
      };
      showFilterModal.value = false;
    }
    function clearFilters() {
      pendingFilters.value = {
        tracks: [],
        years: [],
        statuses: [],
        lookingForCount: "",
      };
    }
    function togglePendingTrack(t) {
      const i = pendingFilters.value.tracks.indexOf(t);
      if (i >= 0) pendingFilters.value.tracks.splice(i, 1);
      else pendingFilters.value.tracks.push(t);
    }
    function togglePendingYear(y) {
      const i = pendingFilters.value.years.indexOf(y);
      if (i >= 0) pendingFilters.value.years.splice(i, 1);
      else pendingFilters.value.years.push(y);
    }
    function togglePendingStatus(s) {
      const i = pendingFilters.value.statuses.indexOf(s);
      if (i >= 0) pendingFilters.value.statuses.splice(i, 1);
      else pendingFilters.value.statuses.push(s);
      if (s === "green" && i >= 0) pendingFilters.value.lookingForCount = "";
    }
    function removeFilterTrack(t) {
      filters.value.tracks = filters.value.tracks.filter((x) => x !== t);
    }
    function removeFilterYear(y) {
      filters.value.years = filters.value.years.filter((x) => x !== y);
    }
    function removeFilterStatus(s) {
      filters.value.statuses = filters.value.statuses.filter((x) => x !== s);
    }
    function clearLookingForCount() {
      filters.value.lookingForCount = "";
    }
    function setPendingLookingForCount(count) {
      pendingFilters.value.lookingForCount = count;
    }

    const hasActiveFilters = computed(
      () =>
        filters.value.tracks.length ||
        filters.value.years.length ||
        filters.value.statuses.length ||
        (filters.value.statuses.includes("green") &&
          filters.value.lookingForCount !== ""),
    );

    const filteredProfiles = computed(() => {
      let list = allProfiles.value;
      const q = searchQuery.value.trim().toLowerCase();
      if (q) {
        list = list.filter((p) => {
          const v = p.value;
          return [
            v.name?.first,
            v.name?.last,
            v.school,
            v.year,
            v.major,
            ...(v.tracks ?? []),
            v.answers?.q1,
            v.answers?.q2,
            v.answers?.q3,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q);
        });
      }
      if (filters.value.tracks.length) {
        list = list.filter((p) =>
          filters.value.tracks.some((t) => p.value.tracks?.includes(t)),
        );
      }
      if (filters.value.years.length) {
        list = list.filter((p) => filters.value.years.includes(p.value.year));
      }
      if (filters.value.statuses.length) {
        list = list.filter((p) =>
          filters.value.statuses.includes(p.value.status),
        );
      }
      if (
        filters.value.statuses.includes("green") &&
        filters.value.lookingForCount !== ""
      ) {
        const count = Number(filters.value.lookingForCount);
        list = list.filter(
          (p) =>
            p.value.status === "green" &&
            Number(p.value.lookingForCount) === count,
        );
      }
      return list;
    });

    function hasConversation(actorId) {
      return !!existingConversationWith(actorId);
    }

    function saveDeletedConversations(s) {
      localStorage.setItem("hm_deleted_conversations", JSON.stringify([...s]));
      deletedConversations.value = new Set(s);
      window.dispatchEvent(new CustomEvent("hm-deleted-conversations-updated"));
    }

    function addDeletedChannelHistory(channel) {
      if (!channel) return;
      const next = new Set(deletedChannelHistory.value);
      if (next.has(channel)) return;
      next.add(channel);
      deletedChannelHistory.value = next;
      saveDeletedChannelHistory(next);
    }

    function existingConversationWith(actorId) {
      const mine = session.value?.actor;
      if (!mine || !actorId) return null;
      const participantsForChat = currentParticipantsWith(actorId);
      const participantKey = conversationParticipantKey(participantsForChat);
      const pairKey = conversationPairKey(mine, actorId);
      const deleted = deletedConversations.value;
      const hiddenChannels = new Set([
        ...deletedChannelHistory.value,
        ...[...deleted].filter((key) => !key.startsWith("pair:")),
      ]);
      const hiddenPairs = new Set();
      for (const conv of latestConversationsByChannel.value) {
        const participants = conv.value.participants ?? [];
        const key = convKey(conv);
        if (!participants.includes(mine) || !key) continue;
        if (deleted.has("pair:" + key)) {
          hiddenPairs.add(key);
        }
      }
      return (
        latestConversationsByChannel.value.find((conv) => {
          const participants = conv.value.participants ?? [];
          const key = convKey(conv);
          return (
            (key === participantKey ||
              (participantsForChat.length === 2 && key === pairKey)) &&
            !deleted.has(conv.value.channel) &&
            !hiddenChannels.has(conv.value.channel) &&
            !hiddenPairs.has(key)
          );
        }) ?? null
      );
    }

    async function sendFeedMessage(actorId, message) {
      if (!session.value || !actorId || !message?.content?.trim()) return;
      const mine = session.value.actor;
      const participants = currentParticipantsWith(actorId);
      const pairKey = conversationPairKey(mine, actorId);
      const participantKey = conversationParticipantKey(participants);
      const channel = crypto.randomUUID();
      let conv = existingConversationWith(actorId);

      if (!conv) {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Conversation",
              channel,
              participants,
              pairKey,
              participantKey,
              published: Date.now(),
            },
            channels: participants,
            allowed: participants,
          },
          session.value,
        );
        conv = { value: { channel, participants } };
      }

      const value = {
        content: message.content.trim(),
        channel: conv.value.channel,
        published: Date.now(),
      };
      if (message.inReplyTo) value.inReplyTo = message.inReplyTo;
      await graffiti.post(
        {
          value,
          channels: [conv.value.channel],
          allowed: conv.value.participants ?? participants,
        },
        session.value,
      );

      window.dispatchEvent(
        new CustomEvent("hm-local-message", {
          detail: {
            channel: conv.value.channel,
            content: value.content,
            published: value.published,
          },
        }),
      );
    }

    // ── Reply modal ───────────────────────────────────────────────────
    const replyModal = ref(null); // { profile, questionIdx }
    const replyText = ref("");

    function openReply({ profile, questionIdx }) {
      replyModal.value = { profile, questionIdx };
      replyText.value = "";
    }
    function closeReply() {
      replyModal.value = null;
    }
    async function sendReply() {
      if (!replyText.value.trim() || !replyModal.value) return;
      try {
        const questionText = PROFILE_QUESTIONS[replyModal.value.questionIdx];
        const answerText =
          replyModal.value.profile.value.answers?.[
            "q" + (replyModal.value.questionIdx + 1)
          ];
        await sendFeedMessage(replyModal.value.profile.actor, {
          content: replyText.value.trim(),
          ...(questionText && answerText
            ? { inReplyTo: { questionText, answerText } }
            : {}),
        });
        closeReply();
      } catch (err) {
        window.alert("Message failed: " + (err?.message ?? err));
      }
    }

    // ── Message modal ─────────────────────────────────────────────────
    const msgModal = ref(null); // profile object
    const msgText = ref("");

    function openMsg(profile) {
      msgModal.value = profile;
      msgText.value = "";
    }
    function closeMsg() {
      msgModal.value = null;
    }
    function handleMessage(profile) {
      if (hasConversation(profile.actor))
        emit("open-conversation", profile.actor);
      else openMsg(profile);
    }
    async function sendMsg() {
      if (!msgText.value.trim() || !msgModal.value) return;
      try {
        await sendFeedMessage(msgModal.value.actor, {
          content: msgText.value.trim(),
        });
        closeMsg();
      } catch (err) {
        window.alert("Message failed: " + (err?.message ?? err));
      }
    }

    return {
      session,
      isLoading,
      filteredProfiles,
      searchQuery,
      filters,
      pendingFilters,
      hasActiveFilters,
      showFilterModal,
      openFilter,
      applyFilters,
      clearFilters,
      togglePendingTrack,
      togglePendingYear,
      togglePendingStatus,
      removeFilterTrack,
      removeFilterYear,
      removeFilterStatus,
      clearLookingForCount,
      setPendingLookingForCount,
      replyModal,
      replyText,
      openReply,
      closeReply,
      sendReply,
      msgModal,
      msgText,
      openMsg,
      closeMsg,
      handleMessage,
      sendMsg,
      hasConversation,
      TRACKS,
      YEARS,
    };
  },

  template: `
    <div>
      <!-- Page header -->
      <div class="feed-header">
        <span class="page-title">Feed</span>
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            v-model="searchQuery"
            placeholder="search keywords..."
          >
        </div>
        <button
          class="btn-filter"
          :class="{ active: hasActiveFilters }"
          @click="openFilter"
        >
          ⚙️ Filter
          <span v-if="hasActiveFilters" class="filter-count">
            {{ filters.tracks.length + filters.years.length + filters.statuses.length + (filters.statuses.includes('green') && filters.lookingForCount !== '' ? 1 : 0) }}
          </span>
        </button>
      </div>

      <div class="feed-container">

        <!-- Active filter chips -->
        <div v-if="hasActiveFilters" class="filter-active-bar">
          <span
            v-for="t in filters.tracks"
            :key="'t'+t"
            class="filter-chip"
          >{{ t }} <span class="filter-chip-rm" @click="removeFilterTrack(t)">✕</span></span>
          <span
            v-for="y in filters.years"
            :key="'y'+y"
            class="filter-chip"
          >{{ y }} <span class="filter-chip-rm" @click="removeFilterYear(y)">✕</span></span>
          <span
            v-for="s in filters.statuses"
            :key="'s'+s"
            class="filter-chip"
          >{{ {green:'Looking',yellow:'Deciding',red:'Full'}[s] }} <span class="filter-chip-rm" @click="removeFilterStatus(s)">✕</span></span>
          <span
            v-if="filters.statuses.includes('green') && filters.lookingForCount !== ''"
            class="filter-chip"
          >Looking for {{ filters.lookingForCount }} <span class="filter-chip-rm" @click="clearLookingForCount">✕</span></span>
        </div>

        <!-- Not logged in -->
        <div v-if="!session" class="empty-state">
          <div class="empty-icon">🔒</div>
          <div class="empty-text">Log in to see the feed</div>
        </div>

        <!-- Loading (only shown on very first ever visit before cache is built) -->
        <div v-else-if="isLoading && !filteredProfiles.length" class="empty-state">
          <div class="empty-icon">⏳</div>
          <div class="empty-text">Loading profiles...</div>
        </div>

        <!-- No results -->
        <div v-else-if="!filteredProfiles.length" class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">No hackers found</div>
          <div class="empty-sub">Try adjusting your search or filters — or be the first to post a profile!</div>
        </div>

        <!-- Profile cards -->
        <template v-else>
          <HackerCard
            v-for="profile in filteredProfiles"
            :key="profile.url"
            :profile="profile"
            :conversationStarted="hasConversation(profile.actor)"
            @reply="openReply"
            @message="handleMessage"
          />
        </template>

      </div>

      <!-- ── Reply Modal ── -->
      <div v-if="replyModal" class="overlay open" @click.self="closeReply">
        <div class="modal modal-md">
          <div class="modal-hdr">
            <div class="modal-title">
              Reply to {{ replyModal.profile.value.name?.first }} {{ replyModal.profile.value.name?.last }}
            </div>
            <button class="modal-close" @click="closeReply">✕</button>
          </div>
          <div class="reply-quote">
            <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">
              {{ ['What do you want to get out of the hackathon?','What kind of project do you want to build?','What skills would you bring to a team?'][replyModal.questionIdx] }}
            </div>
            "{{ replyModal.profile.value.answers?.['q' + (replyModal.questionIdx + 1)] }}"
          </div>
          <textarea
            class="reply-ta"
            v-model="replyText"
            placeholder="Type your message..."
            @keydown.enter.ctrl="sendReply"
          ></textarea>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="closeReply">Cancel</button>
            <button
              class="btn btn-primary btn-sm"
              :disabled="!replyText.trim()"
              @click="sendReply"
            >Send Message ✉️</button>
          </div>
        </div>
      </div>

      <!-- ── Message Modal ── -->
      <div v-if="msgModal" class="overlay open" @click.self="closeMsg">
        <div class="modal modal-md">
          <div class="modal-hdr">
            <div class="modal-title">
              Send a message to {{ msgModal.value.name?.first }} {{ msgModal.value.name?.last }}
            </div>
            <button class="modal-close" @click="closeMsg">✕</button>
          </div>
          <textarea
            class="reply-ta"
            v-model="msgText"
            placeholder="Type your message..."
            @keydown.enter.ctrl="sendMsg"
          ></textarea>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="closeMsg">Cancel</button>
            <button
              class="btn btn-primary btn-sm"
              :disabled="!msgText.trim()"
              @click="sendMsg"
            >Send Message ✉️</button>
          </div>
        </div>
      </div>

      <!-- ── Filter Modal ── -->
      <div v-if="showFilterModal" class="overlay open" @click.self="showFilterModal = false">
        <div class="modal modal-md">
          <div class="modal-hdr">
            <div class="modal-title">Filter Profiles</div>
            <button class="modal-close" @click="showFilterModal = false">✕</button>
          </div>

          <div class="filter-sec">
            <div class="filter-sec-title">🎯 Tracks</div>
            <div class="chip-grid">
              <label
                v-for="t in TRACKS"
                :key="t"
                class="chip"
                :class="{ sel: pendingFilters.tracks.includes(t) }"
              >
                <input type="checkbox" :checked="pendingFilters.tracks.includes(t)" @change="togglePendingTrack(t)">
                {{ t }}
              </label>
            </div>
          </div>

          <div class="filter-sec">
            <div class="filter-sec-title">🎓 Year</div>
            <div class="chip-grid">
              <label
                v-for="y in YEARS"
                :key="y"
                class="chip"
                :class="{ sel: pendingFilters.years.includes(y) }"
              >
                <input type="checkbox" :checked="pendingFilters.years.includes(y)" @change="togglePendingYear(y)">
                {{ y }}
              </label>
            </div>
          </div>

          <div class="filter-sec">
            <div class="filter-sec-title">🔵 Status</div>
            <div class="chip-grid">
              <label class="chip" :class="{ sel: pendingFilters.statuses.includes('green') }">
                <input type="checkbox" :checked="pendingFilters.statuses.includes('green')" @change="togglePendingStatus('green')">
                🟢 Looking for team
              </label>
              <label class="chip" :class="{ sel: pendingFilters.statuses.includes('yellow') }">
                <input type="checkbox" :checked="pendingFilters.statuses.includes('yellow')" @change="togglePendingStatus('yellow')">
                🟡 Deciding
              </label>
              <label class="chip" :class="{ sel: pendingFilters.statuses.includes('red') }">
                <input type="checkbox" :checked="pendingFilters.statuses.includes('red')" @change="togglePendingStatus('red')">
                🔴 Team full
              </label>
            </div>
            <div v-if="pendingFilters.statuses.includes('green')" class="status-subfilter">
              <div class="status-subfilter-label">Looking for</div>
              <div class="chip-grid">
                <button
                  class="chip chip-btn"
                  :class="{ sel: pendingFilters.lookingForCount === '' }"
                  @click="setPendingLookingForCount('')"
                >Any</button>
                <button
                  v-for="n in [1,2,3]"
                  :key="'lf'+n"
                  class="chip chip-btn"
                  :class="{ sel: Number(pendingFilters.lookingForCount) === n }"
                  @click="setPendingLookingForCount(String(n))"
                >{{ n }}</button>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="clearFilters">Clear All</button>
            <button class="btn btn-primary btn-sm" @click="applyFilters">Apply Filters</button>
          </div>
        </div>
      </div>

    </div>
  `,
};
