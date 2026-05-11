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
  SCHOOLS,
  FIELDS_OF_INTEREST,
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
    const FEED_PROFILE_CACHE_KEY = 'hm_feed_profiles_27';
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
          JSON.parse(localStorage.getItem("hm_deleted_conversations_27") || "[]"),
        );
      } catch {
        return new Set();
      }
    }
    function getDeletedChannelHistory() {
      try {
        return new Set(
          JSON.parse(
            localStorage.getItem("hm_deleted_channels_history_27") || "[]",
          ),
        );
      } catch {
        return new Set();
      }
    }
    function saveDeletedChannelHistory(s) {
      localStorage.setItem(
        "hm_deleted_channels_history_27",
        JSON.stringify([...s]),
      );
    }

    const deletedConversations = ref(getDeletedConversations());
    const deletedChannelHistory = ref(getDeletedChannelHistory());

    function getHiddenActors() {
      try { return new Set(JSON.parse(localStorage.getItem("hm_hidden_actors") || "[]")); }
      catch { return new Set(); }
    }
    function saveHiddenActors(s) {
      localStorage.setItem("hm_hidden_actors", JSON.stringify([...s]));
    }
    const hiddenActors = ref(getHiddenActors());
    const showHiddenManagement = ref(false);

    function hideActor(actorId) {
      hiddenActors.value = new Set([...hiddenActors.value, actorId]);
      saveHiddenActors(hiddenActors.value);
    }
    function unhideActor(actorId) {
      const next = new Set(hiddenActors.value);
      next.delete(actorId);
      hiddenActors.value = next;
      saveHiddenActors(hiddenActors.value);
    }

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
        mutualTeammateIds.value,
      );
    }

    // ── Search + Filter ───────────────────────────────────────────────
    const searchQuery = ref("");
    const filters = ref({
      tracks: [],
      years: [],
      statuses: [],
      lookingForCount: "",
      schools: [],
      fields: [],
    });
    const showFilterModal = ref(false);

    // Temporary filter state inside the modal (committed on Apply)
    const pendingFilters = ref({
      tracks: [],
      years: [],
      statuses: [],
      lookingForCount: "",
      schools: [],
      fields: [],
    });
    const schoolFilterSearch = ref("");
    const schoolFilterResults = computed(() => {
      const q = schoolFilterSearch.value.trim().toLowerCase();
      if (!q) return [];
      return SCHOOLS.filter(s =>
        s.toLowerCase().includes(q) && !pendingFilters.value.schools.includes(s)
      ).slice(0, 10);
    });
    function openFilter() {
      pendingFilters.value = {
        tracks: [...filters.value.tracks],
        years: [...filters.value.years],
        statuses: [...filters.value.statuses],
        lookingForCount: filters.value.lookingForCount,
        schools: [...filters.value.schools],
        fields: [...filters.value.fields],
      };
      schoolFilterSearch.value = "";
      showFilterModal.value = true;
    }
    function applyFilters() {
      filters.value = {
        tracks: [...pendingFilters.value.tracks],
        years: [...pendingFilters.value.years],
        statuses: [...pendingFilters.value.statuses],
        lookingForCount: pendingFilters.value.lookingForCount,
        schools: [...pendingFilters.value.schools],
        fields: [...pendingFilters.value.fields],
      };
      showFilterModal.value = false;
      currentPage.value = 1;
    }
    function clearFilters() {
      pendingFilters.value = {
        tracks: [],
        years: [],
        statuses: [],
        lookingForCount: "",
        schools: [],
        fields: [],
      };
      schoolFilterSearch.value = "";
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
    function addPendingSchool(school) {
      if (!pendingFilters.value.schools.includes(school)) {
        pendingFilters.value.schools.push(school);
      }
      schoolFilterSearch.value = "";
    }
    function removePendingSchool(school) {
      pendingFilters.value.schools = pendingFilters.value.schools.filter(s => s !== school);
    }
    function togglePendingField(field) {
      const i = pendingFilters.value.fields.indexOf(field);
      if (i >= 0) pendingFilters.value.fields.splice(i, 1);
      else pendingFilters.value.fields.push(field);
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
    function removeFilterSchool(s) {
      filters.value.schools = filters.value.schools.filter((x) => x !== s);
      currentPage.value = 1;
    }
    function removeFilterField(f) {
      filters.value.fields = filters.value.fields.filter((x) => x !== f);
      currentPage.value = 1;
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
        filters.value.schools.length ||
        filters.value.fields.length ||
        (filters.value.statuses.includes("green") &&
          filters.value.lookingForCount !== ""),
    );

    const filteredProfiles = computed(() => {
      let list = allProfiles.value.filter(p => !hiddenActors.value.has(p.actor));
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
      if (filters.value.schools.length) {
        list = list.filter((p) => filters.value.schools.includes(p.value.school));
      }
      if (filters.value.fields.length) {
        list = list.filter((p) =>
          filters.value.fields.some((f) => (p.value.fieldsOfInterest ?? []).includes(f)),
        );
      }
      return list;
    });

    // ── Pagination ───────────────────────────────────────────────────
    const PAGE_SIZE = 10;
    const currentPage = ref(1);
    const totalPages = computed(() => Math.max(1, Math.ceil(filteredProfiles.value.length / PAGE_SIZE)));
    const pagedProfiles = computed(() => {
      const start = (currentPage.value - 1) * PAGE_SIZE;
      return filteredProfiles.value.slice(start, start + PAGE_SIZE);
    });
    // Reset to page 1 when filters or search change
    watch([searchQuery, filters], () => { currentPage.value = 1; }, { deep: true });

    function hasConversation(actorId) {
      return !!existingConversationWith(actorId);
    }

    function saveDeletedConversations(s) {
      localStorage.setItem("hm_deleted_conversations_27", JSON.stringify([...s]));
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

    async function sendFeedMessage(actorId, message, excludedTeammates = new Set()) {
      if (!session.value || !actorId || !message?.content?.trim()) return;
      const mine = session.value.actor;
      const filteredTeammates = mutualTeammateIds.value.filter(id => !excludedTeammates.has(id));
      const participants = conversationParticipants(mine, actorId, filteredTeammates);
      const pairKey = conversationPairKey(mine, actorId);
      const participantKey = conversationParticipantKey(participants);
      const channel = crypto.randomUUID();
      let conv = existingConversationWith(actorId);

      if (!conv) {
        await graffiti.post(
          {
            value: {
              activity: "Create27",
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
      msgExcluded.value = new Set();
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
        }, msgExcluded.value);
        closeReply();
      } catch (err) {
        window.alert("Message failed: " + (err?.message ?? err));
      }
    }

    // ── Message modal ─────────────────────────────────────────────────
    const msgModal = ref(null); // profile object
    const msgText = ref("");
    const msgExcluded = ref(new Set()); // actor IDs to exclude from this conversation

    function openMsg(profile) {
      msgModal.value = profile;
      msgText.value = "";
      msgExcluded.value = new Set();
    }
    function closeMsg() {
      msgModal.value = null;
    }
    function toggleMsgExclude(actorId) {
      const next = new Set(msgExcluded.value);
      if (next.has(actorId)) next.delete(actorId);
      else next.add(actorId);
      msgExcluded.value = next;
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
        }, msgExcluded.value);
        closeMsg();
      } catch (err) {
        window.alert("Message failed: " + (err?.message ?? err));
      }
    }

    const profileByActor = computed(() => {
      const map = new Map();
      for (const p of profileObjects.value) map.set(p.actor, p);
      return map;
    });

    // Only truly mutual teammates (they also have us in their confirmedTeammates)
    const mutualTeammateIds = computed(() => {
      const myActorId = session.value?.actor;
      if (!myActorId) return [];
      return (myProfile.value?.value.confirmedTeammates ?? []).filter((id) => {
        const their = profileByActor.value.get(id);
        return (their?.value.confirmedTeammates ?? []).includes(myActorId);
      });
    });

    return {
      session,
      isLoading,
      myProfile,
      mutualTeammateIds,
      profileByActor,
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
      msgExcluded,
      openMsg,
      closeMsg,
      toggleMsgExclude,
      handleMessage,
      sendMsg,
      hasConversation,
      hiddenActors,
      showHiddenManagement,
      hideActor,
      unhideActor,
      allProfiles,
      TRACKS,
      YEARS,
      SCHOOLS,
      FIELDS_OF_INTEREST,
      schoolFilterSearch,
      schoolFilterResults,
      addPendingSchool,
      removePendingSchool,
      togglePendingField,
      removeFilterSchool,
      removeFilterField,
      currentPage,
      totalPages,
      pagedProfiles,
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
            {{ filters.tracks.length + filters.years.length + filters.statuses.length + filters.schools.length + filters.fields.length + (filters.statuses.includes('green') && filters.lookingForCount !== '' ? 1 : 0) }}
          </span>
        </button>
        <!-- Hidden people button (top-right) -->
        <div v-if="hiddenActors.size > 0" class="hidden-people-wrap">
          <button class="btn-hidden-toggle" @click="showHiddenManagement = !showHiddenManagement">
            👁 {{ hiddenActors.size }} hidden
          </button>
          <div v-if="showHiddenManagement" class="hidden-people-dropdown">
            <div class="hidden-people-hdr">Hidden people</div>
            <div
              v-for="actorId in [...hiddenActors]"
              :key="actorId"
              class="hidden-person-row"
            >
              <span class="hidden-person-name">
                {{ allProfiles.find(p => p.actor === actorId)?.value.name?.first }}
                {{ allProfiles.find(p => p.actor === actorId)?.value.name?.last || '(unknown)' }}
              </span>
              <button class="btn-unhide" @click="unhideActor(actorId)">Unhide</button>
            </div>
          </div>
        </div>
      </div>

      <div class="feed-container">

        <!-- Active filter chips -->
        <div v-if="hasActiveFilters" class="filter-active-bar">
          <span v-for="t in filters.tracks" :key="'t'+t" class="filter-chip">{{ t }} <span class="filter-chip-rm" @click="removeFilterTrack(t)">✕</span></span>
          <span v-for="y in filters.years" :key="'y'+y" class="filter-chip">{{ y }} <span class="filter-chip-rm" @click="removeFilterYear(y)">✕</span></span>
          <span v-for="s in filters.statuses" :key="'s'+s" class="filter-chip">{{ {green:'Looking',yellow:'Deciding',red:'Full'}[s] }} <span class="filter-chip-rm" @click="removeFilterStatus(s)">✕</span></span>
          <span v-if="filters.statuses.includes('green') && filters.lookingForCount !== ''" class="filter-chip">Looking for {{ filters.lookingForCount }} <span class="filter-chip-rm" @click="clearLookingForCount">✕</span></span>
          <span v-for="sc in filters.schools" :key="'sc'+sc" class="filter-chip">🎓 {{ sc }} <span class="filter-chip-rm" @click="removeFilterSchool(sc)">✕</span></span>
          <span v-for="fi in filters.fields" :key="'fi'+fi" class="filter-chip">💡 {{ fi }} <span class="filter-chip-rm" @click="removeFilterField(fi)">✕</span></span>
        </div>

        <!-- Not logged in -->
        <div v-if="!session" class="empty-state">
          <div class="empty-icon">🔒</div>
          <div class="empty-text">Log in to see the feed</div>
        </div>

        <!-- Loading (only shown on very first ever visit before cache is built) -->
        <div v-else-if="isLoading && !filteredProfiles.length" class="empty-state">
          <div class="spinner"></div>
          <div class="empty-text">Loading profiles...</div>
        </div>

        <!-- No results -->
        <div v-else-if="!filteredProfiles.length" class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-text">No hackers found</div>
          <div class="empty-sub">Try adjusting your search or filters — or be the first to post a profile!</div>
        </div>

        <!-- Profile cards (paginated) -->
        <template v-else>
          <HackerCard
            v-for="profile in pagedProfiles"
            :key="profile.url"
            :profile="profile"
            :conversationStarted="hasConversation(profile.actor)"
            @reply="openReply"
            @message="handleMessage"
            @hide="hideActor"
          />

          <!-- Pagination controls -->
          <div v-if="totalPages > 1" class="pagination">
            <button class="page-btn" :disabled="currentPage === 1" @click="currentPage--">‹</button>
            <span class="page-info">{{ currentPage }} / {{ totalPages }}</span>
            <button class="page-btn" :disabled="currentPage === totalPages" @click="currentPage++">›</button>
          </div>
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

          <!-- Teammate visibility -->
          <template v-if="mutualTeammateIds.length > 0">
            <div class="team-note" style="margin:10px 0 8px">
              Your confirmed teammates will be added to this conversation. Click ✕ to exclude.
            </div>
            <div class="teammate-list" style="margin-bottom:10px">
              <div
                v-for="id in mutualTeammateIds"
                :key="id"
                class="teammate-row"
                :style="msgExcluded.has(id) ? 'opacity:0.4' : ''"
              >
                <div
                  class="teammate-avatar"
                  :style="profileByActor.get(id)?.value.avatar
                    ? { backgroundImage: 'url(' + profileByActor.get(id).value.avatar + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: 'var(--primary-light)', color: 'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px' }"
                >
                  <span v-if="!profileByActor.get(id)?.value.avatar">
                    {{ (profileByActor.get(id)?.value.name?.first?.[0] ?? '?') + (profileByActor.get(id)?.value.name?.last?.[0] ?? '') }}
                  </span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">
                    {{ profileByActor.get(id)?.value.name?.first ?? 'Unknown' }}
                    {{ profileByActor.get(id)?.value.name?.last ?? '' }}
                  </div>
                  <div class="teammate-meta">{{ msgExcluded.has(id) ? 'Excluded' : 'Will be included' }}</div>
                </div>
                <button class="teammate-remove" @click="toggleMsgExclude(id)" :title="msgExcluded.has(id) ? 'Re-include' : 'Exclude from this conversation'">
                  {{ msgExcluded.has(id) ? '+' : '✕' }}
                </button>
              </div>
            </div>
          </template>

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

          <!-- Teammate visibility: who will be included -->
          <template v-if="(myProfile?.value.confirmedTeammates?.length ?? 0) > 0">
            <div class="team-note" style="margin:0 0 8px">
              Your confirmed teammates will be added to this conversation. Click ✕ to exclude.
            </div>
            <div class="teammate-list" style="margin-bottom:10px">
              <div
                v-for="id in (myProfile.value.confirmedTeammates ?? [])"
                :key="id"
                class="teammate-row"
                :style="msgExcluded.has(id) ? 'opacity:0.4' : ''"
              >
                <div
                  class="teammate-avatar"
                  :style="profileByActor.get(id)?.value.avatar
                    ? { backgroundImage: 'url(' + profileByActor.get(id).value.avatar + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: 'var(--primary-light)', color: 'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px' }"
                >
                  <span v-if="!profileByActor.get(id)?.value.avatar">
                    {{ (profileByActor.get(id)?.value.name?.first?.[0] ?? '?') + (profileByActor.get(id)?.value.name?.last?.[0] ?? '') }}
                  </span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">
                    {{ profileByActor.get(id)?.value.name?.first ?? 'Unknown' }}
                    {{ profileByActor.get(id)?.value.name?.last ?? '' }}
                  </div>
                  <div class="teammate-meta">{{ msgExcluded.has(id) ? 'Excluded' : 'Will be included' }}</div>
                </div>
                <button class="teammate-remove" @click="toggleMsgExclude(id)" :title="msgExcluded.has(id) ? 'Re-include' : 'Exclude from this conversation'">
                  {{ msgExcluded.has(id) ? '+' : '✕' }}
                </button>
              </div>
            </div>
          </template>

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
        <div class="modal modal-filter">
          <div class="modal-hdr">
            <div class="modal-title">Filter Profiles</div>
            <button class="modal-close" @click="showFilterModal = false">✕</button>
          </div>

          <div class="modal-filter-body">
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

          <div class="filter-sec">
            <div class="filter-sec-title">🎓 School</div>
            <div class="school-filter-search-wrap">
              <input
                class="form-input form-input-sm"
                v-model="schoolFilterSearch"
                placeholder="Search schools..."
                autocomplete="off"
              >
              <div v-if="schoolFilterResults.length" class="school-filter-results">
                <div
                  v-for="s in schoolFilterResults"
                  :key="s"
                  class="school-filter-option"
                  @click="addPendingSchool(s)"
                >{{ s }}</div>
              </div>
            </div>
            <div v-if="pendingFilters.schools.length" class="chip-grid" style="margin-top:8px">
              <span
                v-for="s in pendingFilters.schools"
                :key="s"
                class="filter-chip"
              >{{ s }} <span class="filter-chip-rm" @click="removePendingSchool(s)">✕</span></span>
            </div>
          </div>

          <div class="filter-sec">
            <div class="filter-sec-title">💡 Fields of Interest</div>
            <div class="chip-grid">
              <label
                v-for="f in FIELDS_OF_INTEREST"
                :key="f"
                class="chip"
                :class="{ sel: pendingFilters.fields.includes(f) }"
              >
                <input type="checkbox" :checked="pendingFilters.fields.includes(f)" @change="togglePendingField(f)">
                {{ f }}
              </label>
            </div>
          </div>

          </div><!-- /modal-filter-body -->

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="clearFilters">Clear All</button>
            <button class="btn btn-primary btn-sm" @click="applyFilters">Apply Filters</button>
          </div>
        </div>
      </div>

    </div>
  `,
};
