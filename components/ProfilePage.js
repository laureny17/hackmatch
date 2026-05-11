import { ref, watch, computed, nextTick } from "vue";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";
import {
  HACKMATCH_CHANNEL,
  PROFILE_SCHEMA,
  TEAM_INVITE_SCHEMA,
  TEAM_DECLINE_SCHEMA,
  TRACKS,
  YEARS,
  SCHOOLS,
  PROFILE_QUESTIONS,
  FIELDS_OF_INTEREST,
  avatarGradient,
  initials,
} from "../constants.js";
import ProfileAvatar from "./ProfileAvatar.js";
import HackerCard from "./HackerCard.js";

const AVATAR_CROP_SIZE = 280;
const GALLERY_CROP_MAX_W = 320;
const GALLERY_CROP_MAX_H = 260;

export default {
  name: "ProfilePage",
  components: { ProfileAvatar, HackerCard },
  emits: ["profile-saved", "navigate"],

  setup(props, { emit }) {
    const graffiti = useGraffiti();
    const session = useGraffitiSession();

    // ── Discover my existing profile ──────────────────────────────────
    const { objects: allProfiles, isFirstPoll: profileLoading } =
      useGraffitiDiscover(
        () => (session.value ? [HACKMATCH_CHANNEL] : []),
        PROFILE_SCHEMA,
        session,
      );

    const myProfile = computed(() => {
      if (!session.value) return null;
      return (
        allProfiles.value
          .filter((p) => p.actor === session.value.actor)
          .toSorted((a, b) => b.value.published - a.value.published)[0] ?? null
      );
    });

    // ── Teammate invites (objects posted to my actor channel) ─────────
    const { objects: inviteObjects } = useGraffitiDiscover(
      () => (session.value?.actor ? [session.value.actor] : []),
      TEAM_INVITE_SCHEMA,
      session,
      true,
    );

    // ── Teammate decline/removal notifications ────────────────────────
    const { objects: declineObjects } = useGraffitiDiscover(
      () => (session.value?.actor ? [session.value.actor] : []),
      TEAM_DECLINE_SCHEMA,
      session,
      true,
    );

    // Declined invites tracked in localStorage (can't delete objects we didn't post)
    function getDeclinedInvites() {
      try { return new Set(JSON.parse(localStorage.getItem('hm_declined_invites') || '[]')); }
      catch { return new Set(); }
    }
    const declinedInvites = ref(getDeclinedInvites());
    function saveDeclinedInvites() {
      localStorage.setItem('hm_declined_invites', JSON.stringify([...declinedInvites.value]));
    }

    const pendingInvites = computed(() => {
      if (!session.value?.actor) return [];
      const myActorId = session.value.actor;
      const myTeammateSet = new Set(form.value.confirmedTeammates ?? []);
      const byFrom = new Map();
      for (const inv of inviteObjects.value) {
        if (inv.value.to !== myActorId) continue;
        if (myTeammateSet.has(inv.value.from)) continue; // already a teammate
        const invKey = inv.url ?? `${inv.value.from}:${inv.value.published}`;
        if (declinedInvites.value.has(invKey)) continue; // user declined
        const existing = byFrom.get(inv.value.from);
        if (!existing || inv.value.published > existing.value.published)
          byFrom.set(inv.value.from, inv);
      }
      return [...byFrom.values()].toSorted((a, b) => b.value.published - a.value.published);
    });

    const isAcceptingInvite = ref(false);
    const inviteError = ref("");
    const inviteProfileModal = ref(null);

    const confirmDialog = ref(null); // { message, onConfirm }
    function withConfirm(message, onConfirm) {
      confirmDialog.value = { message, onConfirm };
    }

    async function acceptInvite(invite) {
      const myActorId = session.value?.actor;
      if (!myActorId) return;
      const myTeammates = form.value.confirmedTeammates ?? [];
      if (myTeammates.includes(invite.value.from)) return; // already on the list

      // Collect person A + their confirmed-mutual teammates only
      const personA = invite.value.from;
      const personAProfile = profileByActor.value.get(personA);
      const personAConfirmed = personAProfile?.value.confirmedTeammates ?? [];
      const personAMutuals = personAConfirmed.filter(id => {
        const theirProfile = profileByActor.value.get(id);
        return (theirProfile?.value.confirmedTeammates ?? []).includes(personA);
      });
      const toAdd = [personA, ...personAMutuals];

      const newTeammateSet = new Set([...myTeammates, ...toAdd]);
      if (1 + newTeammateSet.size > 4) {
        const myTeamSize = 1 + myTeammates.length;
        const theirTeamSize = toAdd.length;
        inviteError.value = `Can't accept — you have a team of ${myTeamSize} and they have a team of ${theirTeamSize}. Together that would be ${1 + newTeammateSet.size} people (max is 4).`;
        return;
      }
      inviteError.value = "";
      isAcceptingInvite.value = true;
      const newTeammates = [...newTeammateSet].slice(0, 3);
      try {
        if (myProfile.value) {
          const oldProf = myProfile.value;
          const v = oldProf.value;
          const publishedTs = Date.now();
          await graffiti.post(
            { value: { ...v, confirmedTeammates: newTeammates, published: publishedTs }, channels: [HACKMATCH_CHANNEL] },
            session.value,
          );
          lastSavedTimestamp.value = publishedTs;
          lastHydratedPublished.value = publishedTs;
          graffiti.delete(oldProf, session.value).catch(() => {});
        }
        isHydrating = true;
        form.value.confirmedTeammates = newTeammates;
        nextTick(() => { isHydrating = false; });
        const cachedForm = loadCached() ?? {};
        localStorage.setItem(FORM_CACHE_KEY, JSON.stringify({ ...cachedForm, confirmedTeammates: newTeammates }));
        const invKey = invite.url ?? `${invite.value.from}:${invite.value.published}`;
        declinedInvites.value.add(invKey);
        saveDeclinedInvites();
        declinedInvites.value = new Set(declinedInvites.value);

        // Notify each of person A's mutual teammates so their client can auto-confirm us
        for (const mutualId of personAMutuals) {
          if (mutualId === myActorId) continue;
          try {
            await graffiti.post({
              value: {
                activity: 'TeamInvite27',
                from: myActorId,
                to: mutualId,
                autoConfirmedBy: personA, // signal: skip manual accept
                published: Date.now(),
              },
              channels: [mutualId],
              allowed: [myActorId, mutualId],
            }, session.value);
          } catch { /* non-critical */ }
        }
      } catch (err) {
        inviteError.value = "Accept failed: " + (err?.message ?? err);
      } finally {
        isAcceptingInvite.value = false;
      }
    }

    // Auto-remove teammates when we receive a TeamDecline from them
    const autoRemovedKeys = new Set();
    watch([declineObjects, myProfile], async ([declines]) => {
      if (!session.value?.actor || !myProfile.value) return;
      const myTeammates = form.value.confirmedTeammates ?? [];
      for (const dec of declines) {
        const from = dec.value.from;
        if (!myTeammates.includes(from)) continue;
        const key = dec.url ?? `${from}:${dec.value.published}`;
        if (autoRemovedKeys.has(key)) continue;
        autoRemovedKeys.add(key);
        // Remove them from our list without posting another TeamDecline (no loop)
        isHydrating = true;
        form.value.confirmedTeammates = (form.value.confirmedTeammates ?? []).filter(id => id !== from);
        nextTick(() => { isHydrating = false; });
        if (myProfile.value && session.value) {
          try {
            const oldProf = myProfile.value;
            const v = oldProf.value;
            const publishedTs = Date.now();
            await graffiti.post(
              { value: { ...v, confirmedTeammates: form.value.confirmedTeammates, published: publishedTs }, channels: [HACKMATCH_CHANNEL] },
              session.value,
            );
            lastSavedTimestamp.value = publishedTs;
            lastHydratedPublished.value = publishedTs;
            graffiti.delete(oldProf, session.value).catch(() => {});
          } catch { /* non-critical */ }
        }
      }
    });


    async function declineInvite(invite) {
      const invKey = invite.url ?? `${invite.value.from}:${invite.value.published}`;
      declinedInvites.value.add(invKey);
      saveDeclinedInvites();
      declinedInvites.value = new Set(declinedInvites.value);
      // Notify inviter so their client auto-removes us from their pending outgoing
      if (session.value?.actor) {
        try {
          await graffiti.post({
            value: { activity: 'TeamDecline27', from: session.value.actor, to: invite.value.from, published: Date.now() },
            channels: [invite.value.from],
            allowed: [session.value.actor, invite.value.from],
          }, session.value);
        } catch { /* non-critical */ }
      }
    }

    // ── Form state (seeded from localStorage cache for instant render) ──
    const FORM_CACHE_KEY = "hm_profile_form";
    function loadCached() {
      try {
        return JSON.parse(localStorage.getItem(FORM_CACHE_KEY)) ?? null;
      } catch {
        return null;
      }
    }
    const cached = loadCached();
    const defaultForm = {
      firstName: "",
      lastName: "",
      pronouns: "",
      school: "",
      year: "",
      major: "",
      tracks: [],
      fields: [],
      q1: "",
      q2: "",
      q3: "",
      status: "green",
      lookingForCount: 3,
      confirmedTeammates: [],
      avatar: null,
      gallery: [],
    };
    const form = ref(
      cached
        ? {
            ...defaultForm,
            ...cached,
            confirmedTeammates: cached.confirmedTeammates ?? [],
            fields: cached.fields ?? [],
          }
        : defaultForm,
    );

    // Wizard mode: show one step at a time for first-time setup
    const wizardStep = ref(cached?.firstName ? -1 : 0)
    const isWizardMode = computed(() => !myProfile.value && !profileLoading.value && wizardStep.value >= 0)

    // Declared early so the myProfile watcher (immediate) can reference it safely
    const schoolSearch = ref(form.value.school ?? "");

    // True while we are assigning form.value from Graffiti data (not user input).
    // Prevents the auto-save watcher from firing during hydration.
    let isHydrating = false;

    // Timestamp of the last profile WE personally posted to Graffiti.
    // The myProfile watcher refuses to hydrate from any profile older than this,
    // which prevents Graffiti's polling from reverting the form to stale data.
    const lastSavedTimestamp = ref(0);

    // Pre-fill form from Graffiti profile only when a newer profile appears.
    // This avoids clobbering in-progress edits on each discover poll.
    const lastHydratedPublished = ref(null);
    watch(
      myProfile,
      (p) => {
        if (!p) return;
        const published = p.value?.published ?? null;
        // Reject profiles older than our last save — prevents post-save revert
        if (lastSavedTimestamp.value > 0 && (published ?? 0) < lastSavedTimestamp.value) return;
        if (lastHydratedPublished.value === published) return;

        const v = p.value;
        const fresh = {
          firstName: v.name?.first ?? "",
          lastName: v.name?.last ?? "",
          pronouns: v.pronouns ?? "",
          school: v.school ?? "",
          year: v.year ?? "",
          major: v.major ?? "",
          tracks: [...(v.tracks ?? [])],
          fields: [...(v.fieldsOfInterest ?? [])],
          q1: v.answers?.q1 ?? "",
          q2: v.answers?.q2 ?? "",
          q3: v.answers?.q3 ?? "",
          status: v.status ?? "green",
          lookingForCount: v.lookingForCount ?? 3,
          confirmedTeammates: [...(v.confirmedTeammates ?? [])].slice(0, 3),
          avatar: v.avatar ?? null,
          gallery: [...(v.gallery ?? [])].slice(0, 10),
        };
        isHydrating = true;
        form.value = fresh;
        schoolSearch.value = fresh.school ?? "";
        lastHydratedPublished.value = published;
        wizardStep.value = -1; // profile exists — use full form
        localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(fresh));
        // Clear flag after Vue flushes the form watcher caused by form.value = fresh
        nextTick(() => { isHydrating = false; });
      },
      { immediate: true },
    );

    // Auto-save form draft to localStorage on every change.
    // Covers both wizard (no-profile-yet) and edit mode — data survives
    // navigation even if the user never clicks Save/Create Profile.
    watch(form, (f) => {
      try { localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(f)); } catch {}
    }, { deep: true });

    // ── Validation ────────────────────────────────────────────────────
    const errorMsg = ref("");
    const successMsg = ref("");
    const isSaving = ref(false);
    // 'idle' | 'saving' | 'saved' | 'error'
    const autoSaveStatus = ref('idle');

    // ── Character-limit flash state ───────────────────────────────────
    const limitFlash = ref({});
    const _limitTimers = {};
    function checkLimit(e, name, maxLen) {
      if (e.target.value.length >= maxLen) {
        const isModifier = e.ctrlKey || e.metaKey || e.altKey;
        const isNavKey = ['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Tab','Escape','Enter'].includes(e.key);
        if (!isModifier && !isNavKey && e.key.length === 1) {
          limitFlash.value = { ...limitFlash.value, [name]: true };
          clearTimeout(_limitTimers[name]);
          _limitTimers[name] = setTimeout(() => {
            const next = { ...limitFlash.value };
            delete next[name];
            limitFlash.value = next;
          }, 600);
        }
      }
    }

    // ── School combobox ──────────────────────────────────────────────
    const schoolDropdownOpen = ref(false);
    const schoolFilteredList = computed(() => {
      const q = schoolSearch.value.trim().toLowerCase();
      if (!q) return SCHOOLS;
      return SCHOOLS.filter(s => s.toLowerCase().includes(q));
    });
    function selectSchool(school) {
      form.value.school = school;
      schoolSearch.value = school;
      schoolDropdownOpen.value = false;
    }
    function onSchoolInput(e) {
      schoolSearch.value = e.target.value;
      form.value.school = "";
      schoolDropdownOpen.value = true;
    }
    function onSchoolBlur() {
      setTimeout(() => {
        schoolDropdownOpen.value = false;
        // If user typed but didn't pick from list, revert display to last valid selection
        if (!form.value.school) {
          schoolSearch.value = "";
        }
      }, 150);
    }

    function validate() {
      const f = form.value;
      const missing = [];
      if (!f.firstName) missing.push("First name");
      if (!f.lastName) missing.push("Last name");
      if (!f.school) missing.push("School");
      if (!f.year) missing.push("Class year");
      if (!f.major) missing.push("Major");
      if (!f.tracks.length) missing.push("At least one track");
      if (!f.q1) missing.push("Question 1");
      if (!f.q2) missing.push("Question 2");
      if (!f.q3) missing.push("Question 3");
      return missing;
    }

    async function doSave() {
      if (!session.value || isSaving.value) return;
      isSaving.value = true;
      autoSaveStatus.value = 'saving';
      const previousTeammates = new Set(myProfile.value?.value.confirmedTeammates ?? []);
      // Capture the old profile BEFORE posting so we can delete it afterward
      const oldProfile = myProfile.value;
      try {
        const f = form.value;
        const publishedTs = Date.now();
        // POST new profile first — new data is immediately visible, no null window
        await graffiti.post(
          {
            value: {
              activity: "Profile",
              name: { first: f.firstName, last: f.lastName },
              pronouns: f.pronouns,
              school: f.school,
              year: f.year,
              major: f.major,
              tracks: [...f.tracks],
              fieldsOfInterest: [...(f.fields ?? [])],
              answers: { q1: f.q1, q2: f.q2, q3: f.q3 },
              status: f.status,
              lookingForCount: Math.min(3, Math.max(1, Number(f.lookingForCount) || 1)),
              confirmedTeammates: [...new Set(f.confirmedTeammates ?? [])].slice(0, 3),
              ...(f.avatar ? { avatar: f.avatar } : {}),
              gallery: [...(f.gallery ?? [])].slice(0, 10),
              describes: session.value.actor,
              published: publishedTs,
            },
            channels: [HACKMATCH_CHANNEL],
          },
          session.value,
        );
        // Lock the watcher against any profile older than this save
        lastSavedTimestamp.value = publishedTs;
        lastHydratedPublished.value = publishedTs;
        localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(f));
        // Delete old profile in the background — non-critical cleanup
        if (oldProfile) {
          graffiti.delete(oldProfile, session.value).catch(() => {});
        }
        // Post TeamInvite to newly-added teammates
        const savedTeammates = [...new Set(f.confirmedTeammates ?? [])].slice(0, 3);
        const myActorId = session.value.actor;
        const fullTeam = [myActorId, ...savedTeammates];
        for (const targetActor of savedTeammates) {
          if (previousTeammates.has(targetActor)) continue;
          try {
            await graffiti.post(
              {
                value: {
                  activity: "TeamInvite27",
                  from: myActorId,
                  to: targetActor,
                  fromTeam: fullTeam,
                  published: Date.now(),
                },
                channels: [targetActor],
                allowed: [myActorId, targetActor],
              },
              session.value,
            );
          } catch { /* non-critical */ }
        }
        autoSaveStatus.value = 'saved';
        setTimeout(() => { if (autoSaveStatus.value === 'saved') autoSaveStatus.value = 'idle'; }, 2500);
      } catch (err) {
        autoSaveStatus.value = 'error';
        errorMsg.value = "Auto-save failed: " + (err?.message ?? err);
        setTimeout(() => { if (autoSaveStatus.value === 'error') autoSaveStatus.value = 'idle'; }, 3000);
      } finally {
        isSaving.value = false;
      }
    }

    const wizardCompleteModal = ref(false);

    async function finishWizard() {
      if (validate().length === 0) {
        await doSave();
        wizardCompleteModal.value = true;
      }
    }

    // Debounced auto-save: triggers 1.5 s after last form change when form is valid.
    // Skips when the form change was caused by hydration or while in wizard mode.
    let autoSaveTimer = null;
    watch(form, () => {
      if (isHydrating) return;
      if (wizardStep.value >= 0) return;
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        if (validate().length === 0) doSave();
      }, 1500);
    }, { deep: true });

    function toggleTrack(track) {
      const idx = form.value.tracks.indexOf(track);
      if (idx >= 0) form.value.tracks.splice(idx, 1);
      else form.value.tracks.push(track);
    }

    function toggleField(field) {
      const idx = (form.value.fields ?? []).indexOf(field);
      if (idx >= 0) form.value.fields.splice(idx, 1);
      else {
        if (!form.value.fields) form.value.fields = [];
        form.value.fields.push(field);
      }
    }

    function wizardCanAdvance() {
      const f = form.value;
      if (wizardStep.value === 1) return !!(f.firstName.trim() && f.lastName.trim());
      if (wizardStep.value === 2) return !!(f.school.trim() && f.year && f.major.trim());
      if (wizardStep.value === 3) return f.tracks.length > 0;
      if (wizardStep.value === 5) return !!f.q1.trim();
      if (wizardStep.value === 6) return !!f.q2.trim();
      if (wizardStep.value === 7) return !!f.q3.trim();
      return true;
    }

    // ── Confirmed teammates ──────────────────────────────────────────
    const teammateSearch = ref("");
    const profileByActor = computed(() => {
      const map = new Map();
      for (const p of allProfiles.value) {
        const existing = map.get(p.actor);
        if (!existing || p.value.published > existing.value.published)
          map.set(p.actor, p);
      }
      return map;
    });
    const confirmedProfiles = computed(() =>
      (form.value.confirmedTeammates ?? [])
        .map((actor) => profileByActor.value.get(actor))
        .filter(Boolean),
    );

    // Mutually confirmed: they also have me in their confirmedTeammates
    const mutualTeammates = computed(() => {
      if (!session.value?.actor) return [];
      const myActorId = session.value.actor;
      return confirmedProfiles.value.filter(p =>
        (p.value.confirmedTeammates ?? []).includes(myActorId)
      );
    });

    // Pending outgoing: I listed them but they haven't listed me back
    const pendingOutgoing = computed(() => {
      if (!session.value?.actor) return [];
      const myActorId = session.value.actor;
      return confirmedProfiles.value.filter(p =>
        !(p.value.confirmedTeammates ?? []).includes(myActorId)
      );
    });

    // Auto-accept invites where autoConfirmedBy is already one of our mutual teammates
    const autoAcceptingKeys = new Set();
    watch([pendingInvites, mutualTeammates], async ([invites, myMutuals]) => {
      if (!session.value?.actor || !myProfile.value) return;
      const myMutualSet = new Set(myMutuals.map(p => p.actor));
      for (const inv of invites) {
        const confirmedBy = inv.value.autoConfirmedBy;
        if (!confirmedBy || !myMutualSet.has(confirmedBy)) continue;
        const invKey = inv.url ?? `${inv.value.from}:${inv.value.published}`;
        if (autoAcceptingKeys.has(invKey)) continue;
        autoAcceptingKeys.add(invKey);
        await acceptInvite(inv);
      }
    });

    const teammateResults = computed(() => {
      const q = teammateSearch.value.trim().toLowerCase();
      if (!q || !session.value) return [];
      const selected = new Set(form.value.confirmedTeammates ?? []);
      return [...profileByActor.value.values()]
        .filter(
          (p) => p.actor !== session.value.actor && !selected.has(p.actor),
        )
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
    function teammateAvatarStyle(profile) {
      return profile?.value.avatar
        ? {
            backgroundImage: "url(" + profile.value.avatar + ")",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : { background: avatarGradient(profile?.actor ?? "") };
    }
    function addConfirmedTeammate(profile) {
      if (!profile || (form.value.confirmedTeammates ?? []).includes(profile.actor)) return;
      const myTeammates = form.value.confirmedTeammates ?? [];
      if (myTeammates.length >= 3) {
        errorMsg.value = "You can have at most 3 teammates.";
        return;
      }
      form.value.confirmedTeammates = [...myTeammates, profile.actor];
      teammateSearch.value = "";
      errorMsg.value = "";
    }
    async function removeConfirmedTeammate(actor) {
      form.value.confirmedTeammates = (form.value.confirmedTeammates ?? []).filter(id => id !== actor);
      // Immediately persist so the other person's client sees the change
      if (myProfile.value && session.value) {
        try {
          const v = myProfile.value.value;
          await graffiti.delete(myProfile.value, session.value);
          await graffiti.post(
            { value: { ...v, confirmedTeammates: form.value.confirmedTeammates, published: Date.now() }, channels: [HACKMATCH_CHANNEL] },
            session.value,
          );
        } catch { /* non-critical */ }
      }
      // Notify the removed person so their client auto-removes us back
      if (session.value?.actor) {
        try {
          await graffiti.post({
            value: { activity: 'TeamDecline27', from: session.value.actor, to: actor, published: Date.now() },
            channels: [actor],
            allowed: [session.value.actor, actor],
          }, session.value);
        } catch { /* non-critical */ }
      }
    }

    // ── Avatar editing ────────────────────────────────────────────────
    const showAvatarMenu = ref(false);
    const cropSrc = ref(null);
    const cropX = ref(0);
    const cropY = ref(0);
    const cropScale = ref(1);
    const minCropScale = ref(1);
    const cropZoom = ref(0);
    const cropNatW = ref(0);
    const cropNatH = ref(0);
    const cropTarget = ref({ type: "avatar", index: null });

    const cropViewportW = computed(() =>
      cropTarget.value.type === "gallery" ? galleryCropViewport().width : AVATAR_CROP_SIZE,
    );
    const cropViewportH = computed(() =>
      cropTarget.value.type === "gallery" ? galleryCropViewport().height : AVATAR_CROP_SIZE,
    );
    const cropDisplayW = computed(() => cropNatW.value * cropScale.value);
    const cropDisplayH = computed(() => cropNatH.value * cropScale.value);

    let _dragging = false,
      _dragX0 = 0,
      _dragY0 = 0,
      _imgX0 = 0,
      _imgY0 = 0;

    function clampCrop() {
      const w = cropViewportW.value;
      const h = cropViewportH.value;
      const imgW = cropDisplayW.value;
      const imgH = cropDisplayH.value;
      cropX.value = imgW <= w ? (w - imgW) / 2 : Math.min(0, Math.max(w - imgW, cropX.value));
      cropY.value = imgH <= h ? (h - imgH) / 2 : Math.min(0, Math.max(h - imgH, cropY.value));
    }

    function galleryCropViewport() {
      if (!cropNatW.value || !cropNatH.value) {
        return { width: GALLERY_CROP_MAX_W, height: GALLERY_CROP_MAX_H };
      }
      const aspect = cropNatW.value / cropNatH.value;
      let width = GALLERY_CROP_MAX_W;
      let height = width / aspect;
      if (height > GALLERY_CROP_MAX_H) {
        height = GALLERY_CROP_MAX_H;
        width = height * aspect;
      }
      return {
        width: Math.max(150, Math.round(width)),
        height: Math.max(150, Math.round(height)),
      };
    }

    function onImgLoad(e) {
      const img = e.target;
      cropNatW.value = img.naturalWidth;
      cropNatH.value = img.naturalHeight;
      const scale = Math.max(
        cropViewportW.value / img.naturalWidth,
        cropViewportH.value / img.naturalHeight,
      );
      minCropScale.value = scale;
      cropScale.value = scale;
      cropZoom.value = 0;
      cropX.value = (cropViewportW.value - img.naturalWidth * scale) / 2;
      cropY.value = (cropViewportH.value - img.naturalHeight * scale) / 2;
      clampCrop();
    }

    function onCropPointerDown(e) {
      _dragging = true;
      _dragX0 = e.clientX;
      _dragY0 = e.clientY;
      _imgX0 = cropX.value;
      _imgY0 = cropY.value;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    function onCropPointerMove(e) {
      if (!_dragging) return;
      cropX.value = _imgX0 + (e.clientX - _dragX0);
      cropY.value = _imgY0 + (e.clientY - _dragY0);
      clampCrop();
    }
    function onCropPointerUp() {
      _dragging = false;
    }

    function scaleFromZoom(zoom) {
      return minCropScale.value * (1 + (Number(zoom) / 100) * 3);
    }

    function zoomFromScale(scale) {
      if (!minCropScale.value) return 0;
      return Math.max(
        0,
        Math.min(100, ((scale / minCropScale.value - 1) / 3) * 100),
      );
    }

    function onZoomChange() {
      cropScale.value = scaleFromZoom(cropZoom.value);
      clampCrop();
    }

    function onCropWheel(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const oldScale = cropScale.value;
      const nextScale = Math.min(
        minCropScale.value * 4,
        Math.max(minCropScale.value, oldScale * (e.deltaY < 0 ? 1.08 : 0.92)),
      );
      if (nextScale === oldScale) return;
      const imgPointX = (pointerX - cropX.value) / oldScale;
      const imgPointY = (pointerY - cropY.value) / oldScale;
      cropScale.value = nextScale;
      cropZoom.value = zoomFromScale(nextScale);
      cropX.value = pointerX - imgPointX * nextScale;
      cropY.value = pointerY - imgPointY * nextScale;
      clampCrop();
    }

    function onFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      cropTarget.value = { type: "avatar", index: null };
      cropScale.value = 1;
      minCropScale.value = 1;
      cropZoom.value = 0;
      cropNatW.value = 0;
      cropNatH.value = 0;
      showAvatarMenu.value = false;
      const reader = new FileReader();
      reader.onload = (ev) => {
        cropSrc.value = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    }

    function deleteAvatar() {
      if (!window.confirm("Remove your profile photo?")) return;
      form.value.avatar = null;
      showAvatarMenu.value = false;
    }

    function cancelCrop() {
      cropSrc.value = null;
    }

    const AVATAR_OUT = 128; // output px — small enough for Graffiti, fine for profile pics
    const GALLERY_OUT_LONG_SIDE = 1000;

    function canvasToBlob(canvas, quality = 0.84) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Could not crop image."))),
          "image/jpeg",
          quality,
        );
      });
    }

    function applyCrop() {
      const canvas = document.createElement("canvas");
      if (cropTarget.value.type === "gallery") {
        const aspect = cropViewportW.value / cropViewportH.value;
        if (aspect >= 1) {
          canvas.width = GALLERY_OUT_LONG_SIDE;
          canvas.height = Math.round(GALLERY_OUT_LONG_SIDE / aspect);
        } else {
          canvas.height = GALLERY_OUT_LONG_SIDE;
          canvas.width = Math.round(GALLERY_OUT_LONG_SIDE * aspect);
        }
      } else {
        canvas.width = AVATAR_OUT;
        canvas.height = AVATAR_OUT;
      }
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scaleX = canvas.width / cropViewportW.value;
      const scaleY = canvas.height / cropViewportH.value;
      const img = new Image();
      img.onload = async () => {
        ctx.drawImage(
          img,
          cropX.value * scaleX,
          cropY.value * scaleY,
          cropDisplayW.value * scaleX,
          cropDisplayH.value * scaleY,
        );
        try {
          const blob = await canvasToBlob(canvas, cropTarget.value.type === "gallery" ? 0.86 : 0.78);
          const url = await graffiti.postMedia({ data: blob }, session.value);
          if (cropTarget.value.type === "gallery") {
            const photo = { url, caption: "" };
            if (Number.isInteger(cropTarget.value.index)) {
              form.value.gallery.splice(cropTarget.value.index, 1, {
                ...form.value.gallery[cropTarget.value.index],
                url,
              });
            } else {
              form.value.gallery = [...(form.value.gallery ?? []), photo].slice(0, 10);
            }
          } else {
            form.value.avatar = url;
          }
        } catch (err) {
          errorMsg.value = "Upload failed: " + (err?.message ?? err);
        } finally {
          cropSrc.value = null;
        }
      };
      img.src = cropSrc.value;
    }

    function onGalleryFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      if ((form.value.gallery ?? []).length >= 10) {
        errorMsg.value = "You can add up to 10 gallery photos.";
        e.target.value = "";
        return;
      }
      cropTarget.value = { type: "gallery", index: null };
      cropScale.value = 1;
      minCropScale.value = 1;
      cropZoom.value = 0;
      cropNatW.value = 0;
      cropNatH.value = 0;
      const reader = new FileReader();
      reader.onload = (ev) => {
        cropSrc.value = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    }

    function removeGalleryPhoto(index) {
      if (!window.confirm("Delete this gallery photo?")) return;
      form.value.gallery.splice(index, 1);
    }

    function moveGalleryPhoto(from, to) {
      const photos = form.value.gallery;
      if (
        from === to ||
        from == null ||
        to == null ||
        from < 0 ||
        to < 0 ||
        from >= photos.length ||
        to >= photos.length
      ) return;
      const [photo] = photos.splice(from, 1);
      photos.splice(to, 0, photo);
    }

    const galleryDragIndex = ref(null);
    const galleryDragPoint = ref({ x: 0, y: 0 });
    const galleryDragPhoto = computed(() =>
      galleryDragIndex.value == null ? null : form.value.gallery[galleryDragIndex.value],
    );

    function startGalleryPointerDrag(index, e) {
      if (e.target.closest("button, textarea, input, label")) return;
      e.preventDefault();
      galleryDragIndex.value = index;
      galleryDragPoint.value = { x: e.clientX, y: e.clientY };
      document.body.classList.add("gallery-dragging-active");
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    function updateGalleryPointerDrag(e) {
      if (galleryDragIndex.value == null) return;
      galleryDragPoint.value = { x: e.clientX, y: e.clientY };
    }

    function galleryIndexAtPoint(x, y) {
      const cards = [...document.querySelectorAll(".gallery-editor-item")];
      const card = cards.find((el) => {
        const rect = el.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      });
      return card ? Number(card.dataset.galleryIndex) : -1;
    }

    function finishGalleryPointerDrag(e) {
      if (galleryDragIndex.value == null) return;
      const target = galleryIndexAtPoint(e.clientX, e.clientY);
      if (target >= 0) moveGalleryPhoto(galleryDragIndex.value, target);
      galleryDragIndex.value = null;
      document.body.classList.remove("gallery-dragging-active");
    }

    function cancelGalleryPointerDrag() {
      galleryDragIndex.value = null;
      document.body.classList.remove("gallery-dragging-active");
    }

    function clampLookingForCount() {
      const n = Number(form.value.lookingForCount);
      form.value.lookingForCount = Math.min(3, Math.max(1, Number.isFinite(n) ? n : 1));
    }

    function cleanGalleryCaption(photo) {
      photo.caption = (photo.caption ?? "").replace(/\s*\n+\s*/g, " ").slice(0, 40);
    }

    return {
      session,
      form,
      myProfile,
      profileLoading,
      errorMsg,
      successMsg,
      isSaving,
      autoSaveStatus,
      toggleTrack,
      teammateSearch,
      teammateResults,
      confirmedProfiles,
      profileName,
      teammateAvatarStyle,
      addConfirmedTeammate,
      removeConfirmedTeammate,
      showAvatarMenu,
      cropSrc,
      cropTarget,
      cropX,
      cropY,
      cropScale,
      minCropScale,
      cropZoom,
      cropViewportW,
      cropViewportH,
      cropDisplayW,
      cropDisplayH,
      onImgLoad,
      onCropPointerDown,
      onCropPointerMove,
      onCropPointerUp,
      onZoomChange,
      onCropWheel,
      onFileSelect,
      onGalleryFileSelect,
      removeGalleryPhoto,
      moveGalleryPhoto,
      galleryDragIndex,
      galleryDragPoint,
      galleryDragPhoto,
      startGalleryPointerDrag,
      updateGalleryPointerDrag,
      finishGalleryPointerDrag,
      cancelGalleryPointerDrag,
      clampLookingForCount,
      cleanGalleryCaption,
      deleteAvatar,
      cancelCrop,
      applyCrop,
      AVATAR_CROP_SIZE,
      TRACKS,
      YEARS,
      SCHOOLS,
      PROFILE_QUESTIONS,
      FIELDS_OF_INTEREST,
      schoolSearch,
      schoolDropdownOpen,
      schoolFilteredList,
      selectSchool,
      onSchoolInput,
      onSchoolBlur,
      avatarGradient,
      initials,
      toggleField,
      wizardStep,
      isWizardMode,
      wizardCanAdvance,
      wizardCompleteModal,
      finishWizard,
      pendingInvites,
      isAcceptingInvite,
      inviteError,
      inviteProfileModal,
      confirmDialog,
      withConfirm,
      acceptInvite,
      declineInvite,
      profileByActor,
      mutualTeammates,
      pendingOutgoing,
      limitFlash,
      checkLimit,
    };
  },

  template: `
    <div class="profile-container">

      <!-- Login gate -->
      <div v-if="!session" class="lock-screen">
        <div class="lock-icon">👋</div>
        <div class="lock-title">Welcome to HackMatch</div>
        <div class="lock-desc">Log in to set up your profile and find hackathon teammates.</div>
        <button class="btn btn-primary" @click="$graffiti.login()">Log In / Sign Up</button>
      </div>

      <template v-else>
        <div class="profile-banner">
          <div class="profile-av-wrap">
            <ProfileAvatar
              :profile="{ actor: session.actor, value: { avatar: form.avatar } }"
              :actor="session.actor"
              :initials="(form.firstName && form.lastName) ? (form.firstName[0] + form.lastName[0]).toUpperCase() : '?'"
              :gradient="avatarGradient(session.actor)"
              size="xl"
            />
            <button class="av-edit-btn" @click="showAvatarMenu = true" title="Edit photo">✏️</button>
          </div>
          <div class="profile-banner-title">
            {{ (myProfile || form.firstName) ? 'Edit Your Profile' : 'Set Up Your Profile' }}
          </div>
          <div class="profile-banner-sub">Let hackers get to know you ✨</div>
        </div>

        <!-- ── Wizard mode (first-time setup) ── -->
        <div v-if="isWizardMode" class="wizard-container">
          <!-- Pending invites banner (visible in wizard too) -->
          <div v-if="pendingInvites.length" class="invite-banner">
            <span>🤝 You have {{ pendingInvites.length }} teammate invite{{ pendingInvites.length !== 1 ? 's' : '' }}! Check your Profile after setup to accept.</span>
          </div>
          <div class="wizard-progress-wrap">
            <div class="wizard-progress-bar" :style="{ width: (wizardStep === 0 ? 0 : wizardStep / 8 * 100) + '%' }"></div>
          </div>

          <!-- Step content (keyed so slide animation fires on each step change) -->
          <div :key="wizardStep" class="wizard-step-anim">

          <!-- Step 0: Welcome -->
          <div v-if="wizardStep === 0" class="wizard-step wizard-welcome">
            <div class="wizard-welcome-emoji">✨</div>
            <h2 class="wizard-welcome-title">Welcome to the hackathon!</h2>
            <p class="wizard-welcome-sub">Let's get started on writing down what you want your potential teammates to know about you.</p>
            <button class="btn btn-primary wizard-start-btn" @click="wizardStep = 1">Get Started →</button>
          </div>

          <!-- Step 1: Name -->
          <div v-else-if="wizardStep === 1" class="wizard-step">
            <div class="wizard-step-label">Step 1 of 8</div>
            <div class="wizard-step-title">🙋 Tell us your name</div>
            <div class="form-grid" style="margin-top:16px">
              <div class="form-grp">
                <label class="form-label">First Name <span class="req-star">*</span></label>
                <div class="limit-wrap" :class="{ 'at-limit': limitFlash['firstName'] }">
                  <div class="limit-tooltip" v-if="limitFlash['firstName']">Character limit exceeded</div>
                  <input class="form-input" v-model="form.firstName" placeholder="e.g. Alex" maxlength="20" @keydown="e => checkLimit(e, 'firstName', 20)">
                </div>
              </div>
              <div class="form-grp">
                <label class="form-label">Last Name <span class="req-star">*</span></label>
                <div class="limit-wrap" :class="{ 'at-limit': limitFlash['lastName'] }">
                  <div class="limit-tooltip" v-if="limitFlash['lastName']">Character limit exceeded</div>
                  <input class="form-input" v-model="form.lastName" placeholder="e.g. Chen" maxlength="20" @keydown="e => checkLimit(e, 'lastName', 20)">
                </div>
              </div>
              <div class="form-grp full">
                <label class="form-label">Pronouns <span style="color:var(--text3);font-weight:400">(optional)</span></label>
                <div class="limit-wrap" :class="{ 'at-limit': limitFlash['pronouns'] }">
                  <div class="limit-tooltip" v-if="limitFlash['pronouns']">Character limit exceeded</div>
                  <input class="form-input" v-model="form.pronouns" placeholder="e.g. she/her" maxlength="20" @keydown="e => checkLimit(e, 'pronouns', 20)">
                </div>
              </div>
            </div>
          </div>

          <!-- Step 2: School -->
          <div v-else-if="wizardStep === 2" class="wizard-step">
            <div class="wizard-step-label">Step 2 of 8</div>
            <div class="wizard-step-title">🎓 Where do you go to school?</div>
            <div class="form-grid" style="margin-top:16px">
              <div class="form-grp full">
                <label class="form-label">School / University <span class="req-star">*</span></label>
                <div class="school-combo">
                  <input
                    class="form-input"
                    :value="schoolSearch"
                    @input="onSchoolInput"
                    @focus="schoolDropdownOpen = true"
                    @blur="onSchoolBlur"
                    placeholder="Search for your school..."
                    autocomplete="off"
                  >
                  <div v-if="schoolDropdownOpen && schoolFilteredList.length" class="school-combo-dropdown">
                    <div
                      v-for="s in schoolFilteredList.slice(0, 20)"
                      :key="s"
                      class="school-combo-option"
                      @mousedown.prevent="selectSchool(s)"
                    >{{ s }}</div>
                  </div>
                </div>
              </div>
              <div class="form-grp">
                <label class="form-label">Class Year <span class="req-star">*</span></label>
                <select class="form-sel" v-model="form.year">
                  <option value="">Select year</option>
                  <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
                </select>
              </div>
              <div class="form-grp">
                <label class="form-label">Major / Field <span class="req-star">*</span></label>
                <div class="limit-wrap" :class="{ 'at-limit': limitFlash['major'] }">
                  <div class="limit-tooltip" v-if="limitFlash['major']">Character limit exceeded</div>
                  <input class="form-input" v-model="form.major" placeholder="e.g. CS + Design" maxlength="50" @keydown="e => checkLimit(e, 'major', 50)">
                </div>
              </div>
            </div>
          </div>

          <!-- Step 3: Tracks -->
          <div v-else-if="wizardStep === 3" class="wizard-step">
            <div class="wizard-step-label">Step 3 of 8</div>
            <div class="wizard-step-title">🎯 Which hackathon tracks interest you? <span class="req-star">*</span></div>
            <div class="wizard-step-sub">Select at least one</div>
            <div class="tracks-grid" style="margin-top:16px">
              <label v-for="t in TRACKS" :key="t" class="track-chip" :class="{ on: form.tracks.includes(t) }">
                <input type="checkbox" :checked="form.tracks.includes(t)" @change="toggleTrack(t)">
                {{ t }}
              </label>
            </div>
          </div>

          <!-- Step 4: Fields of Interest -->
          <div v-else-if="wizardStep === 4" class="wizard-step">
            <div class="wizard-step-label">Step 4 of 8</div>
            <div class="wizard-step-title">💡 Fields of interest</div>
            <div class="wizard-step-sub">Optional — pick any that apply</div>
            <div class="tracks-grid" style="margin-top:16px">
              <label v-for="fi in FIELDS_OF_INTEREST" :key="fi" class="track-chip field-chip" :class="{ on: (form.fields || []).includes(fi) }">
                <input type="checkbox" :checked="(form.fields || []).includes(fi)" @change="toggleField(fi)">
                {{ fi }}
              </label>
            </div>
          </div>

          <!-- Step 5: Q1 -->
          <div v-else-if="wizardStep === 5" class="wizard-step">
            <div class="wizard-step-label">Step 5 of 8</div>
            <div class="wizard-step-title">💬 {{ PROFILE_QUESTIONS[0] }}</div>
            <div class="limit-wrap" :class="{ 'at-limit': limitFlash['q1'] }">
              <div class="limit-tooltip" v-if="limitFlash['q1']">Character limit exceeded</div>
              <textarea class="form-ta wizard-ta" v-model="form.q1" placeholder="Your answer..." maxlength="500" @keydown="e => checkLimit(e, 'q1', 500)"></textarea>
            </div>
            <div class="char-count" :class="{ warn: (form.q1 || '').length >= 480 }">{{ (form.q1 || '').length }}/500</div>
          </div>

          <!-- Step 6: Q2 -->
          <div v-else-if="wizardStep === 6" class="wizard-step">
            <div class="wizard-step-label">Step 6 of 8</div>
            <div class="wizard-step-title">💬 {{ PROFILE_QUESTIONS[1] }}</div>
            <div class="limit-wrap" :class="{ 'at-limit': limitFlash['q2'] }">
              <div class="limit-tooltip" v-if="limitFlash['q2']">Character limit exceeded</div>
              <textarea class="form-ta wizard-ta" v-model="form.q2" placeholder="Your answer..." maxlength="500" @keydown="e => checkLimit(e, 'q2', 500)"></textarea>
            </div>
            <div class="char-count" :class="{ warn: (form.q2 || '').length >= 480 }">{{ (form.q2 || '').length }}/500</div>
          </div>

          <!-- Step 7: Q3 -->
          <div v-else-if="wizardStep === 7" class="wizard-step">
            <div class="wizard-step-label">Step 7 of 8</div>
            <div class="wizard-step-title">💬 {{ PROFILE_QUESTIONS[2] }}</div>
            <div class="limit-wrap" :class="{ 'at-limit': limitFlash['q3'] }">
              <div class="limit-tooltip" v-if="limitFlash['q3']">Character limit exceeded</div>
              <textarea class="form-ta wizard-ta" v-model="form.q3" placeholder="Your answer..." maxlength="500" @keydown="e => checkLimit(e, 'q3', 500)"></textarea>
            </div>
            <div class="char-count" :class="{ warn: (form.q3 || '').length >= 480 }">{{ (form.q3 || '').length }}/500</div>
          </div>

          <!-- Step 8: Status -->
          <div v-else-if="wizardStep === 8" class="wizard-step">
            <div class="wizard-step-label">Step 8 of 8</div>
            <div class="wizard-step-title">🔵 What's your teammate status?</div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px">
              <label
                v-for="s in [{v:'green',l:'Looking for teammates'},{v:'yellow',l:'Deciding'},{v:'red',l:'Team full'}]"
                :key="s.v" class="status-radio-label" :class="{ on: form.status === s.v }"
              >
                <input type="radio" :value="s.v" v-model="form.status" style="display:none">
                <span class="sdot" :class="s.v"></span>
                {{ s.l }}
              </label>
            </div>
            <div v-if="form.status === 'green'" class="lf-row" style="margin-top:12px">
              Looking for
              <input type="number" v-model.number="form.lookingForCount" min="1" max="3" class="lf-number-input" @input="clampLookingForCount">
              more teammates
            </div>
          </div>

          </div> <!-- end wizard-step-anim -->

          <!-- Wizard navigation -->
          <div v-if="wizardStep >= 1" class="wizard-nav">
            <div v-if="errorMsg" class="profile-msg err" style="margin-bottom:8px">⚠️ {{ errorMsg }}</div>
            <div class="wizard-nav-row">
              <button class="btn btn-ghost" @click="wizardStep--">← Back</button>
              <button
                v-if="wizardStep < 8"
                class="btn btn-primary"
                :disabled="!wizardCanAdvance()"
                @click="wizardStep++"
              >Next →</button>
              <button
                v-else
                class="btn btn-primary"
                :disabled="isSaving || !form.status"
                @click="finishWizard"
              >{{ isSaving ? 'Creating...' : 'Create Profile →' }}</button>
            </div>
          </div>
        </div>

        <!-- ── Full form (existing profile or skipped wizard) ── -->
        <template v-else>

        <!-- Basic info -->
        <div class="form-sec">
          <div class="form-sec-title">🙋 Basic Info <span class="req-star">*</span></div>
          <div class="form-grid">
            <div class="form-grp">
              <label class="form-label">First Name <span class="req-star">*</span></label>
              <div class="limit-wrap" :class="{ 'at-limit': limitFlash['firstName'] }">
                <div class="limit-tooltip" v-if="limitFlash['firstName']">Character limit exceeded</div>
                <input class="form-input" v-model="form.firstName" placeholder="e.g. Alex" maxlength="20" @keydown="e => checkLimit(e, 'firstName', 20)">
              </div>
            </div>
            <div class="form-grp">
              <label class="form-label">Last Name <span class="req-star">*</span></label>
              <div class="limit-wrap" :class="{ 'at-limit': limitFlash['lastName'] }">
                <div class="limit-tooltip" v-if="limitFlash['lastName']">Character limit exceeded</div>
                <input class="form-input" v-model="form.lastName" placeholder="e.g. Chen" maxlength="20" @keydown="e => checkLimit(e, 'lastName', 20)">
              </div>
            </div>
            <div class="form-grp">
              <label class="form-label">Pronouns</label>
              <div class="limit-wrap" :class="{ 'at-limit': limitFlash['pronouns'] }">
                <div class="limit-tooltip" v-if="limitFlash['pronouns']">Character limit exceeded</div>
                <input class="form-input" v-model="form.pronouns" placeholder="e.g. she/her" maxlength="20" @keydown="e => checkLimit(e, 'pronouns', 20)">
              </div>
            </div>
            <div class="form-grp">
              <label class="form-label">Class Year <span class="req-star">*</span></label>
              <select class="form-sel" v-model="form.year">
                <option value="">Select year</option>
                <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
              </select>
            </div>
            <div class="form-grp full">
              <label class="form-label">School / University <span class="req-star">*</span></label>
              <div class="school-combo">
                <input
                  class="form-input"
                  :value="schoolSearch"
                  @input="onSchoolInput"
                  @focus="schoolDropdownOpen = true"
                  @blur="onSchoolBlur"
                  placeholder="Search for your school..."
                  autocomplete="off"
                >
                <div v-if="schoolDropdownOpen && schoolFilteredList.length" class="school-combo-dropdown">
                  <div
                    v-for="s in schoolFilteredList.slice(0, 20)"
                    :key="s"
                    class="school-combo-option"
                    @mousedown.prevent="selectSchool(s)"
                  >{{ s }}</div>
                </div>
              </div>
            </div>
            <div class="form-grp full">
              <label class="form-label">Major / Field <span class="req-star">*</span></label>
              <div class="limit-wrap" :class="{ 'at-limit': limitFlash['major'] }">
                <div class="limit-tooltip" v-if="limitFlash['major']">Character limit exceeded</div>
                <input class="form-input" v-model="form.major" placeholder="e.g. CS + Design" maxlength="50" @keydown="e => checkLimit(e, 'major', 50)">
              </div>
            </div>
          </div>
        </div>

        <!-- Tracks -->
        <div class="form-sec">
          <div class="form-sec-title">
            🎯 Tracks of Interest
            <span style="font-size:12px;font-weight:400;color:var(--text3)">(select at least one) <span class="req-star">*</span></span>
          </div>
          <div class="tracks-grid">
            <label v-for="t in TRACKS" :key="t" class="track-chip" :class="{ on: form.tracks.includes(t) }">
              <input type="checkbox" :checked="form.tracks.includes(t)" @change="toggleTrack(t)">
              {{ t }}
            </label>
          </div>
        </div>

        <!-- Fields of interest -->
        <div class="form-sec">
          <div class="form-sec-title">
            💡 Fields of Interest
            <span style="font-size:12px;font-weight:400;color:var(--text3)">(optional)</span>
          </div>
          <div class="tracks-grid">
            <label v-for="fi in FIELDS_OF_INTEREST" :key="fi" class="track-chip field-chip" :class="{ on: (form.fields || []).includes(fi) }">
              <input type="checkbox" :checked="(form.fields || []).includes(fi)" @change="toggleField(fi)">
              {{ fi }}
            </label>
          </div>
        </div>

        <!-- Q&A -->
        <div class="form-sec">
          <div class="form-sec-title">💬 About You <span class="req-star">*</span></div>
          <div style="display:flex;flex-direction:column;gap:14px">
            <div v-for="(q, i) in PROFILE_QUESTIONS" :key="i" class="form-grp">
              <label class="form-label">{{ q }} <span class="req-star">*</span></label>
              <div class="limit-wrap" :class="{ 'at-limit': limitFlash['q' + (i+1)] }">
                <div class="limit-tooltip" v-if="limitFlash['q' + (i+1)]">Character limit exceeded</div>
                <textarea class="form-ta" v-model="form['q' + (i+1)]" placeholder="Your answer..." maxlength="500" @keydown="e => checkLimit(e, 'q' + (i+1), 500)"></textarea>
              </div>
              <div class="char-count" :class="{ warn: (form['q' + (i+1)] || '').length >= 480 }">{{ (form['q' + (i+1)] || '').length }}/500</div>
            </div>
          </div>
        </div>

        <!-- Photo gallery -->
        <div class="form-sec">
          <div class="form-sec-title gallery-editor-title">
            <div>
              📷 Photo Gallery
              <span style="font-size:12px;font-weight:400;color:var(--text3)">(optional, up to 10 photos)</span>
            </div>
            <label v-if="form.gallery.length < 10" class="gallery-add-inline">
              + Add Photo
              <input type="file" accept="image/*" style="display:none" @change="onGalleryFileSelect">
            </label>
          </div>

          <div v-if="form.gallery.length" class="gallery-editor-wrap">
            <div class="gallery-editor-grid">
              <div
                v-for="(photo, index) in form.gallery"
                :key="photo.url || index"
                class="gallery-editor-item"
                :data-gallery-index="index"
                :class="{ dragging: galleryDragIndex === index }"
                @pointerdown="e => startGalleryPointerDrag(index, e)"
                @pointermove="updateGalleryPointerDrag"
                @pointerup="finishGalleryPointerDrag"
                @pointercancel="cancelGalleryPointerDrag"
              >
                <div class="gallery-order-badge">{{ index + 1 }}</div>
                <button
                  class="gallery-delete-btn"
                  @click="removeGalleryPhoto(index)"
                  title="Delete photo"
                >✕</button>
                <div class="gallery-editor-preview">
                  <img
                    v-if="photo.url?.startsWith('data:')"
                    :src="photo.url"
                    alt=""
                  >
                  <graffiti-get-media
                    v-else-if="photo.url"
                    v-slot="{ media }"
                    :url="photo.url"
                    :accept="{ types: ['image/*'] }"
                  >
                    <img v-if="media?.dataUrl" :src="media.dataUrl" alt="">
                  </graffiti-get-media>
                </div>
                <textarea
                  class="form-input gallery-caption-input"
                  v-model="photo.caption"
                  maxlength="40"
                  rows="1"
                  placeholder="Short caption"
                  @keydown.enter.prevent
                  @input="cleanGalleryCaption(photo)"
                ></textarea>
                <div class="gallery-caption-count">{{ (photo.caption || '').length }}/40</div>
              </div>
            </div>
            <div
              v-if="galleryDragPhoto"
              class="gallery-drag-preview-card"
              :style="{ left: galleryDragPoint.x + 'px', top: galleryDragPoint.y + 'px' }"
            >
              <div class="gallery-order-badge">{{ galleryDragIndex + 1 }}</div>
              <div class="gallery-editor-preview">
                <img
                  v-if="galleryDragPhoto.url?.startsWith('data:')"
                  :src="galleryDragPhoto.url"
                  alt=""
                >
                <graffiti-get-media
                  v-else-if="galleryDragPhoto.url"
                  v-slot="{ media }"
                  :url="galleryDragPhoto.url"
                  :accept="{ types: ['image/*'] }"
                >
                  <img v-if="media?.dataUrl" :src="media.dataUrl" alt="">
                </graffiti-get-media>
              </div>
              <div v-if="galleryDragPhoto.caption" class="gallery-drag-caption">
                {{ galleryDragPhoto.caption }}
              </div>
            </div>
          </div>
        </div>

        <!-- Status -->
        <div class="form-sec">
          <div class="form-sec-title">🔵 Teammate Status <span class="req-star">*</span></div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <label
              v-for="s in [{v:'green',l:'Looking for teammates'},{v:'yellow',l:'Deciding'},{v:'red',l:'Team full'}]"
              :key="s.v" class="status-radio-label" :class="{ on: form.status === s.v }"
            >
              <input type="radio" :value="s.v" v-model="form.status" style="display:none">
              <span class="sdot" :class="s.v"></span>
              {{ s.l }}
            </label>
          </div>
          <div v-if="form.status === 'green'" class="lf-row" style="margin-top:10px">
            <span>Looking for</span>
            <input type="number" v-model.number="form.lookingForCount" min="1" max="3" class="lf-number-input" @input="clampLookingForCount">
            <span>more teammates</span>
          </div>
        </div>

        <!-- Teammates section: mutual, incoming invites, outgoing pending, search -->
        <div class="form-sec">
          <div class="form-sec-title">
            👥 Teammates
            <span style="font-size:12px;font-weight:400;color:var(--text3)">(up to 3 on your team)</span>
          </div>
          <p style="font-size:13px;color:var(--text2);line-height:1.5;margin:0 0 14px">
            Browse the <strong>Feed</strong> to find people you vibe with, message them to connect, then send a teammate request here once you're ready to lock in your team.
          </p>

          <!-- 1. Mutually confirmed teammates -->
          <div v-if="mutualTeammates.length" class="teammate-subgroup">
            <div class="teammate-subgroup-title">✅ Confirmed</div>
            <div class="teammate-list">
              <div v-for="p in mutualTeammates" :key="p.actor" class="teammate-row">
                <div class="teammate-avatar" :style="teammateAvatarStyle(p)">
                  <span v-if="!p.value.avatar">{{ initials(p) }}</span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                  <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
                </div>
                <div class="invite-actions">
                  <button class="btn btn-ghost btn-xs" @click="inviteProfileModal = p">Profile</button>
                  <button class="teammate-remove" @click="withConfirm('Remove ' + profileName(p) + ' from your team?', () => removeConfirmedTeammate(p.actor))" title="Remove teammate">✕</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Incoming invite requests -->
          <div v-if="pendingInvites.length" class="teammate-subgroup">
            <div class="teammate-subgroup-title">📬 Invite Requests</div>
            <div v-if="inviteError" class="profile-msg err" style="margin-bottom:8px">⚠️ {{ inviteError }}</div>
            <div class="teammate-list">
              <div v-for="inv in pendingInvites" :key="inv.url ?? inv.value.published" class="invite-row">
                <div class="teammate-avatar" :style="profileByActor.get(inv.value.from)?.value.avatar
                  ? { backgroundImage: 'url(' + profileByActor.get(inv.value.from).value.avatar + ')', backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: avatarGradient(inv.value.from ?? '') }">
                  <span v-if="!profileByActor.get(inv.value.from)?.value.avatar">
                    {{ initials(profileByActor.get(inv.value.from)) }}
                  </span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(profileByActor.get(inv.value.from)) }} wants to team up</div>
                  <div class="teammate-meta">
                    {{ profileByActor.get(inv.value.from)?.value.major ?? '' }}{{ profileByActor.get(inv.value.from)?.value.school ? ' @ ' + profileByActor.get(inv.value.from).value.school : '' }}
                  </div>
                </div>
                <div class="invite-actions">
                  <button class="btn btn-ghost btn-xs" @click="inviteProfileModal = profileByActor.get(inv.value.from) ?? null">Profile</button>
                  <button class="btn btn-primary btn-xs" :disabled="isAcceptingInvite" @click="withConfirm('Accept teammate invite from ' + profileName(profileByActor.get(inv.value.from)) + '?', () => acceptInvite(inv))">Accept</button>
                  <button class="btn btn-ghost btn-xs" @click="withConfirm('Decline invite from ' + profileName(profileByActor.get(inv.value.from)) + '?', () => declineInvite(inv))">Decline</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Outgoing pending invites (they haven't accepted yet) -->
          <div v-if="pendingOutgoing.length" class="teammate-subgroup">
            <div class="teammate-subgroup-title">
              ⏳ Pending
              <span style="font-size:11px;font-weight:400;color:var(--text3)">
                ({{ pendingOutgoing.length }} of {{ 3 - mutualTeammates.length }} slots)
              </span>
            </div>
            <div class="teammate-list">
              <div v-for="p in pendingOutgoing" :key="p.actor" class="teammate-row">
                <div class="teammate-avatar" :style="teammateAvatarStyle(p)">
                  <span v-if="!p.value.avatar">{{ initials(p) }}</span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                  <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
                </div>
                <div class="invite-actions">
                  <button class="btn btn-ghost btn-xs" @click="inviteProfileModal = p">Profile</button>
                  <button class="teammate-remove" @click="withConfirm('Cancel your invite to ' + profileName(p) + '?', () => removeConfirmedTeammate(p.actor))" title="Cancel invite">✕</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 4. Search to add more (only when under the outgoing pending cap) -->
          <div v-if="pendingOutgoing.length < (3 - mutualTeammates.length)" class="teammate-search">
            <input
              class="form-input"
              v-model="teammateSearch"
              placeholder="Search people to invite..."
            >
            <div v-if="teammateResults.length" class="teammate-results">
              <button
                v-for="p in teammateResults"
                :key="p.actor"
                class="teammate-result"
                @click="addConfirmedTeammate(p)"
              >
                <div class="teammate-avatar" :style="teammateAvatarStyle(p)">
                  <span v-if="!p.value.avatar">{{ initials(p) }}</span>
                </div>
                <div class="teammate-info">
                  <div class="teammate-name">{{ profileName(p) }} <span v-if="p.value.pronouns">({{ p.value.pronouns }})</span></div>
                  <div class="teammate-meta">{{ p.value.major }} @ {{ p.value.school }} · {{ p.value.year }}</div>
                </div>
              </button>
            </div>
          </div>

          <div v-if="errorMsg" class="profile-msg err" style="margin-top:8px">⚠️ {{ errorMsg }}</div>
        </div>

        <div style="margin-top:10px;text-align:center;font-size:12px;color:var(--text3)">
          All fields marked * are required to access Feed and Messages
        </div>
        </template> <!-- end full form -->
      </template>

      <!-- ── Wizard complete popup ── -->
      <Teleport to="body">
        <div v-if="wizardCompleteModal" class="overlay open">
          <div class="modal modal-sm wizard-complete-modal">
            <div style="font-size:48px;text-align:center;margin-bottom:12px">🎉</div>
            <div class="modal-title" style="text-align:center;margin-bottom:10px">You're all set!</div>
            <p style="text-align:center;color:var(--text2);line-height:1.6;margin:0 0 20px">
              Your profile is live. Head to the <strong>Feed</strong> to browse hackers, start conversations, and find your team.
            </p>
            <div class="modal-actions" style="justify-content:center">
              <button class="btn btn-primary" @click="wizardCompleteModal = false; $emit('navigate', 'feed')">
                Browse the Feed →
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- ── Avatar menu popup ── -->
      <div v-if="showAvatarMenu" class="modal-backdrop" @click.self="showAvatarMenu = false">
        <div class="avatar-menu">
          <div class="avatar-menu-title">Profile Photo</div>
          <label class="avatar-menu-btn">
            📷 Choose Photo
            <input type="file" accept="image/*" style="display:none" @change="onFileSelect">
          </label>
          <button v-if="form.avatar" class="avatar-menu-btn danger" @click="deleteAvatar">🗑 Remove Photo</button>
          <button class="avatar-menu-btn muted" @click="showAvatarMenu = false">Cancel</button>
        </div>
      </div>

      <!-- ── Invite profile view modal ── -->
      <div v-if="inviteProfileModal" class="overlay open" @click.self="inviteProfileModal = null">
        <div class="profile-card-modal-wrap">
          <button class="profile-card-x" @click="inviteProfileModal = null">✕</button>
          <HackerCard :profile="inviteProfileModal" :readOnly="true" />
        </div>
      </div>

      <!-- ── Confirmation dialog ── -->
      <Teleport to="body">
        <div v-if="confirmDialog" class="overlay open" @click.self="confirmDialog = null">
          <div class="modal modal-sm">
            <div class="modal-hdr">
              <div class="modal-title">Are you sure?</div>
              <button class="modal-close" @click="confirmDialog = null">✕</button>
            </div>
            <p style="margin:0 0 20px;color:var(--text2);line-height:1.5">{{ confirmDialog.message }}</p>
            <div class="modal-actions">
              <button class="btn btn-secondary btn-sm" @click="confirmDialog = null">Cancel</button>
              <button class="btn btn-primary btn-sm" @click="confirmDialog.onConfirm(); confirmDialog = null">Confirm</button>
            </div>
          </div>
        </div>
      </Teleport>

      <!-- ── Crop modal ── -->
      <div v-if="cropSrc" class="modal-backdrop">
        <div class="crop-modal">
          <div class="crop-modal-title">Crop Photo</div>
          <div
            class="crop-viewport"
            :class="{ 'avatar-crop': cropTarget.type === 'avatar' }"
            :style="{ width: cropViewportW + 'px', height: cropViewportH + 'px' }"
            @pointerdown.prevent="onCropPointerDown"
            @pointermove.prevent="onCropPointerMove"
            @pointerup="onCropPointerUp"
            @pointercancel="onCropPointerUp"
            @wheel.prevent="onCropWheel"
          >
            <img
              :src="cropSrc"
              @load="onImgLoad"
              class="crop-img"
              :style="{ left: cropX + 'px', top: cropY + 'px', width: cropDisplayW + 'px', height: cropDisplayH + 'px' }"
              draggable="false"
            >
            <div v-if="cropTarget.type === 'avatar'" class="crop-circle-outline"></div>
          </div>
          <div class="crop-zoom-row">
            <span style="font-size:16px;line-height:1">−</span>
            <input
              type="range" class="crop-zoom-slider"
              v-model.number="cropZoom"
              min="0" max="100" step="1"
              @input="onZoomChange"
            >
            <span style="font-size:16px;line-height:1">+</span>
          </div>
          <div class="crop-hint">Drag to reposition · Scroll to zoom</div>
          <div class="modal-actions">
            <button class="btn btn-ghost" @click="cancelCrop">Cancel</button>
            <button class="btn btn-primary" @click="applyCrop">Apply</button>
          </div>
        </div>
      </div>

      <!-- ── Auto-save toast (bottom-right) ── -->
      <Teleport to="body">
        <div
          v-if="autoSaveStatus !== 'idle'"
          class="autosave-toast"
          :class="autoSaveStatus"
        >
          <span v-if="autoSaveStatus === 'saving'" class="btn-spinner autosave-spinner"></span>
          <span v-else-if="autoSaveStatus === 'saved'" class="autosave-icon">✓</span>
          <span v-else-if="autoSaveStatus === 'error'" class="autosave-icon">⚠️</span>
          <span class="autosave-text">
            <template v-if="autoSaveStatus === 'saving'">Auto-saving...</template>
            <template v-else-if="autoSaveStatus === 'saved'">Progress auto-saved!</template>
            <template v-else-if="autoSaveStatus === 'error'">Auto-save failed</template>
          </span>
        </div>
      </Teleport>

    </div>
  `,
};
