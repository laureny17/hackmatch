export default {
  name: "PhotoGallery",
  props: {
    photos: { type: Array, default: () => [] },
    title: { type: String, default: "Photo Gallery" },
  },

  data() {
    return {
      activeIndex: 0,
      expandedIndex: null,
    };
  },

  computed: {
    safePhotos() {
      return this.photos ?? [];
    },
    photoCount() {
      return this.safePhotos.length;
    },
    canPage() {
      return this.safePhotos.length > 3;
    },
    pageCount() {
      return Math.ceil(this.safePhotos.length / 3);
    },
    activePage() {
      return Math.floor(this.activeIndex / 3);
    },
    expandedPage() {
      return Number.isInteger(this.expandedIndex)
        ? Math.floor(this.expandedIndex / 3)
        : 0;
    },
    visiblePhotos() {
      const start = this.activePage * 3;
      return this.safePhotos
        .slice(start, start + 3)
        .map((photo, offset) => ({ photo, index: start + offset }));
    },
    expandedPhoto() {
      return Number.isInteger(this.expandedIndex)
        ? this.safePhotos[this.expandedIndex]
        : null;
    },
    expandedPhotoNumber() {
      return Number.isInteger(this.expandedIndex) ? this.expandedIndex + 1 : 0;
    },
  },

  methods: {
    next() {
      if (!this.safePhotos.length) return;
      const nextPage = (this.activePage + 1) % this.pageCount;
      this.activeIndex = nextPage * 3;
    },
    prev() {
      if (!this.safePhotos.length) return;
      const prevPage = (this.activePage - 1 + this.pageCount) % this.pageCount;
      this.activeIndex = prevPage * 3;
    },
    goToPage(page) {
      this.activeIndex = page * 3;
    },
    openExpanded(index) {
      this.expandedIndex = index;
    },
    closeExpanded() {
      this.expandedIndex = null;
    },
    nextExpanded() {
      if (!this.safePhotos.length) return;
      this.expandedIndex = (this.expandedIndex + 1) % this.safePhotos.length;
      this.activeIndex = this.expandedIndex;
    },
    prevExpanded() {
      if (!this.safePhotos.length) return;
      this.expandedIndex =
        (this.expandedIndex - 1 + this.safePhotos.length) %
        this.safePhotos.length;
      this.activeIndex = this.expandedIndex;
    },
    goToExpandedPage(page) {
      this.expandedIndex = Math.min(page * 3, this.safePhotos.length - 1);
      this.activeIndex = this.expandedIndex;
    },
  },

  template: `
    <section v-if="safePhotos.length" class="photo-gallery">
      <div class="photo-gallery-title">{{ title }}</div>
      <div class="gallery-carousel">
        <button
          v-if="canPage"
          class="gallery-nav gallery-nav-left"
          @click="prev"
          title="Previous photos"
        >‹</button>

        <div class="photo-gallery-grid">
          <figure
            v-for="{ photo, index } in visiblePhotos"
            :key="photo.url || photo.dataUrl || index"
            class="photo-gallery-item"
            :title="photo.caption || ''"
            @click="openExpanded(index)"
          >
            <img
              v-if="photo.dataUrl || (photo.url && photo.url.startsWith('data:'))"
              :src="photo.dataUrl || photo.url"
              alt=""
            >
            <div v-else class="gallery-media-shell">
              <graffiti-get-media
                v-if="photo.url"
                v-slot="{ media }"
                :url="photo.url"
                :accept="{ types: ['image/*'] }"
              >
                <img v-if="media?.dataUrl" :src="media.dataUrl" alt="">
                <div v-else class="gallery-media-loading">Loading...</div>
              </graffiti-get-media>
            </div>
            <figcaption v-if="photo.caption" class="photo-caption-tip">
              {{ photo.caption }}
            </figcaption>
          </figure>
        </div>

        <button
          v-if="canPage"
          class="gallery-nav gallery-nav-right"
          @click="next"
          title="Next photos"
        >›</button>
      </div>

      <div v-if="canPage" class="gallery-dots" aria-label="Photo navigation">
        <button
          v-for="page in pageCount"
          :key="'dot' + page"
          class="gallery-dot"
          :class="{ active: activePage === page - 1 }"
          @click="goToPage(page - 1)"
          :title="'Show photos ' + ((page - 1) * 3 + 1) + '-' + Math.min(page * 3, safePhotos.length)"
        ></button>
      </div>

      <Teleport to="body">
        <div v-if="expandedPhoto" class="overlay open gallery-overlay" @click.self="closeExpanded">
          <div class="modal photo-expanded-modal">
            <div class="modal-hdr">
              <div class="modal-title">Photo Gallery</div>
              <button class="modal-close" @click="closeExpanded">✕</button>
            </div>

            <div class="gallery-expanded-stage">
              <button
                v-if="safePhotos.length > 1"
                class="gallery-nav gallery-nav-left"
                @click="prevExpanded"
                title="Previous photo"
              >‹</button>

              <figure class="gallery-expanded-photo">
                <div class="gallery-expanded-media-shell">
                  <img
                    v-if="expandedPhoto.dataUrl || (expandedPhoto.url && expandedPhoto.url.startsWith('data:'))"
                    :src="expandedPhoto.dataUrl || expandedPhoto.url"
                    alt=""
                  >
                  <graffiti-get-media
                    v-if="expandedPhoto.url"
                    v-slot="{ media }"
                    :url="expandedPhoto.url"
                    :accept="{ types: ['image/*'] }"
                  >
                    <img v-if="media?.dataUrl" :src="media.dataUrl" alt="">
                    <div v-else class="gallery-media-loading">Loading...</div>
                  </graffiti-get-media>
                </div>
                <figcaption v-if="expandedPhoto.caption">{{ expandedPhoto.caption }}</figcaption>
              </figure>

              <button
                v-if="safePhotos.length > 1"
                class="gallery-nav gallery-nav-right"
                @click="nextExpanded"
                title="Next photo"
              >›</button>
            </div>

            <div v-if="safePhotos.length > 1" class="gallery-progress" aria-live="polite">
              Viewing {{ expandedPhotoNumber }} out of {{ photoCount }}
            </div>
          </div>
        </div>
      </Teleport>
    </section>
  `,
};
