// Per-frame source recipes — the art direction lives here.
//
// Each recipe row is one (source × theme) cluster. Every entry it produces
// inherits the row's `tagsBase`. The vet pass adds palette warmth as an
// extra tag automatically — so the row should describe THEME, not palette.
// Granular rows mean discoverable images: a "Cities at night" cluster
// contributes images tagged `night`/`lateNight`/`blueHour`, which the
// runtime curator can match against a 2 AM rain context cleanly.

export const RECIPES = {
  // -------------- HOME --------------
  // A travel board of the world's wonders — the natural (mountains, waterfalls,
  // aurora, deserts, fjords, reefs) and the manmade (landmarks, ancient ruins,
  // heritage cities, temples). Think a tasteful traveller's feed: exciting
  // places, but composed with sky/water so the clock keeps a quiet region to
  // sit on. The vet's lenient negative-space floor lets these through; the
  // runtime's negSpace ranking + a small wonder/travel boost surface the airy,
  // legible ones first.
  home: {
    target: 100,
    sources: [
      // ── CLEAR & SUNNY WONDERS (Day / Morning / Summer / Spring) ──
      // Wide-angle master shots of named real-world locations, stamped with
      // { place, country, tz } so the top-right live location clock always works.
      {
        type: "pexels",
        queries: [
          { q: "lake louise banff panorama", place: "Banff · Lake Louise", country: "Canada", tz: "America/Edmonton" },
          { q: "lofoten norway fjord landscape", place: "Lofoten", country: "Norway", tz: "Europe/Oslo" },
          { q: "dolomites mountain landscape italy", place: "Dolomites", country: "Italy", tz: "Europe/Rome" },
          { q: "lauterbrunnen valley switzerland", place: "Lauterbrunnen", country: "Switzerland", tz: "Europe/Zurich" },
          { q: "mount fuji lake kawaguchi", place: "Mount Fuji", country: "Japan", tz: "Asia/Tokyo" },
          { q: "yosemite valley landscape", place: "Yosemite", country: "United States", tz: "America/Los_Angeles" },
          { q: "milford sound new zealand", place: "Milford Sound", country: "New Zealand", tz: "Pacific/Auckland" },
          { q: "zhangjiajie mountains china", place: "Zhangjiajie", country: "China", tz: "Asia/Shanghai" },
          { q: "isle of skye scotland landscape", place: "Isle of Skye", country: "United Kingdom", tz: "Europe/London" },
        ],
        perQuery: 8,
        tagsBase: ["expansive", "wild", "wonder", "travel", "hopeful", "clear-warm", "partly-cloudy", "day", "morning", "spring", "summer"],
        frames: ["home"],
      },
      {
        type: "wikimedia",
        searches: [
          { q: "lake louise banff panorama featured", place: "Banff · Lake Louise", country: "Canada", tz: "America/Edmonton" },
          { q: "geirangerfjord norway panorama featured", place: "Geirangerfjord", country: "Norway", tz: "Europe/Oslo" },
          { q: "dolomites italy landscape featured", place: "Dolomites", country: "Italy", tz: "Europe/Rome" },
          { q: "kotor bay montenegro panorama", place: "Kotor Bay", country: "Montenegro", tz: "Europe/Podgorica" },
        ],
        perSearch: 8,
        tagsBase: ["expansive", "wild", "wonder", "travel", "hopeful", "clear-warm", "partly-cloudy", "day", "morning", "spring", "summer"],
        frames: ["home"],
      },
      // ── GOLDEN HOUR, DUSK & WARM DESERTS (Golden / Dusk / Heat / Autumn) ──
      {
        type: "pexels",
        queries: [
          { q: "istanbul bosphorus skyline sunset", place: "Istanbul", country: "Türkiye", tz: "Europe/Istanbul" },
          { q: "cappadocia landscape sunrise", place: "Cappadocia", country: "Türkiye", tz: "Europe/Istanbul" },
          { q: "machu picchu peru mountains", place: "Machu Picchu", country: "Peru", tz: "America/Lima" },
          { q: "petra wadi rum jordan desert", place: "Petra", country: "Jordan", tz: "Asia/Amman" },
          { q: "taj mahal agra reflection", place: "Agra", country: "India", tz: "Asia/Kolkata" },
          { q: "kyoto pagoda sunset landscape", place: "Kyoto", country: "Japan", tz: "Asia/Tokyo" },
          { q: "grand canyon sunset panorama", place: "Grand Canyon", country: "United States", tz: "America/Phoenix" },
          { q: "cairo pyramids giza sunset", place: "Cairo", country: "Egypt", tz: "Africa/Cairo" },
          { q: "sahara merzouga dunes morocco", place: "Sahara · Merzouga", country: "Morocco", tz: "Africa/Casablanca" },
          { q: "budapest parliament danube dusk", place: "Budapest", country: "Hungary", tz: "Europe/Budapest" },
        ],
        perQuery: 7,
        tagsBase: ["expansive", "wonder", "travel", "heritage", "grounded", "clear-warm", "heat", "partly-cloudy", "golden", "dusk", "dawn", "autumn", "hopeful"],
        frames: ["home"],
      },
      {
        type: "wikimedia",
        searches: [
          { q: "istanbul bosphorus sunset featured", place: "Istanbul", country: "Türkiye", tz: "Europe/Istanbul" },
          { q: "machu picchu panorama featured", place: "Machu Picchu", country: "Peru", tz: "America/Lima" },
          { q: "toledo skyline panorama spain", place: "Toledo", country: "Spain", tz: "Europe/Madrid" },
          { q: "sossusvlei namib desert featured", place: "Namib Desert", country: "Namibia", tz: "Africa/Windhoek" },
        ],
        perSearch: 8,
        tagsBase: ["expansive", "wonder", "travel", "heritage", "grounded", "clear-warm", "heat", "partly-cloudy", "golden", "dusk", "dawn", "autumn"],
        frames: ["home"],
      },
      // ── SNOW, ALPINE & CRISP COLD (Snow / Clear-Cold / Winter) ──
      {
        type: "pexels",
        queries: [
          { q: "zermatt matterhorn switzerland snow", place: "Zermatt", country: "Switzerland", tz: "Europe/Zurich" },
          { q: "jokulsarlon glacier lagoon iceland", place: "Jökulsárlón", country: "Iceland", tz: "Atlantic/Reykjavik" },
          { q: "torres del paine patagonia peaks", place: "Patagonia", country: "Chile", tz: "America/Santiago" },
          { q: "chamonix mont blanc winter", place: "Chamonix", country: "France", tz: "Europe/Paris" },
          { q: "hallstatt austria winter lake", place: "Hallstatt", country: "Austria", tz: "Europe/Vienna" },
          { q: "high tatras slovakia snow peaks", place: "High Tatras", country: "Slovakia", tz: "Europe/Bratislava" },
        ],
        perQuery: 8,
        tagsBase: ["expansive", "wild", "wonder", "travel", "clear-cold", "snow-light", "snow-heavy", "winter", "day", "morning"],
        frames: ["home"],
      },
      // ── MIST, RAIN, OVERCAST & STORMS (Fog / Rain / Overcast / Thunderstorm) ──
      {
        type: "pexels",
        queries: [
          { q: "skogafoss reynisfjara iceland moody", place: "Vik · Reynisfjara", country: "Iceland", tz: "Atlantic/Reykjavik" },
          { q: "glencoe scottish highlands mist", place: "Scottish Highlands", country: "United Kingdom", tz: "Europe/London" },
          { q: "faroe islands dramatic cliffs fog", place: "Faroe Islands", country: "Denmark", tz: "Atlantic/Faroe" },
          { q: "guilin li river mist china", place: "Guilin", country: "China", tz: "Asia/Shanghai" },
          { q: "olympic national park moody coast", place: "Olympic Coast", country: "United States", tz: "America/Los_Angeles" },
          { q: "bergen fjord rain norway", place: "Bergen", country: "Norway", tz: "Europe/Oslo" },
        ],
        perQuery: 8,
        tagsBase: ["expansive", "wild", "wonder", "calm", "contemplative", "fog", "overcast", "drizzle", "rain-steady", "thunderstorm", "morning", "day", "dusk", "autumn"],
        frames: ["home"],
      },
      // ── NIGHT SKIES, AURORA & BLUE HOUR (Night / LateNight) ──
      {
        type: "pexels",
        queries: [
          { q: "tromso norway northern lights", place: "Tromsø", country: "Norway", tz: "Europe/Oslo" },
          { q: "iceland aurora borealis night", place: "Mývatn", country: "Iceland", tz: "Atlantic/Reykjavik" },
          { q: "lapland finland aurora night", place: "Lapland", country: "Finland", tz: "Europe/Helsinki" },
          { q: "tokyo bay rainbow bridge night", place: "Tokyo", country: "Japan", tz: "Asia/Tokyo" },
          { q: "victoria harbour hong kong night", place: "Hong Kong", country: "China", tz: "Asia/Hong_Kong" },
          { q: "atacama desert starry sky chile", place: "Atacama", country: "Chile", tz: "America/Santiago" },
        ],
        perQuery: 8,
        tagsBase: ["expansive", "wild", "wonder", "calm", "night", "lateNight", "dusk", "clear-warm", "clear-cold", "winter"],
        frames: ["home"],
      },
    ],
  },

  // -------------- PRAYER --------------
  // Sacred architecture in low light. Empty courtyards, muqarnas, mihrabs
  // at dusk. No figural content — vetting is set up to push busy faces
  // away from the quietSide where the countdown sits.
  prayer: {
    target: 60,
    sources: [
      // Mosque exteriors at twilight / golden hour
      {
        type: "wikimedia",
        categories: ["Featured pictures of mosques"],
        searches: ["mosque dawn featured", "courtyard mosque sunrise", "minaret silhouette dusk"],
        perCategory: 16,
        perSearch: 10,
        tagsBase: ["sacred", "reverent", "mosque", "contemplative", "dawn", "dusk", "golden", "hopeful"],
        frames: ["prayer", "quran", "quotes"],
      },
      // Mosque interiors — light filtering through stone
      {
        type: "wikimedia",
        categories: ["Mosque interiors", "Mihrabs", "Muqarnas"],
        searches: ["blue mosque interior", "alhambra arches light"],
        perCategory: 14,
        perSearch: 8,
        tagsBase: ["sacred", "reverent", "mosque", "contemplative", "morning", "interior"],
        frames: ["prayer", "quran", "quotes"],
      },
      // Broader Islamic architecture
      {
        type: "wikimedia",
        categories: ["Featured pictures of Islamic architecture", "Iwans"],
        perCategory: 10,
        tagsBase: ["sacred", "reverent", "mosque", "expansive"],
        frames: ["prayer", "quran", "quotes"],
      },
      // Met — Islamic Art (CC0): photographs and architectural studies
      {
        type: "met",
        queries: [
          { departmentId: 14, q: "mosque", medium: "Photographs" },
          { departmentId: 14, q: "mihrab" },
        ],
        perQuery: 30,
        tagsBase: ["sacred", "reverent", "mosque", "contemplative"],
        frames: ["prayer", "quran", "quotes"],
      },
      // Smithsonian (only fires when SMITHSONIAN_API_KEY is set)
      {
        type: "smithsonian",
        queries: ["mosque architecture", "islamic architecture"],
        perQuery: 25,
        tagsBase: ["sacred", "reverent", "mosque"],
        frames: ["prayer", "quran", "quotes"],
      },
    ],
  },

  // -------------- QURAN --------------
  // Manuscripts, calligraphy, geometry. Paintings of folios, blurred
  // ornament, tile work just out of focus. The Met has a gold mine here.
  quran: {
    target: 50,
    sources: [
      // Met — Quran folios and Islamic manuscripts (CC0)
      {
        type: "met",
        queries: [
          { departmentId: 14, q: "Qur'an" },
          { departmentId: 14, q: "calligraphy" },
          { departmentId: 14, q: "manuscript folio" },
        ],
        perQuery: 30,
        tagsBase: ["sacred", "reverent", "contemplative", "manuscript", "calligraphy", "warm"],
        frames: ["quran", "prayer", "quotes"],
      },
      // Wikimedia — calligraphy + geometric ornament
      {
        type: "wikimedia",
        categories: ["Featured pictures of Islamic calligraphy", "Quran manuscripts"],
        searches: ["kufic calligraphy folio", "ornamented quran page"],
        perCategory: 14,
        perSearch: 10,
        tagsBase: ["sacred", "reverent", "contemplative", "manuscript", "calligraphy"],
        frames: ["quran", "prayer", "quotes"],
      },
      {
        type: "wikimedia",
        categories: ["Geometric patterns in Islamic art", "Islamic ornament"],
        searches: ["islamic tile geometry", "muqarnas ceiling close"],
        perCategory: 12,
        perSearch: 10,
        tagsBase: ["sacred", "reverent", "contemplative", "geometry", "interior"],
        frames: ["quran", "prayer", "quotes"],
      },
    ],
  },

  // -------------- QUOTES --------------
  // Mood-resonant editorial. Each cluster pairs a mood with a visual
  // register so the runtime scoring can land cleanly on the quote tone.
  quotes: {
    target: 120,
    sources: [
      // hopeful — sunrises, dawn fields, new days
      {
        type: "wikimedia",
        categories: ["Featured pictures of sunrises", "Featured pictures of dawn"],
        searches: ["sunrise featured wide", "dawn light field", "first light over water"],
        perCategory: 12,
        perSearch: 10,
        tagsBase: ["hopeful", "dawn", "morning", "golden", "warm", "expansive"],
        frames: ["quotes", "prayer"],
      },
      {
        type: "met",
        queries: [{ q: "sunrise landscape", medium: "Paintings" }, { q: "Hudson River School" }],
        perQuery: 20,
        tagsBase: ["hopeful", "expansive", "golden", "warm", "morning"],
        frames: ["quotes"],
      },

      // resilient — mountains, storms, ancient stone
      {
        type: "wikimedia",
        categories: ["Featured pictures of mountain landscapes", "Featured pictures of storms"],
        searches: ["mountain ridge storm clearing", "ancient stone wide light", "cliffs at sunset"],
        perCategory: 14,
        perSearch: 10,
        tagsBase: ["resilient", "expansive", "wild", "dramatic", "dusk"],
        frames: ["quotes"],
      },
      {
        type: "met",
        queries: [
          { q: "storm landscape", medium: "Paintings" },
          { q: "Romantic landscape painting" },
        ],
        perQuery: 18,
        tagsBase: ["resilient", "expansive", "dramatic"],
        frames: ["quotes"],
      },

      // contemplative — mist, fog, quiet water
      {
        type: "wikimedia",
        categories: ["Featured pictures of mist", "Featured pictures of fog"],
        searches: ["misty lake dawn", "fog over forest", "still water reflection"],
        perCategory: 12,
        perSearch: 10,
        tagsBase: ["contemplative", "fog", "dawn", "morning", "cool", "rain-steady"],
        frames: ["quotes", "cal"],
      },
      {
        type: "rijksmuseum",
        queries: [{ q: "landscape", type: "painting" }, { q: "river", type: "painting" }],
        perQuery: 20,
        tagsBase: ["contemplative", "grounded", "rain-steady"],
        frames: ["quotes", "cal"],
      },
      {
        type: "met",
        queries: [{ q: "Vermeer" }, { q: "interior with window", medium: "Paintings" }, { q: "tonalist landscape" }],
        perQuery: 18,
        tagsBase: ["contemplative", "grounded", "interior", "morning"],
        frames: ["quotes", "cal"],
      },

      // expansive — wide vistas, horizons, Earth
      {
        type: "wikimedia",
        categories: ["Featured pictures of horizons", "Featured pictures of valleys"],
        searches: ["wide vista panorama", "endless horizon ocean", "valley sunrise wide"],
        perCategory: 12,
        perSearch: 10,
        tagsBase: ["expansive", "wild", "morning", "hopeful"],
        frames: ["quotes"],
      },

      // grounded — meadows, still life, warm interiors
      {
        type: "met",
        queries: [
          { q: "still life", medium: "Paintings" },
          { q: "Chardin" },
          { q: "Dutch Golden Age" },
        ],
        perQuery: 18,
        tagsBase: ["grounded", "interior", "warm", "morning"],
        frames: ["quotes", "cal"],
      },
      {
        type: "wikimedia",
        categories: ["Featured pictures of meadows", "Featured pictures of fields"],
        searches: ["golden field warm sky", "wheat field summer", "meadow at dusk"],
        perCategory: 10,
        perSearch: 8,
        tagsBase: ["grounded", "warm", "summer", "autumn", "dusk", "golden"],
        frames: ["quotes"],
      },

      // sacred — same well as prayer/quran, scaled smaller
      {
        type: "wikimedia",
        categories: ["Featured pictures of mosques", "Featured pictures of cathedrals"],
        searches: ["sacred architecture light", "stone vault interior light"],
        perCategory: 8,
        perSearch: 8,
        tagsBase: ["sacred", "reverent", "interior", "morning", "contemplative"],
        frames: ["quotes", "prayer", "quran"],
      },
    ],
  },

  // -------------- CAL --------------
  // Quiet productive interiors. Library shelves, reading rooms, study scenes.
  // Vermeer over IKEA every time.
  cal: {
    target: 50,
    sources: [
      {
        type: "wikimedia",
        categories: [
          "Featured pictures of libraries",
          "Featured pictures of reading rooms",
        ],
        searches: ["library interior light featured", "reading room daylight", "bookshelves warm interior"],
        perCategory: 14,
        perSearch: 10,
        tagsBase: ["grounded", "contemplative", "interior", "morning", "warm"],
        frames: ["cal", "quotes"],
      },
      {
        type: "wikimedia",
        categories: ["Featured pictures of interiors"],
        searches: ["studiolo desk window", "vermeer interior"],
        perCategory: 12,
        perSearch: 8,
        tagsBase: ["grounded", "contemplative", "interior", "morning"],
        frames: ["cal", "quotes"],
      },
      {
        type: "met",
        queries: [
          { q: "Vermeer" },
          { q: "library interior", medium: "Paintings" },
          { q: "reading", medium: "Paintings" },
          { q: "study interior" },
        ],
        perQuery: 14,
        tagsBase: ["grounded", "contemplative", "interior", "morning"],
        frames: ["cal", "quotes"],
      },
    ],
  },
};
