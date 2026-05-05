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
  MESSAGE_SCHEMA,
  avatarGradient,
  initials,
  formatTimestamp,
  formatTime,
  formatDateLabel,
  conversationPairKey,
  conversationParticipantKey,
  conversationParticipants,
} from "../constants.js";
import HackerCard from "./HackerCard.js";
import ProfileAvatar from "./ProfileAvatar.js";

export default {
  name: "ConversationsPage",
  components: { HackerCard, ProfileAvatar },
  props: {
    // actor ID to open/create a conversation with immediately (from Feed)
    openWithActor: { type: String, default: null },
    // optional first message to send (from Q&A reply)
    openWithMessage: { type: Object, default: null }, // { content, inReplyTo? }
    routeChatId: { type: String, default: null },
  },
  emits: ["clear-pending", "update-unread-counts"],

  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();
    const myActor = computed(() => session.value?.actor ?? null);

    // ── Profile cache (localStorage) so names are instant on load ───────
    const PROFILE_CACHE_KEY = 'hm_conv_profile_cache';
    function loadProfileCache() {
      try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || '{}'); }
      catch { return {}; }
    }
    function saveProfileCache(obj) {
      try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(obj)); } catch {}
    }
    const profileCache = ref(loadProfileCache()); // { [actor]: { name, avatar, pronouns, published } }

    // ── Discover all profiles (for name/avatar lookups) ───────────────
    const { objects: profileObjects, isFirstPoll: profilesLoading } = useGraffitiDiscover(
      [HACKMATCH_CHANNEL],
      PROFILE_SCHEMA,
      undefined,
      true,
    );

    // Update localStorage cache whenever new profiles arrive
    watch(profileObjects, (profiles) => {
      const next = { ...profileCache.value };
      let changed = false;
      for (const p of profiles) {
        const c = next[p.actor];
        if (!c || p.value.published > c.published) {
          next[p.actor] = { name: p.value.name, avatar: p.value.avatar, pronouns: p.value.pronouns, published: p.value.published };
          changed = true;
        }
      }
      if (changed) { profileCache.value = next; saveProfileCache(next); }
    }, { immediate: true });

    const profileByActor = computed(() => {
      const map = new Map();
      // Seed from cache first so names are available before Graffiti responds
      for (const [actor, c] of Object.entries(profileCache.value)) {
        map.set(actor, { actor, value: { name: c.name, avatar: c.avatar, pronouns: c.pronouns, published: c.published } });
      }
      // Real discovered data overwrites cache entries
      for (const p of profileObjects.value) {
        const existing = map.get(p.actor);
        if (!existing || p.value.published > existing.value.published) {
          map.set(p.actor, p);
        }
      }
      return map;
    });

    // My own profile (for status updates)
    const myProfile = computed(() => {
      if (!myActor.value) return null;
      return (
        profileObjects.value
          .filter((p) => p.actor === myActor.value)
          .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null
      );
    });

    // ── Discover conversations from my actor channel ──────────────────
    const { objects: convObjects, isFirstPoll: convsLoading } =
      useGraffitiDiscover(
        () => (myActor.value ? [myActor.value] : []),
        CONVERSATION_SCHEMA,
        session, // need session to see private allowed objects
        true,
      );

    function convPairKey(conv) {
      const participants = conv.value.participants ?? [];
      if (participants.length < 2) return conv.value.channel;
      if (participants.length > 2)
        return (
          conv.value.participantKey ?? conversationParticipantKey(participants)
        );
      return conv.value.pairKey ?? conversationPairKey(...participants);
    }

    function deletionMarkersForConversation(conv) {
      const markers = new Set();
      const participants = conv.value.participants ?? [];
      const primary = convPairKey(conv);
      if (primary) markers.add(`pair:${primary}`);

      const participantKey =
        conv.value.participantKey ??
        (participants.length > 2
          ? conversationParticipantKey(participants)
          : null);
      if (participantKey) markers.add(`pair:${participantKey}`);

      const pairKey =
        conv.value.pairKey ??
        (participants.length >= 2
          ? conversationPairKey(...participants.slice(0, 2))
          : null);
      if (pairKey) markers.add(`pair:${pairKey}`);

      return [...markers];
    }

    function deletedPairMarker(convOrPairKey) {
      return `pair:${typeof convOrPairKey === "string" ? convOrPairKey : convPairKey(convOrPairKey)}`;
    }

    // Deduplicate conversation objects by channel first, then by participant key.
    const conversations = computed(() => {
      const byChannel = new Map();
      for (const c of convObjects.value) {
        const key = c.value.channel;
        const existing = byChannel.get(key);
        if (!existing || c.value.published > existing.value.published) {
          byChannel.set(key, c);
        }
      }

      const byPair = new Map();
      for (const c of byChannel.values()) {
        const key = convPairKey(c);
        const existing = byPair.get(key);
        if (!existing || c.value.published > existing.value.published) {
          byPair.set(key, c);
        }
      }

      return [...byPair.values()].toSorted(
        (a, b) => b.value.published - a.value.published,
      );
    });

    // Conversations the current user has archived (stored in localStorage)
    function getArchived() {
      try {
        return new Set(JSON.parse(localStorage.getItem("hm_archived") || "[]"));
      } catch {
        return new Set();
      }
    }
    function saveArchived(s) {
      localStorage.setItem("hm_archived", JSON.stringify([...s]));
    }
    function getFavorited() {
      try {
        return new Set(
          JSON.parse(localStorage.getItem("hm_favorited") || "[]"),
        );
      } catch {
        return new Set();
      }
    }
    function saveFavorited(s) {
      localStorage.setItem("hm_favorited", JSON.stringify([...s]));
    }
    function getPinned() {
      try {
        return new Set(JSON.parse(localStorage.getItem("hm_pinned") || "[]"));
      } catch {
        return new Set();
      }
    }
    function savePinned(s) {
      localStorage.setItem("hm_pinned", JSON.stringify([...s]));
    }
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
    function saveDeletedConversations(s) {
      localStorage.setItem("hm_deleted_conversations", JSON.stringify([...s]));
      window.dispatchEvent(new CustomEvent("hm-deleted-conversations-updated"));
    }

    const archived = ref(getArchived());
    const favorited = ref(getFavorited());
    const pinnedConversations = ref(getPinned());
    const deletedConversations = ref(getDeletedConversations());
    const deletedChannelHistory = ref(getDeletedChannelHistory());
    const hiddenDeletedChannels = ref(
      new Set([
        ...deletedChannelHistory.value,
        ...[...deletedConversations.value].filter(
          (key) => !key.startsWith("pair:"),
        ),
      ]),
    );
    const showArchived = ref(false);
    const openActionMenu = ref(null);

    function toggleArchive(channel) {
      if (archived.value.has(channel)) archived.value.delete(channel);
      else archived.value.add(channel);
      saveArchived(archived.value);
    }
    function toggleFavorite(channel) {
      if (favorited.value.has(channel)) favorited.value.delete(channel);
      else favorited.value.add(channel);
      saveFavorited(favorited.value);
    }
    function togglePin(channel) {
      if (pinnedConversations.value.has(channel)) pinnedConversations.value.delete(channel);
      else pinnedConversations.value.add(channel);
      savePinned(pinnedConversations.value);
      pinnedConversations.value = new Set(pinnedConversations.value);
    }
    function toggleActionMenu(key) {
      openActionMenu.value = openActionMenu.value === key ? null : key;
    }
    function closeActionMenu() {
      openActionMenu.value = null;
    }

    function addHiddenDeletedChannels(channels = []) {
      const nextHidden = new Set(hiddenDeletedChannels.value);
      const nextHistory = new Set(deletedChannelHistory.value);
      let changed = false;
      for (const channel of channels) {
        if (!channel) continue;
        if (!nextHidden.has(channel)) {
          nextHidden.add(channel);
          changed = true;
        }
        if (!nextHistory.has(channel)) {
          nextHistory.add(channel);
          changed = true;
        }
      }
      if (changed) {
        hiddenDeletedChannels.value = nextHidden;
        deletedChannelHistory.value = nextHistory;
        saveDeletedChannelHistory(nextHistory);
      }
    }

    const hiddenPairMarkers = computed(() => {
      const hiddenPairs = new Set();
      for (const key of deletedConversations.value) {
        if (key.startsWith("pair:")) hiddenPairs.add(key);
      }
      return hiddenPairs;
    });

    function hasDeletedMarker(conv) {
      return deletionMarkersForConversation(conv).some((marker) =>
        hiddenPairMarkers.value.has(marker),
      );
    }

    function hasSubsetDeletedMarker(conv) {
      const participants = new Set(conv.value.participants ?? []);
      for (const marker of hiddenPairMarkers.value) {
        const raw = marker.slice(5);
        if (!raw) continue;
        const ids = raw.split("::").filter(Boolean);
        if (!ids.length) continue;
        if (ids.every((id) => participants.has(id))) return true;
      }
      return false;
    }

    // If an old conversation is only deleted via pair marker, promote it to
    // channel deletion once seen so polling cannot make it flicker back in.
    watch(
      convObjects,
      (list) => {
        let changed = false;
        const next = new Set(deletedConversations.value);
        const sticky = new Set(hiddenDeletedChannels.value);
        for (const conv of list) {
          const channel = conv.value.channel;
          const matchesDeletedMarker = deletionMarkersForConversation(
            conv,
          ).some((marker) => next.has(marker));
          const matchesSubsetDeletedMarker = hasSubsetDeletedMarker(conv);
          if ((matchesDeletedMarker || matchesSubsetDeletedMarker) && channel) {
            if (!next.has(channel)) {
              next.add(channel);
              changed = true;
            }
            if (!sticky.has(channel)) {
              sticky.add(channel);
              changed = true;
            }
          }
        }
        if (
          sticky.size !== hiddenDeletedChannels.value.size ||
          [...sticky].some((ch) => !hiddenDeletedChannels.value.has(ch))
        ) {
          addHiddenDeletedChannels([...sticky]);
        }
        if (changed) {
          deletedConversations.value = next;
          saveDeletedConversations(next);
        }
      },
      { immediate: true },
    );

    function isConversationDeleted(conv) {
      return (
        hiddenDeletedChannels.value.has(conv.value.channel) ||
        deletedConversations.value.has(conv.value.channel) ||
        hasDeletedMarker(conv) ||
        hasSubsetDeletedMarker(conv)
      );
    }

    function isStatusUpdateMessage(msg) {
      return msg?.value?.systemType === "status-update";
    }

    const allShownConversations = computed(() =>
      conversations.value.filter(
        (c) =>
          !hiddenDeletedChannels.value.has(c.value.channel) &&
          !deletedConversations.value.has(c.value.channel) &&
          !hasDeletedMarker(c) &&
          !hasSubsetDeletedMarker(c),
      ),
    );

    const allShownChannels = computed(() =>
      allShownConversations.value.map((c) => c.value.channel),
    );

    const { objects: allMsgObjects } = useGraffitiDiscover(
      () => allShownChannels.value,
      MESSAGE_SCHEMA,
      session,
      true,
    );

    const optimisticMessageByChannel = ref({});

    function setOptimisticMessage(
      channel,
      content = "",
      attachmentName = "",
      published = Date.now(),
    ) {
      if (!channel) return;
      optimisticMessageByChannel.value = {
        ...optimisticMessageByChannel.value,
        [channel]: { content, attachmentName, published },
      };
    }

    function onLocalMessageEvent(e) {
      const d = e?.detail ?? {};
      setOptimisticMessage(
        d.channel,
        d.content ?? "",
        d.attachmentName ?? "",
        d.published ?? Date.now(),
      );
    }

    function refreshDeletedConversations() {
      deletedConversations.value = getDeletedConversations();
      deletedChannelHistory.value = getDeletedChannelHistory();
      const next = new Set(deletedChannelHistory.value);
      for (const key of deletedConversations.value) {
        if (!key.startsWith("pair:")) next.add(key);
      }
      hiddenDeletedChannels.value = next;
    }

    onMounted(() => {
      window.addEventListener("hm-local-message", onLocalMessageEvent);
      window.addEventListener(
        "hm-deleted-conversations-updated",
        refreshDeletedConversations,
      );
      window.addEventListener("storage", refreshDeletedConversations);
    });
    onUnmounted(() => {
      window.removeEventListener("hm-local-message", onLocalMessageEvent);
      window.removeEventListener(
        "hm-deleted-conversations-updated",
        refreshDeletedConversations,
      );
      window.removeEventListener("storage", refreshDeletedConversations);
    });

    const latestUserMessageByChannel = computed(() => {
      const map = new Map();
      for (const msg of allMsgObjects.value) {
        if (isStatusUpdateMessage(msg)) continue;
        const msgChannels = Array.isArray(msg.channels) ? msg.channels : [];
        const channel =
          msgChannels.find((ch) => allShownChannels.value.includes(ch)) ??
          msg.value.channel;
        if (!channel) continue;
        const existing = map.get(channel);
        if (!existing || msg.value.published > existing.value.published)
          map.set(channel, msg);
      }
      return map;
    });

    const latestUserMessageCacheByChannel = ref({});

    watch(
      allMsgObjects,
      (msgs) => {
        const next = { ...latestUserMessageCacheByChannel.value };
        for (const msg of msgs) {
          if (isStatusUpdateMessage(msg)) continue;
          const msgChannels = Array.isArray(msg.channels) ? msg.channels : [];
          const channel =
            msgChannels.find((ch) => allShownChannels.value.includes(ch)) ??
            msg.value.channel;
          if (!channel) continue;
          const existing = next[channel];
          if (!existing || msg.value.published > existing.value.published) {
            next[channel] = msg;
          }
        }
        latestUserMessageCacheByChannel.value = next;
      },
      { immediate: true },
    );

    // ── Message preview localStorage cache (survives refresh) ────────
    const MSG_PREVIEW_CACHE_KEY = 'hm_msg_preview_cache';
    function loadMsgPreviewCache() {
      try { return JSON.parse(localStorage.getItem(MSG_PREVIEW_CACHE_KEY) || '{}'); }
      catch { return {}; }
    }
    const msgPreviewCache = ref(loadMsgPreviewCache());
    watch(latestUserMessageCacheByChannel, (msgMap) => {
      const next = { ...msgPreviewCache.value };
      let changed = false;
      for (const [channel, msg] of Object.entries(msgMap)) {
        const c = next[channel];
        if (!c || msg.value.published > c.published) {
          next[channel] = { content: msg.value.content ?? '', published: msg.value.published ?? 0, attachmentName: msg.value.attachment?.name ?? null };
          changed = true;
        }
      }
      if (changed) { msgPreviewCache.value = next; try { localStorage.setItem(MSG_PREVIEW_CACHE_KEY, JSON.stringify(next)); } catch {} }
    });

    watch(latestUserMessageByChannel, (map) => {
      const next = { ...optimisticMessageByChannel.value };
      let changed = false;
      for (const [channel, optimistic] of Object.entries(
        optimisticMessageByChannel.value,
      )) {
        const real = map.get(channel);
        if (real && real.value.published >= optimistic.published) {
          delete next[channel];
          changed = true;
        }
      }
      if (changed) optimisticMessageByChannel.value = next;
    });

    function latestMessage(conv) {
      if (!conv) return null;
      return (
        latestUserMessageByChannel.value.get(conv.value.channel) ??
        latestUserMessageCacheByChannel.value[conv.value.channel] ??
        null
      );
    }

    function latestMessageTimestamp(conv) {
      const msg = latestMessage(conv);
      if (msg) return msg.value.published ?? 0;
      return msgPreviewCache.value[conv?.value?.channel]?.published ?? conv?.value?.published ?? 0;
    }

    const visibleConversations = computed(() => {
      return conversations.value
        .filter(
          (c) =>
            !hiddenDeletedChannels.value.has(c.value.channel) &&
            !deletedConversations.value.has(c.value.channel) &&
            !hasDeletedMarker(c) &&
            !hasSubsetDeletedMarker(c) &&
            archived.value.has(c.value.channel) === showArchived.value,
        )
        .toSorted((a, b) => {
          const pinA = pinnedConversations.value.has(a.value.channel);
          const pinB = pinnedConversations.value.has(b.value.channel);
          if (pinA !== pinB) return pinA ? -1 : 1;
          const delta = latestMessageTimestamp(b) - latestMessageTimestamp(a);
          if (delta !== 0) return delta;
          return (a.value.channel ?? "").localeCompare(b.value.channel ?? "");
        });
    });

    function messagePreview(conv) {
      const msg = latestMessage(conv);
      const optimistic = optimisticMessageByChannel.value[conv.value.channel];
      const useOptimistic = optimistic && (!msg || optimistic.published > (msg.value.published ?? 0));

      let text;
      if (useOptimistic) {
        text = optimistic.content?.trim() || (optimistic.attachmentName ? `Attachment: ${optimistic.attachmentName}` : "");
      } else if (msg) {
        text = msg.value.content?.trim() || (msg.value.attachment ? `Attachment: ${msg.value.attachment.name}` : "");
      } else {
        // Fall back to persisted preview cache so text survives a refresh
        const cached = msgPreviewCache.value[conv.value.channel];
        text = cached?.content?.trim() || (cached?.attachmentName ? `Attachment: ${cached.attachmentName}` : "");
      }

      if (!text) return "No messages yet";
      return text.length > 58 ? text.slice(0, 57) + "..." : text;
    }

    function messagePreviewTime(conv) {
      const msg = latestMessage(conv);
      const optimistic = optimisticMessageByChannel.value[conv.value.channel];
      const ts = Math.max(
        msg?.value?.published ?? 0,
        optimistic?.published ?? 0,
        conv?.value?.published ?? 0,
      );
      return formatTimestamp(ts);
    }

    function latestIncomingMessage(conv) {
      if (!conv) return null;
      return (
        allMsgObjects.value
          .filter((msg) => {
            if (isStatusUpdateMessage(msg)) return false;
            const msgChannels = Array.isArray(msg.channels) ? msg.channels : [];
            return (
              msg.actor !== myActor.value &&
              (msg.value.channel === conv.value.channel ||
                msgChannels.includes(conv.value.channel))
            );
          })
          .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null
      );
    }

    // ── Selected conversation + messages ─────────────────────────────
    const selectedChannel = ref(null);
    const optimisticConv = ref(null);
    const selectedConv = computed(
      () =>
        visibleConversations.value.find(
          (c) => c.value.channel === selectedChannel.value,
        ) ??
        (optimisticConv.value?.value.channel === selectedChannel.value
          ? optimisticConv.value
          : null),
    );

    watch(conversations, (list) => {
      if (
        optimisticConv.value &&
        list.some((c) => c.value.channel === optimisticConv.value.value.channel)
      ) {
        optimisticConv.value = null;
      }
    });

    const { objects: msgObjects, isFirstPoll: msgsLoading } =
      useGraffitiDiscover(
        () => (selectedChannel.value ? [selectedChannel.value] : []),
        MESSAGE_SCHEMA,
        session,
        true,
      );

    const sortedMessages = computed(() =>
      msgObjects.value.toSorted(
        (a, b) => a.value.published - b.value.published,
      ),
    );

    // Unread tracking (localStorage: { [channel]: lastReadTimestamp })
    function getLastRead() {
      try {
        return JSON.parse(localStorage.getItem("hm_lastread") || "{}");
      } catch {
        return {};
      }
    }
    const lastRead = ref(getLastRead());
    function saveLastRead() {
      localStorage.setItem("hm_lastread", JSON.stringify(lastRead.value));
    }
    function markRead(channel) {
      lastRead.value[channel] = Date.now();
      lastRead.value = { ...lastRead.value };
      saveLastRead();
    }

    function isUnread(conv) {
      return unreadCount(conv) > 0;
    }

    function unreadCount(conv) {
      if (!conv) return 0;
      const lr = lastRead.value[conv.value.channel] ?? 0;
      return allMsgObjects.value.filter((msg) => {
        if (isStatusUpdateMessage(msg)) return false;
        const msgChannels = Array.isArray(msg.channels) ? msg.channels : [];
        const inChannel =
          msg.value.channel === conv.value.channel ||
          msgChannels.includes(conv.value.channel);
        return (
          inChannel && msg.actor !== myActor.value && msg.value.published > lr
        );
      }).length;
    }

    function markUnread(conv = selectedConv.value) {
      const msg = latestIncomingMessage(conv);
      if (!conv || !msg) return;
      lastRead.value[conv.value.channel] = Math.max(0, msg.value.published - 1);
      lastRead.value = { ...lastRead.value };
      saveLastRead();
      closeActionMenu();
    }

    const activeUnreadTotal = computed(() =>
      allShownConversations.value
        .filter((c) => !archived.value.has(c.value.channel))
        .reduce((sum, c) => sum + unreadCount(c), 0),
    );

    const archivedUnreadTotal = computed(() =>
      allShownConversations.value
        .filter((c) => archived.value.has(c.value.channel))
        .reduce((sum, c) => sum + unreadCount(c), 0),
    );

    watch(
      [activeUnreadTotal, archivedUnreadTotal],
      ([active, archivedCount]) => {
        emit("update-unread-counts", { active, archived: archivedCount });
      },
      { immediate: true },
    );

    function selectConv(channel) {
      closeActionMenu();
      selectedChannel.value = channel;
      markRead(channel);
      if (channel && props.routeChatId !== channel) {
        window.location.hash = "#/messages/" + encodeURIComponent(channel);
      }
    }

    watch(
      () => props.routeChatId,
      (chatId) => {
        if (!chatId) return;
        selectedChannel.value = chatId;
        markRead(chatId);
      },
      { immediate: true },
    );

    // ── Helpers ───────────────────────────────────────────────────────
    function convName(conv) {
      const others =
        conv.value.participants?.filter((id) => id !== myActor.value) ?? [];
      return (
        others
          .map((id) => {
            const p = profileByActor.value.get(id);
            return p
              ? `${p.value.name?.first} ${p.value.name?.last}`
              : "Unknown";
          })
          .join(", ") || "Unknown"
      );
    }
    function convOtherActor(conv) {
      return (
        conv.value.participants?.find((id) => id !== myActor.value) ?? null
      );
    }
    function convOtherActors(conv) {
      return (
        conv.value.participants?.filter((id) => id !== myActor.value) ?? []
      );
    }
    function convOtherProfile(conv) {
      const id = convOtherActor(conv);
      return id ? (profileByActor.value.get(id) ?? null) : null;
    }
    function actorProfile(actor) {
      return profileByActor.value.get(actor) ?? null;
    }
    function actorAvatarStyle(actor) {
      const profile = actorProfile(actor);
      return profile?.value.avatar
        ? {
            backgroundImage: "url(" + profile.value.avatar + ")",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : { background: avatarGradient(actor ?? "") };
    }
    function actorInitials(actor) {
      const profile = actorProfile(actor);
      return profile ? initials(profile) : "?";
    }
    function statusLabel(profile) {
      const v = profile?.value;
      if (!v) return "Status unknown";
      if (v.status === "green") {
        const count = v.lookingForCount ?? "?";
        return `Looking for ${count} teammate${count !== 1 ? "s" : ""}`;
      }
      if (v.status === "yellow") return "Deciding on teammates";
      return "Team is full";
    }

    // ── Start / find a conversation ───────────────────────────────────
    const isCreatingConv = ref(false);

    // New conversation preview state (shows teammates before starting)
    const newConvPreview = ref(null); // { actor, message, excluded: Set<string> }

    const newConvPreviewTeammates = computed(() => {
      if (!newConvPreview.value) return [];
      const excluded = newConvPreview.value.excluded;
      return (myProfile.value?.value.confirmedTeammates ?? [])
        .filter((id) => !excluded.has(id))
        .map((id) => profileByActor.value.get(id))
        .filter(Boolean);
    });

    function excludeFromNewConv(actorId) {
      if (!newConvPreview.value) return;
      const next = new Set(newConvPreview.value.excluded);
      next.add(actorId);
      newConvPreview.value = { ...newConvPreview.value, excluded: next };
    }

    async function startNewConvPreview() {
      if (!newConvPreview.value) return;
      const { actor, message, excluded } = newConvPreview.value;
      newConvPreview.value = null;
      const teammates = (myProfile.value?.value.confirmedTeammates ?? []).filter(
        (id) => !excluded.has(id),
      );
      await ensureConversationWith(actor, message, teammates);
    }

    function currentParticipantsWith(actorId, teammatesOverride = null) {
      const teammates = teammatesOverride !== null
        ? teammatesOverride
        : (myProfile.value?.value.confirmedTeammates ?? []);
      return conversationParticipants(myActor.value, actorId, teammates);
    }

    async function postMessageTo(channel, participants, override) {
      const content = (override?.content ?? msgInput.value).trim();
      let attachment = override
        ? override.attachment
        : selectedAttachment.value;
      if (!content && !attachment) return;
      const published = Date.now();
      const value = { content, channel, published };
      if (override?.inReplyTo) value.inReplyTo = override.inReplyTo;
      if (attachment?.file) {
        const url = await graffiti.postMedia({ data: attachment.file }, session.value);
        attachment = {
          name: attachment.name,
          type: attachment.type,
          size: attachment.size,
          url,
        };
      }
      if (attachment) value.attachment = attachment;

      setOptimisticMessage(channel, content, attachment?.name ?? "", published);

      await graffiti.post(
        {
          value,
          channels: [channel],
          allowed: participants,
        },
        session.value,
      );
      if (!override) {
        msgInput.value = "";
        selectedAttachment.value = null;
        if (attachmentInput.value) attachmentInput.value.value = "";
      }
    }

    async function ensureConversationWith(actorId, firstMessage, teammatesOverride = null) {
      if (!session.value || !myActor.value || !actorId) return;
      if (convsLoading.value) return;
      const participants = currentParticipantsWith(actorId, teammatesOverride);
      const pairKey = conversationPairKey(myActor.value, actorId);
      const participantKey = conversationParticipantKey(participants);

      // Check if conversation already exists
      const existing = conversations.value.find(
        (c) =>
          (convPairKey(c) === participantKey ||
            (participants.length === 2 && convPairKey(c) === pairKey)) &&
          !isConversationDeleted(c),
      );
      if (existing) {
        optimisticConv.value = null;
        selectedChannel.value = existing.value.channel;
        markRead(existing.value.channel);
        if (firstMessage) {
          await postMessageTo(
            existing.value.channel,
            existing.value.participants ?? [myActor.value, actorId],
            firstMessage,
          );
        }
        return;
      }

      // Create new conversation
      isCreatingConv.value = true;
      const channel = crypto.randomUUID();
      const value = {
        activity: "Create",
        type: "Conversation",
        channel,
        participants,
        pairKey,
        participantKey,
        published: Date.now(),
      };
      try {
        // Preserve old deleted channels before clearing pair markers for a new chat.
        for (const c of convObjects.value) {
          const markers = deletionMarkersForConversation(c);
          if (
            markers.includes(deletedPairMarker(pairKey)) ||
            markers.includes(deletedPairMarker(participantKey))
          ) {
            if (c.value.channel)
              deletedConversations.value.add(c.value.channel);
            addHiddenDeletedChannels([c.value.channel]);
          }
        }
        optimisticConv.value = { actor: myActor.value, value };
        await graffiti.post(
          {
            value,
            channels: participants, // stored in both actors' inboxes
            allowed: participants, // only visible to them
          },
          session.value,
        );
        selectedChannel.value = channel;
        markRead(channel);
        if (firstMessage)
          await postMessageTo(channel, participants, firstMessage);
      } finally {
        isCreatingConv.value = false;
      }
    }

    // Watch for pending conversation from parent (Feed page)
    watch(
      [() => props.openWithActor, convsLoading, profilesLoading],
      async ([actorId, convsLoad, profsLoad]) => {
        if (!actorId) return;
        if (convsLoad || profsLoad) return; // wait for both to finish loading
        const teammates = myProfile.value?.value.confirmedTeammates ?? [];
        if (teammates.length > 0) {
          // Show preview so user can see/remove teammates before starting
          newConvPreview.value = {
            actor: actorId,
            message: props.openWithMessage ?? null,
            excluded: new Set(),
          };
          emit("clear-pending");
        } else {
          await ensureConversationWith(actorId, props.openWithMessage ?? null);
          emit("clear-pending");
        }
      },
      { immediate: true },
    );

    // ── Sending messages ──────────────────────────────────────────────
    const msgInput = ref("");
    const isSending = ref(false);
    const isReadingAttachment = ref(false);
    const sendError = ref("");
    const attachmentError = ref("");
    const isDeletingConversation = ref(false);
    const selectedAttachment = ref(null);
    const attachmentInput = ref(null);

    const ATTACHMENT_SOURCE_MAX_BYTES = 25 * 1024 * 1024;

    async function sendMessage(override) {
      if (!selectedConv.value || !session.value) return;
      if (!override && (isSending.value || isReadingAttachment.value)) return;
      const content = override?.content ?? msgInput.value.trim();
      const attachment = override
        ? override.attachment
        : selectedAttachment.value;
      if (!content && !attachment) return;
      const conv = selectedConv.value;
      const participants = conv.value.participants ?? [myActor.value];
      isSending.value = true;
      sendError.value = "";
      try {
        await postMessageTo(conv.value.channel, participants, override);
      } catch (err) {
        console.error("Failed to send message", err);
        sendError.value = attachment
          ? "Attachment failed to send. Try a smaller file."
          : "Message failed to send. Please try again.";
      } finally {
        isSending.value = false;
      }
    }

    async function deleteConversation(conv = selectedConv.value) {
      if (!conv || !session.value) return;
      const name = convName(conv);
      const ok = window.confirm(
        `Delete your conversation with ${name}? This removes it from your conversations and deletes any loaded messages your account is allowed to delete.`,
      );
      if (!ok) return;

      isDeletingConversation.value = true;
      closeActionMenu();
      deletedConversations.value.add(conv.value.channel);
      addHiddenDeletedChannels([conv.value.channel]);
      deletedConversations.value.add(deletedPairMarker(conv));

      // Also tombstone any historical participant-key variants written for this channel.
      for (const c of convObjects.value) {
        if (c.value.channel !== conv.value.channel) continue;
        for (const marker of deletionMarkersForConversation(c)) {
          deletedConversations.value.add(marker);
        }
      }

      deletedConversations.value = new Set(deletedConversations.value);
      saveDeletedConversations(deletedConversations.value);
      try {
        if (selectedChannel.value !== conv.value.channel) {
          selectedChannel.value = conv.value.channel;
        }
        const messagesToDelete = msgObjects.value.filter((m) => {
          const msgChannels = Array.isArray(m.channels) ? m.channels : [];
          return (
            m.value.channel === conv.value.channel ||
            msgChannels.includes(conv.value.channel)
          );
        });
        await Promise.allSettled(
          messagesToDelete.map((m) => graffiti.delete(m, session.value)),
        );
        await graffiti.delete(conv, session.value);

        archived.value.delete(conv.value.channel);
        favorited.value.delete(conv.value.channel);
        delete lastRead.value[conv.value.channel];
        saveArchived(archived.value);
        saveFavorited(favorited.value);
        saveLastRead();

        if (selectedChannel.value === conv.value.channel) {
          selectedChannel.value = null;
          optimisticConv.value = null;
          mobileShowMessages.value = false;
        }
      } catch (err) {
        window.alert(
          "Hidden locally, but remote delete failed: " + (err?.message ?? err),
        );
      } finally {
        isDeletingConversation.value = false;
      }
    }

    function handleMsgKey(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    }

    function openAttachmentPicker() {
      if (isSending.value || isReadingAttachment.value) return;
      attachmentInput.value?.click();
    }

    async function prepareAttachment(file) {
      if (file.size > ATTACHMENT_SOURCE_MAX_BYTES) {
        throw new Error("Attachment is too large. Please choose a file under 25 MB.");
      }
      return {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        file,
      };
    }

    function formatFileSize(size) {
      if (!Number.isFinite(size)) return "";
      if (size < 1024) return `${size} B`;
      return `${Math.round(size / 1024)} KB`;
    }

    async function onAttachmentSelected(e) {
      const file = e.target.files?.[0];
      if (!file) return;
      attachmentError.value = "";
      sendError.value = "";
      isReadingAttachment.value = true;
      try {
        selectedAttachment.value = await prepareAttachment(file);
      } catch (err) {
        selectedAttachment.value = null;
        attachmentError.value = err?.message ?? "Could not attach that file.";
      } finally {
        isReadingAttachment.value = false;
        e.target.value = "";
      }
    }

    function clearAttachment() {
      if (isSending.value || isReadingAttachment.value) return;
      selectedAttachment.value = null;
      attachmentError.value = "";
      if (attachmentInput.value) attachmentInput.value.value = "";
    }

    // ── Message grouping (10 min rule) ────────────────────────────────
    function shouldShowMeta(messages, idx) {
      if (idx === 0) return true;
      const cur = messages[idx];
      const prev = messages[idx - 1];
      if (
        new Date(cur.value.published).toDateString() !==
        new Date(prev.value.published).toDateString()
      ) {
        return true;
      }
      return (
        prev.actor !== cur.actor ||
        cur.value.published - prev.value.published >= 10 * 60 * 1000
      );
    }

    function shouldShowDateSep(messages, idx) {
      if (idx === 0) return true;
      const cur = new Date(messages[idx].value.published).toDateString();
      const prev = new Date(messages[idx - 1].value.published).toDateString();
      return cur !== prev;
    }

    // ── Status update ─────────────────────────────────────────────────
    const statusDropdownOpen = ref(false);
    const isUpdatingStatus = ref(false);

    async function updateStatus(newStatus, lookingForCount) {
      if (!session.value || !myProfile.value) return;
      isUpdatingStatus.value = true;
      try {
        await graffiti.delete(myProfile.value, session.value);
        const v = myProfile.value.value;
        const rawCount = lookingForCount ?? v.lookingForCount;
        const resolvedCount = Math.min(3, Math.max(1, Number(rawCount) || 1));
        await graffiti.post(
          {
            value: {
              ...v,
              status: newStatus,
              lookingForCount: resolvedCount,
              published: Date.now(),
            },
            channels: [HACKMATCH_CHANNEL],
          },
          session.value,
        );

        const myName =
          `${v.name?.first ?? ""} ${v.name?.last ?? ""}`.trim() || "A teammate";
        const statusText =
          newStatus === "green"
            ? `${myName} updated status: Looking for ${resolvedCount ?? "?"} teammate${(resolvedCount ?? 2) !== 1 ? "s" : ""}`
            : newStatus === "yellow"
              ? `${myName} updated status: Deciding on teammates`
              : `${myName} updated status: Team is full`;

        for (const conv of allShownConversations.value) {
          const participants = conv.value.participants ?? [];
          if (!participants.includes(myActor.value)) continue;
          await graffiti.post(
            {
              value: {
                content: statusText,
                channel: conv.value.channel,
                systemType: "status-update",
                published: Date.now(),
              },
              channels: [conv.value.channel],
              allowed: participants,
            },
            session.value,
          );
        }
      } finally {
        isUpdatingStatus.value = false;
        statusDropdownOpen.value = false;
      }
    }

    // ── Profile card modal ────────────────────────────────────────────
    const profileModalTarget = ref(null);
    const teamModalOpen = ref(false);
    const teamSearch = ref("");
    const teamDraft = ref([]);
    const isSavingTeam = ref(false);
    const teamError = ref("");
    const addTeammateModalConv = ref(null);
    const addTeammateError = ref("");

    function openProfileModal(actor) {
      profileModalTarget.value = profileByActor.value.get(actor) ?? null;
    }

    const teamDraftProfiles = computed(() =>
      teamDraft.value
        .map((actor) => profileByActor.value.get(actor))
        .filter(Boolean),
    );

    const teamSearchResults = computed(() => {
      const q = teamSearch.value.trim().toLowerCase();
      if (!q || !myActor.value) return [];
      const selected = new Set(teamDraft.value);
      return [...profileByActor.value.values()]
        .filter((p) => p.actor !== myActor.value && !selected.has(p.actor))
        .filter((p) =>
          [
            p.value.name?.first,
            p.value.name?.last,
            p.value.pronouns,
            p.value.major,
            p.value.school,
            p.value.year,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
        .slice(0, 6);
    });

    function profileName(profile) {
      return (
        `${profile?.value.name?.first ?? ""} ${profile?.value.name?.last ?? ""}`.trim() ||
        "Unknown"
      );
    }

    const eligibleConfirmedTeammates = computed(() => {
      const conv = addTeammateModalConv.value;
      if (!conv || !myActor.value) return [];
      const participants = new Set(conv.value.participants ?? []);
      const mine = [...(myProfile.value?.value.confirmedTeammates ?? [])];
      return mine
        .filter((actor) => actor !== myActor.value && !participants.has(actor))
        .map((actor) => profileByActor.value.get(actor))
        .filter(Boolean);
    });

    function openTeamModal() {
      teamDraft.value = [
        ...(myProfile.value?.value.confirmedTeammates ?? []),
      ].slice(0, 3);
      teamSearch.value = "";
      teamError.value = "";
      teamModalOpen.value = true;
    }
    function addTeamDraft(profile) {
      if (!profile || teamDraft.value.includes(profile.actor)) return;
      const theirTeammates = profile.value.confirmedTeammates ?? [];
      // Constraint: union of both teams ≤ 4
      const resultingTeam = new Set([myActor.value, ...teamDraft.value, profile.actor, ...theirTeammates]);
      if (resultingTeam.size > 4) {
        teamError.value = `Can't add: this would make a team of ${resultingTeam.size} people (max 4).`;
        return;
      }
      const candidates = [...new Set([profile.actor, ...theirTeammates])].filter(
        (id) => id && id !== myActor.value,
      );
      teamDraft.value = [...new Set([...teamDraft.value, ...candidates])];
      teamSearch.value = "";
    }
    function removeTeamDraft(actor) {
      teamDraft.value = teamDraft.value.filter((id) => id !== actor);
    }
    async function saveTeamDraft() {
      if (!myProfile.value || !session.value) return;
      isSavingTeam.value = true;
      teamError.value = "";
      try {
        const v = myProfile.value.value;
        await graffiti.delete(myProfile.value, session.value);
        await graffiti.post(
          {
            value: {
              ...v,
              confirmedTeammates: [...new Set(teamDraft.value)].slice(0, 3),
              published: Date.now(),
            },
            channels: [HACKMATCH_CHANNEL],
          },
          session.value,
        );
        teamModalOpen.value = false;
      } catch (err) {
        teamError.value = "Team update failed: " + (err?.message ?? err);
      } finally {
        isSavingTeam.value = false;
      }
    }

    function openAddTeammateModal(conv) {
      if (!conv) return;
      addTeammateError.value = "";
      addTeammateModalConv.value = conv;
    }

    function closeAddTeammateModal() {
      addTeammateModalConv.value = null;
      addTeammateError.value = "";
    }

    async function addConfirmedTeammateToConversation(teammateActor) {
      const conv = addTeammateModalConv.value;
      if (!conv || !session.value || !myActor.value || !teammateActor) return;

      const current = conv.value.participants ?? [];
      if (current.includes(teammateActor)) {
        addTeammateError.value =
          "That teammate is already in this conversation.";
        return;
      }

      const participants = [...new Set([...current, teammateActor])];
      const participantKey = conversationParticipantKey(participants);
      const pairKey =
        conv.value.pairKey ??
        conversationPairKey(
          myActor.value,
          convOtherActor(conv) ?? teammateActor,
        );

      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Conversation",
              channel: conv.value.channel,
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

        // Hide the older participant-set variant locally so only the upgraded chat is shown.
        deletedConversations.value.add(deletedPairMarker(conv));
        deletedConversations.value = new Set(deletedConversations.value);
        saveDeletedConversations(deletedConversations.value);

        selectedChannel.value = conv.value.channel;
        closeAddTeammateModal();
      } catch (err) {
        addTeammateError.value =
          "Could not add teammate: " + (err?.message ?? err);
      }
    }

    // ── Conversation sidebar localStorage cache ───────────────────────
    const CONV_SIDEBAR_CACHE_KEY = 'hm_conv_sidebar_cache';
    function loadConvSidebarCache() {
      try { return JSON.parse(localStorage.getItem(CONV_SIDEBAR_CACHE_KEY) || '[]'); }
      catch { return []; }
    }
    const convSidebarCache = ref(loadConvSidebarCache());
    // Persist whenever live data is settled
    watch(visibleConversations, (convs) => {
      if (convsLoading.value) return;
      const data = convs.slice(0, 150).map(c => ({
        channel: c.value.channel,
        participants: c.value.participants ?? [],
        participantKey: c.value.participantKey ?? null,
        pairKey: c.value.pairKey ?? null,
        published: c.value.published ?? 0,
      }));
      convSidebarCache.value = data;
      try { localStorage.setItem(CONV_SIDEBAR_CACHE_KEY, JSON.stringify(data)); } catch {}
    });
    // Fake conv objects built from cache — used while first poll is in flight
    const cachedConvObjects = computed(() =>
      convSidebarCache.value
        .filter(c =>
          !hiddenDeletedChannels.value.has(c.channel) &&
          !deletedConversations.value.has(c.channel)
        )
        .map(c => ({
          actor: null, url: null,
          channels: [c.channel],
          value: { activity: 'Create', type: 'Conversation', channel: c.channel, participants: c.participants, participantKey: c.participantKey, pairKey: c.pairKey, published: c.published },
        }))
        .toSorted((a, b) => {
          const pinA = pinnedConversations.value.has(a.value.channel);
          const pinB = pinnedConversations.value.has(b.value.channel);
          if (pinA !== pinB) return pinA ? -1 : 1;
          const tsA = msgPreviewCache.value[a.value.channel]?.published ?? a.value.published ?? 0;
          const tsB = msgPreviewCache.value[b.value.channel]?.published ?? b.value.published ?? 0;
          return tsB - tsA;
        })
    );
    // Show cached list while loading, live list once settled
    const displayedConversations = computed(() =>
      convsLoading.value ? cachedConvObjects.value : visibleConversations.value
    );

    // Mobile: toggle sidebar vs message view
    const mobileShowMessages = ref(false);

    return {
      session,
      myActor,
      convsLoading,
      msgsLoading,
      visibleConversations,
      displayedConversations,
      selectedConv,
      selectedChannel,
      showArchived,
      archived,
      favorited,
      pinnedConversations,
      togglePin,
      newConvPreview,
      newConvPreviewTeammates,
      excludeFromNewConv,
      startNewConvPreview,
      openActionMenu,
      sortedMessages,
      msgInput,
      isSending,
      isCreatingConv,
      isDeletingConversation,
      isReadingAttachment,
      sendError,
      attachmentError,
      selectedAttachment,
      attachmentInput,
      activeUnreadTotal,
      archivedUnreadTotal,
      convName,
      convOtherActor,
      convOtherActors,
      convOtherProfile,
      actorProfile,
      actorAvatarStyle,
      actorInitials,
      statusLabel,
      selectConv,
      sendMessage,
      deleteConversation,
      handleMsgKey,
      openAttachmentPicker,
      onAttachmentSelected,
      clearAttachment,
      formatFileSize,
      messagePreview,
      messagePreviewTime,
      isUnread,
      unreadCount,
      markUnread,
      toggleActionMenu,
      closeActionMenu,
      shouldShowMeta,
      shouldShowDateSep,
      isStatusUpdateMessage,
      toggleArchive,
      toggleFavorite,
      avatarGradient,
      initials,
      formatTimestamp,
      formatTime,
      formatDateLabel,
      statusDropdownOpen,
      isUpdatingStatus,
      updateStatus,
      myProfile,
      profileByActor,
      profileModalTarget,
      openProfileModal,
      teamModalOpen,
      teamSearch,
      teamDraft,
      teamDraftProfiles,
      teamSearchResults,
      profileName,
      openTeamModal,
      addTeamDraft,
      removeTeamDraft,
      saveTeamDraft,
      isSavingTeam,
      teamError,
      addTeammateModalConv,
      addTeammateError,
      eligibleConfirmedTeammates,
      openAddTeammateModal,
      closeAddTeammateModal,
      addConfirmedTeammateToConversation,
      mobileShowMessages,
    };
  },

  template: `
    <div class="conv-layout" @click="closeActionMenu">

      <!-- ── Sidebar ── -->
      <div
        class="conv-sidebar"
        :class="{ 'mobile-hidden': mobileShowMessages }"
      >
        <div class="conv-sidebar-hdr">
          <div class="conv-sidebar-title">Messages</div>

          <!-- My status -->
          <div class="conv-controls" v-if="session">
            <div class="status-sel-wrap">
              <div class="status-sel-btn" @click="statusDropdownOpen = !statusDropdownOpen">
                <span class="sdot" :class="myProfile?.value.status ?? 'green'"></span>
                <span>{{ {green:'Looking',yellow:'Deciding',red:'Full'}[myProfile?.value.status ?? 'green'] }}</span>
                <span>▾</span>
              </div>
              <div class="status-dd" :class="{ open: statusDropdownOpen }">
                <div class="sdd-item" @click="updateStatus('green')">
                  <span class="sdot green"></span> Looking for teammates
                </div>
                <div class="sdd-item" @click="updateStatus('yellow')">
                  <span class="sdot yellow"></span> Deciding on teammates
                </div>
                <div class="sdd-item" @click="updateStatus('red')">
                  <span class="sdot red"></span> Team is full
                </div>
                <div v-if="myProfile?.value.status === 'green'" class="lf-row">
                  Looking for
                  <input
                    type="number"
                    :value="myProfile?.value.lookingForCount ?? 2"
                    min="1" max="3"
                    @change="e => updateStatus('green', Number(e.target.value))"
                    class="lf-number-input"
                  >
                  more
                </div>
              </div>
            </div>

            <button
              class="btn-arch"
              @click="openTeamModal"
            >
              👥 Team
            </button>
            <button
              class="btn-arch"
              :class="{ on: showArchived }"
              @click="showArchived = !showArchived"
            >
              {{ showArchived ? '← Active' : '📦 Archived' }}
              <span v-if="!showArchived && archivedUnreadTotal > 0" class="archive-unread">{{ archivedUnreadTotal }}</span>
            </button>
          </div>
        </div>

        <!-- Conversation list -->
        <div class="conv-list">
          <div v-if="!session" class="empty-state">
            <div class="empty-icon">🔒</div>
            <div class="empty-text">Log in to see messages</div>
          </div>

          <div v-else-if="convsLoading && !displayedConversations.length" class="empty-state">
            <div class="spinner"></div>
            <div class="empty-text">Loading...</div>
          </div>

          <div v-else-if="!displayedConversations.length" class="empty-state">
            <div class="empty-icon">{{ showArchived ? '📦' : '💬' }}</div>
            <div class="empty-text">{{ showArchived ? 'No archived conversations' : 'No conversations yet' }}</div>
            <div v-if="!showArchived" class="empty-sub">Message someone from the Feed!</div>
          </div>

          <div
            v-for="conv in displayedConversations"
            :key="conv.value.channel"
            class="conv-item"
            :class="{ active: selectedChannel === conv.value.channel }"
            @click="selectConv(conv.value.channel); mobileShowMessages = true"
          >
            <div class="ci-av">
              <template v-if="convOtherActors(conv).length > 1">
                <div class="av-stack">
                  <div
                    v-for="actor in convOtherActors(conv).slice(0, 3)"
                    :key="conv.value.channel + ':' + actor"
                    class="av-sm av-stack-item"
                    :style="actorAvatarStyle(actor)"
                  >
                    <span v-if="!actorProfile(actor)?.value.avatar">{{ actorInitials(actor) }}</span>
                  </div>
                </div>
                <span v-if="convOtherActors(conv).length > 3" class="av-stack-more">+{{ convOtherActors(conv).length - 3 }}</span>
              </template>
              <template v-else>
                <ProfileAvatar
                  :profile="convOtherProfile(conv)"
                  :actor="convOtherActor(conv)"
                  :initials="actorInitials(convOtherActor(conv))"
                  :gradient="avatarGradient(convOtherActor(conv) ?? '')"
                  size="sm"
                  :showStatus="true"
                  :statusLabel="statusLabel(convOtherProfile(conv))"
                />
              </template>
            </div>

            <div class="ci-body">
              <div class="ci-name-row">
                <span class="ci-name">{{ convName(conv) }}</span>
                <span class="ci-icons">
                  {{ pinnedConversations.has(conv.value.channel) ? '📌' : '' }}
                  {{ favorited.has(conv.value.channel) ? '⭐' : '' }}
                  {{ archived.has(conv.value.channel) ? '📦' : '' }}
                </span>
              </div>
              <div class="ci-preview-row">
                <div class="ci-preview-main">
                  <span v-if="isUnread(conv)" class="unread-dot">{{ unreadCount(conv) }}</span>
                  <span class="ci-preview">{{ messagePreview(conv) }}</span>
                </div>
                <span class="ci-preview-time">{{ messagePreviewTime(conv) }}</span>
              </div>
            </div>

            <div
              class="action-wrap"
              :class="{ open: openActionMenu === 'list:' + conv.value.channel }"
            >
              <button
                class="three-dot add-dot"
                @click.stop="openAddTeammateModal(conv)"
                title="Add confirmed teammate"
              >+</button>
              <button
                class="three-dot"
                @click.stop="toggleActionMenu('list:' + conv.value.channel)"
                title="Conversation actions"
              >⋯</button>
              <div
                class="action-menu"
                :class="{ open: openActionMenu === 'list:' + conv.value.channel }"
                @click.stop
              >
                <button @click="markUnread(conv)">🔵 Mark unread</button>
                <button @click="openProfileModal(convOtherActor(conv)); closeActionMenu()">👤 View profile</button>
                <button @click="togglePin(conv.value.channel); closeActionMenu()">
                  {{ pinnedConversations.has(conv.value.channel) ? '📌 Unpin' : '📌 Pin' }}
                </button>
                <button @click="toggleFavorite(conv.value.channel); closeActionMenu()">
                  {{ favorited.has(conv.value.channel) ? '☆ Unfavorite' : '⭐ Favorite' }}
                </button>
                <button @click="toggleArchive(conv.value.channel); closeActionMenu()">
                  {{ archived.has(conv.value.channel) ? '📦 Unarchive' : '📦 Archive' }}
                </button>
                <button class="danger" @click="deleteConversation(conv)">🗑 Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Message view ── -->
      <div
        class="msg-view"
        :class="{ 'mobile-open': mobileShowMessages }"
      >
        <!-- No conv selected -->
        <div v-if="!selectedConv" class="conv-no-sel">
          <div class="conv-no-sel-icon">💬</div>
          <div class="conv-no-sel-text">
            Select a conversation<br>
            <span style="font-size:12px">or start one from the Feed</span>
          </div>
        </div>

        <template v-else>
          <!-- Message header -->
          <div class="msg-hdr">
            <button class="back-btn" @click="mobileShowMessages = false">‹ Back</button>
            <div class="ci-av">
              <ProfileAvatar
                :profile="convOtherProfile(selectedConv)"
                :actor="convOtherActor(selectedConv)"
                :initials="actorInitials(convOtherActor(selectedConv))"
                :gradient="avatarGradient(convOtherActor(selectedConv) ?? '')"
                size="sm"
                :showStatus="true"
                :statusLabel="statusLabel(convOtherProfile(selectedConv))"
              />
            </div>
            <div>
              <div class="msg-hdr-name">{{ convName(selectedConv) }}</div>
              <div class="msg-hdr-sub" v-if="convOtherProfile(selectedConv)">
                {{ convOtherProfile(selectedConv).value.school }} · {{ convOtherProfile(selectedConv).value.year }}
              </div>
            </div>
            <div class="msg-hdr-right">
              <button
                class="three-dot add-dot"
                @click.stop="openAddTeammateModal(selectedConv)"
                title="Add confirmed teammate"
              >+</button>
              <div
                class="action-wrap open"
              >
                <button
                  class="three-dot"
                  @click.stop="toggleActionMenu('header')"
                  title="Conversation actions"
                >⋯</button>
                <div
                  class="action-menu align-right"
                  :class="{ open: openActionMenu === 'header' }"
                  @click.stop
                >
                  <button @click="markUnread(selectedConv)">🔵 Mark unread</button>
                  <button @click="openProfileModal(convOtherActor(selectedConv)); closeActionMenu()">👤 View profile</button>
                  <button @click="togglePin(selectedConv.value.channel); closeActionMenu()">
                    {{ pinnedConversations.has(selectedConv.value.channel) ? '📌 Unpin' : '📌 Pin' }}
                  </button>
                  <button @click="toggleFavorite(selectedConv.value.channel); closeActionMenu()">
                    {{ favorited.has(selectedConv.value.channel) ? '☆ Unfavorite' : '⭐ Favorite' }}
                  </button>
                  <button @click="toggleArchive(selectedConv.value.channel); closeActionMenu()">
                    {{ archived.has(selectedConv.value.channel) ? '📦 Unarchive' : '📦 Archive' }}
                  </button>
                  <button
                    class="danger"
                    :disabled="isDeletingConversation"
                    @click="deleteConversation(selectedConv)"
                  >{{ isDeletingConversation ? 'Deleting...' : '🗑 Delete' }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Messages -->
          <div class="msg-body" ref="msgBody">
            <div v-if="msgsLoading" style="text-align:center;padding:20px;color:var(--text3)">
              <em>Loading messages...</em>
            </div>

            <div v-else-if="!sortedMessages.length" class="msg-empty">
              <div class="msg-empty-icon">✨</div>
              <div style="font-size:13px">Start the conversation!</div>
            </div>

            <template v-else>
              <template v-for="(msg, idx) in sortedMessages" :key="msg.url">

                <!-- Date separator -->
                <div v-if="shouldShowDateSep(sortedMessages, idx)" class="date-sep">
                  {{ formatDateLabel(msg.value.published) }}
                </div>

                <div v-if="isStatusUpdateMessage(msg)" class="date-sep status-update-sep">
                  {{ msg.value.content }}
                </div>

                <div v-else class="msg-row" :class="{ grouped: !shouldShowMeta(sortedMessages, idx) }">
                  <!-- Avatar (only when starting a new group) -->
                  <template v-if="shouldShowMeta(sortedMessages, idx)">
                    <div
                      class="msg-av-wrap"
                    >
                      <ProfileAvatar
                        :profile="actorProfile(msg.actor)"
                        :actor="msg.actor"
                        :initials="actorInitials(msg.actor)"
                        :gradient="avatarGradient(msg.actor ?? '')"
                        size="xs"
                      />
                    </div>
                  </template>
                  <div v-else class="msg-av-space"></div>

                  <div class="msg-col">
                    <!-- Sender name + timestamp (first in group) -->
                    <div v-if="shouldShowMeta(sortedMessages, idx)" class="msg-meta">
                      <span v-if="msg.actor !== myActor" class="msg-sender">
                        {{ profileByActor.get(msg.actor)?.value.name?.first ?? 'Unknown' }}
                      </span>
                      <span v-else class="msg-sender">You</span>
                      <span class="msg-time">{{ formatTime(msg.value.published) }}</span>
                    </div>

                    <!-- inReplyTo context block -->
                    <div v-if="msg.value.inReplyTo" class="msg-reply-context">
                      <div class="msg-reply-q">{{ msg.value.inReplyTo.questionText }}</div>
                      <div class="msg-reply-a">"{{ msg.value.inReplyTo.answerText }}"</div>
                    </div>

                    <!-- Bubble -->
                    <div
                      class="msg-bubble"
                    >
                      <div v-if="msg.value.content">{{ msg.value.content }}</div>
                      <a
                        v-if="msg.value.attachment?.dataUrl"
                        class="msg-attachment"
                        :href="msg.value.attachment.dataUrl"
                        :download="msg.value.attachment.name"
                        target="_blank"
                      >
                        📎 {{ msg.value.attachment.name }}
                      </a>
                      <graffiti-get-media
                        v-else-if="msg.value.attachment?.url"
                        v-slot="{ media }"
                        :url="msg.value.attachment.url"
                        :accept="{ types: [msg.value.attachment.type || 'application/octet-stream'] }"
                      >
                        <a
                          v-if="media?.dataUrl"
                          class="msg-attachment"
                          :href="media?.dataUrl"
                          :download="msg.value.attachment.name"
                          target="_blank"
                        >
                          <img
                            v-if="media?.dataUrl && msg.value.attachment.type?.startsWith('image/')"
                            class="msg-attachment-img"
                            :src="media.dataUrl"
                            alt=""
                          >
                          <span v-if="media?.dataUrl">📎 {{ msg.value.attachment.name }}</span>
                        </a>
                      </graffiti-get-media>
                    </div>
                  </div>
                </div>

              </template>
            </template>
          </div>

          <!-- Input -->
          <div class="msg-input-area">
            <div v-if="attachmentError" class="composer-error">{{ attachmentError }}</div>
            <div v-if="selectedAttachment" class="attachment-preview">
              <span>📎 {{ selectedAttachment.name }} <small>{{ formatFileSize(selectedAttachment.size) }}</small></span>
              <button
                @click="clearAttachment"
                :disabled="isSending || isReadingAttachment"
                title="Remove attachment"
              >✕</button>
            </div>
            <div v-else-if="isReadingAttachment" class="attachment-preview attachment-loading">
              <span>Preparing attachment...</span>
            </div>
            <div class="msg-input-row">
              <button
                class="msg-icon-btn msg-attach"
                @click="openAttachmentPicker"
                :disabled="isSending || isReadingAttachment"
                title="Add attachment"
              >+</button>
              <input
                ref="attachmentInput"
                class="attachment-input"
                type="file"
                @change="onAttachmentSelected"
              >
              <textarea
                class="msg-input"
                v-model="msgInput"
                placeholder="Message..."
                rows="1"
                :disabled="isSending || isReadingAttachment"
                @keydown="handleMsgKey"
                @input="e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 110) + 'px' }"
              ></textarea>
              <button
                class="msg-icon-btn msg-send"
                :disabled="(!msgInput.trim() && !selectedAttachment) || isSending || isReadingAttachment"
                @click="sendMessage()"
                title="Send"
              >{{ isSending || isReadingAttachment ? '...' : '▶' }}</button>
            </div>
            <div v-if="isReadingAttachment" class="send-status">Preparing attachment...</div>
            <div v-else-if="isSending" class="send-status">Sending message...</div>
            <div v-else-if="sendError" class="composer-error">{{ sendError }}</div>
          </div>
        </template>
      </div>

      <!-- ── New conversation preview (teammate visibility) ── -->
      <div v-if="newConvPreview" class="overlay open" @click.self="newConvPreview = null">
        <div class="modal modal-sm">
          <div class="modal-hdr">
            <div class="modal-title">New Conversation</div>
            <button class="modal-close" @click="newConvPreview = null">✕</button>
          </div>

          <div class="new-conv-target">
            <div class="teammate-avatar" :style="actorAvatarStyle(newConvPreview.actor)">
              <span v-if="!actorProfile(newConvPreview.actor)?.value.avatar">{{ actorInitials(newConvPreview.actor) }}</span>
            </div>
            <div class="new-conv-target-name">
              Messaging <strong>{{ profileName(actorProfile(newConvPreview.actor)) }}</strong>
            </div>
          </div>

          <template v-if="(myProfile?.value.confirmedTeammates?.length ?? 0) > 0">
            <div class="team-note" style="margin:14px 0 8px">
              Your confirmed teammates will be added to this conversation:
            </div>
            <div class="teammate-list" style="margin-bottom:0">
              <div
                v-for="p in newConvPreviewTeammates"
                :key="p.actor"
                class="teammate-row"
              >
                <div class="teammate-avatar" :style="actorAvatarStyle(p.actor)">
                  <span v-if="!p.value.avatar">{{ actorInitials(p.actor) }}</span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                  <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }}</div>
                </div>
                <button class="teammate-remove" @click="excludeFromNewConv(p.actor)" title="Don't include in this conversation">✕</button>
              </div>
            </div>
            <div v-if="newConvPreview.excluded.size > 0" style="margin-top:8px;font-size:12px;color:var(--text3)">
              {{ newConvPreview.excluded.size }} teammate{{ newConvPreview.excluded.size !== 1 ? 's' : '' }} excluded from this conversation.
            </div>
          </template>

          <div class="modal-actions" style="margin-top:18px">
            <button class="btn btn-secondary btn-sm" @click="newConvPreview = null">Cancel</button>
            <button class="btn btn-primary btn-sm" :disabled="isCreatingConv" @click="startNewConvPreview">
              {{ isCreatingConv ? 'Starting...' : 'Start Conversation' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── Confirmed teammates modal ── -->
      <div v-if="teamModalOpen" class="overlay open" @click.self="teamModalOpen = false">
        <div class="modal modal-md">
          <div class="modal-hdr">
            <div class="modal-title">Confirmed Teammates</div>
            <button class="modal-close" @click="teamModalOpen = false">✕</button>
          </div>

          <div class="team-note">
            New conversations you start will automatically include your confirmed teammates.
            In older conversations, use the + button to optionally add confirmed teammates who are not already in that chat.
          </div>

          <div v-if="teamDraftProfiles.length" class="teammate-list">
            <div v-for="p in teamDraftProfiles" :key="p.actor" class="teammate-row">
              <div class="teammate-avatar" :style="actorAvatarStyle(p.actor)">
                <span v-if="!p.value.avatar">{{ actorInitials(p.actor) }}</span>
              </div>
              <div class="teammate-info">
                <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
              </div>
              <button class="teammate-remove" @click="removeTeamDraft(p.actor)" title="Remove teammate">✕</button>
            </div>
          </div>

          <div v-if="teamDraft.length < 3" class="teammate-search">
            <input
              class="form-input"
              v-model="teamSearch"
              placeholder="Search people by name..."
            >
            <div v-if="teamSearchResults.length" class="teammate-results">
              <button
                v-for="p in teamSearchResults"
                :key="p.actor"
                class="teammate-result"
                @click="addTeamDraft(p)"
              >
                <div class="teammate-avatar" :style="actorAvatarStyle(p.actor)">
                  <span v-if="!p.value.avatar">{{ actorInitials(p.actor) }}</span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                  <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
                </div>
              </button>
            </div>
          </div>

          <div v-if="teamError" class="profile-msg err">{{ teamError }}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" @click="teamModalOpen = false">Cancel</button>
            <button class="btn btn-primary btn-sm" :disabled="isSavingTeam" @click="saveTeamDraft">
              {{ isSavingTeam ? 'Saving...' : 'Save Team' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── Add teammate to existing conversation ── -->
      <div v-if="addTeammateModalConv" class="overlay open" @click.self="closeAddTeammateModal">
        <div class="modal modal-sm">
          <div class="modal-hdr">
            <div class="modal-title">Add Confirmed Teammate</div>
            <button class="modal-close" @click="closeAddTeammateModal">✕</button>
          </div>

          <div class="team-note" style="margin-bottom:12px">
            Add a confirmed teammate to this conversation.
          </div>

          <div v-if="!eligibleConfirmedTeammates.length" class="empty-sub" style="margin:0 0 6px">
            No confirmed teammates available to add.
          </div>

          <div v-else class="teammate-list" style="margin-bottom:0">
            <button
              v-for="p in eligibleConfirmedTeammates"
              :key="p.actor"
              class="teammate-result"
              @click="addConfirmedTeammateToConversation(p.actor)"
            >
              <div class="teammate-avatar" :style="actorAvatarStyle(p.actor)">
                <span v-if="!p.value.avatar">{{ actorInitials(p.actor) }}</span>
              </div>
              <div class="teammate-info">
                <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
              </div>
            </button>
          </div>

          <div v-if="addTeammateError" class="profile-msg err">{{ addTeammateError }}</div>

          <div class="modal-actions" style="margin-top:10px">
            <button class="btn btn-secondary btn-sm" @click="closeAddTeammateModal">Done</button>
          </div>
        </div>
      </div>

      <!-- ── Profile card modal ── -->
      <div v-if="profileModalTarget" class="overlay open" @click.self="profileModalTarget = null">
        <div class="modal modal-lg" style="padding-top:14px">
          <div style="display:flex;justify-content:flex-end;margin-bottom:4px">
            <button class="modal-close" @click="profileModalTarget = null">✕</button>
          </div>
          <HackerCard :profile="profileModalTarget" :readOnly="true" />
        </div>
      </div>

    </div>
  `,
};
