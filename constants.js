// Shared channel for profile discovery
export const HACKMATCH_CHANNEL = "hackmatch-26";

export const TRACKS = [
  "Fintech",
  "Sustainability",
  "Healthcare",
  "Education",
  "Interactive Media",
  "Applied AI",
];

export const FIELDS_OF_INTEREST = [
  "Systems",
  "Hardware",
  "AR/VR",
  "Game Dev",
  "Game Design",
  "Music",
  "HCI",
  "ML/AI",
  "Research",
  "UI/UX",
  "Web Dev",
  "Mobile Dev",
  "Data Science",
  "Cybersecurity",
  "Robotics",
  "Computer Vision",
  "NLP",
  "Embedded Systems",
  "Bioinformatics",
  "Blockchain",
];

export const YEARS = ["First-Year", "Sophomore", "Junior", "Senior"];

export const SCHOOLS = [
  // Boston / MIT area
  "Massachusetts Institute of Technology (MIT)",
  "Harvard University",
  "Boston University",
  "Northeastern University",
  "Boston College",
  "Tufts University",
  "Wellesley College",
  "Brandeis University",
  "Babson College",
  "Bentley University",
  "Emerson College",
  "Simmons University",
  "Suffolk University",
  "UMass Amherst",
  "UMass Boston",
  "UMass Lowell",
  // Ivy League
  "Yale University",
  "Princeton University",
  "Columbia University",
  "University of Pennsylvania",
  "Cornell University",
  "Brown University",
  "Dartmouth College",
  // Top tech / engineering
  "Stanford University",
  "Caltech",
  "Carnegie Mellon University",
  "Georgia Institute of Technology",
  "University of Michigan",
  "University of Illinois Urbana-Champaign",
  "Purdue University",
  "Rose-Hulman Institute of Technology",
  "Worcester Polytechnic Institute",
  "Rensselaer Polytechnic Institute",
  "Stevens Institute of Technology",
  "Cooper Union",
  "Harvey Mudd College",
  // UCs
  "UC Berkeley",
  "UCLA",
  "UC San Diego",
  "UC Santa Barbara",
  "UC Irvine",
  "UC Davis",
  "UC Santa Cruz",
  "UC Riverside",
  "UC Merced",
  // Other major state schools
  "University of Texas at Austin",
  "University of Washington",
  "University of Wisconsin-Madison",
  "University of Minnesota",
  "Ohio State University",
  "Penn State University",
  "Rutgers University",
  "University of Maryland",
  "University of Virginia",
  "University of North Carolina",
  "North Carolina State University",
  "University of Florida",
  "Florida State University",
  "University of Georgia",
  "Georgia State University",
  "University of Colorado Boulder",
  "University of Arizona",
  "Arizona State University",
  "University of Utah",
  "University of Oregon",
  "Oregon State University",
  "University of Iowa",
  "Iowa State University",
  "Indiana University",
  "Michigan State University",
  "University of Pittsburgh",
  "University of Cincinnati",
  "University of South Carolina",
  "University of Tennessee",
  "University of Alabama",
  "Auburn University",
  "Virginia Tech",
  "University of Connecticut",
  "University of New Hampshire",
  "University of Vermont",
  "University of Rhode Island",
  "University of Maine",
  // New York
  "New York University",
  "Fordham University",
  "Stony Brook University",
  "University at Buffalo",
  "CUNY",
  "Binghamton University",
  // Liberal arts
  "Amherst College",
  "Williams College",
  "Swarthmore College",
  "Bowdoin College",
  "Middlebury College",
  "Colby College",
  "Bates College",
  "Colgate University",
  "Hamilton College",
  "Vassar College",
  "Oberlin College",
  "Grinnell College",
  "Carleton College",
  "Macalester College",
  "Reed College",
  "Smith College",
  "Mount Holyoke College",
  "Bryn Mawr College",
  "Trinity College",
  "Connecticut College",
  "Haverford College",
  // Other well-known universities
  "Duke University",
  "Northwestern University",
  "Vanderbilt University",
  "Rice University",
  "Washington University in St. Louis",
  "Emory University",
  "Georgetown University",
  "Notre Dame",
  "Wake Forest University",
  "Tulane University",
  "Case Western Reserve University",
  "Lehigh University",
  "Boston University",
  "Drexel University",
  "Temple University",
  "American University",
  "George Washington University",
  "George Mason University",
  "Johns Hopkins University",
  "University of Rochester",
  "Syracuse University",
  "Rochester Institute of Technology",
  "Clarkson University",
  "Villanova University",
  "James Madison University",
  "William & Mary",
  "University of Richmond",
  "Davidson College",
  "Furman University",
  "University of Miami",
  "Florida International University",
  "UCF",
  "University of Houston",
  "Texas A&M University",
  "UT Dallas",
  "Southern Methodist University",
  "Baylor University",
  "TCU",
  "University of Denver",
  "Colorado State University",
  "Gonzaga University",
  "University of San Diego",
  "Santa Clara University",
  "University of San Francisco",
  "Loyola Marymount University",
  "Pepperdine University",
  "Chapman University",
  "UC Hastings",
  "San Jose State University",
  "Cal Poly San Luis Obispo",
  "Cal Poly Pomona",
  "San Francisco State University",
  "Cal State Long Beach",
  "University of Southern California",
  "Occidental College",
  "Scripps College",
  "Pomona College",
  "Claremont McKenna College",
  "Pitzer College",
  // International (common for US hackathons)
  "University of Toronto",
  "McGill University",
  "University of British Columbia",
  "University of Waterloo",
  "University of Edinburgh",
  "University of Oxford",
  "University of Cambridge",
  "Imperial College London",
  "ETH Zurich",
  "Other",
].sort((a, b) => {
  if (a === "MIT") return -1;
  if (b === "MIT") return 1;
  if (a === "Other") return 1;
  if (b === "Other") return -1;
  return a.localeCompare(b);
});

export const PROFILE_QUESTIONS = [
  "What do you want to get out of the hackathon?",
  "What kind of project do you want to build?",
  "What skills would you bring to a team?",
];

// JSON Schema used by useGraffitiDiscover to filter profile objects
export const PROFILE_SCHEMA = {
  properties: {
    value: {
      required: [
        "activity",
        "name",
        "school",
        "year",
        "major",
        "tracks",
        "answers",
        "status",
        "describes",
        "published",
      ],
      properties: {
        activity: { const: "Profile" },
        name: { type: "object" },
        pronouns: { type: "string" },
        school: { type: "string" },
        year: { type: "string" },
        major: { type: "string" },
        tracks: { type: "array" },
        answers: { type: "object" },
        status: { type: "string" },
        confirmedTeammates: { type: "array" },
        fieldsOfInterest: { type: "array" },
        describes: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

// JSON Schema for teammate invite objects
export const TEAM_INVITE_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "from", "to", "published"],
      properties: {
        activity: { const: "TeamInvite" },
        from: { type: "string" },
        to: { type: "string" },
        fromTeam: { type: "array" },
        autoConfirmedBy: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

// JSON Schema for teammate decline/removal notifications
export const TEAM_DECLINE_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "from", "to", "published"],
      properties: {
        activity: { const: "TeamDecline" },
        from: { type: "string" },
        to: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

// JSON Schema for conversation creation objects
export const CONVERSATION_SCHEMA = {
  properties: {
    value: {
      required: ["activity", "type", "channel", "participants", "published"],
      properties: {
        activity: { const: "Create" },
        type: { const: "Conversation" },
        channel: { type: "string" },
        participants: { type: "array" },
        participantKey: { type: "string" },
        published: { type: "number" },
      },
    },
  },
};

// JSON Schema for message objects
export const MESSAGE_SCHEMA = {
  properties: {
    value: {
      required: ["content", "published"],
      properties: {
        content: { type: "string" },
        published: { type: "number" },
        channel: { type: "string" },
        attachment: { type: "object" },
        // optional: inReplyTo: { actorId, questionText, answerText }
      },
    },
  },
};

export function conversationPairKey(actorA, actorB) {
  return [actorA, actorB].sort().join("::");
}

export function conversationParticipantKey(participants = []) {
  return [...new Set(participants)].sort().join("::");
}

export function conversationParticipants(myActor, targetActor, teammates = []) {
  return conversationParticipantKey([myActor, targetActor, ...teammates])
    .split("::")
    .filter(Boolean);
}

export function conversationChannel(actorA, actorB) {
  return `hackmatch-conv:${[actorA, actorB].sort().map(encodeURIComponent).join(":")}`;
}

// Avatar gradient palette (seeded by actor ID)
export const GRADIENTS = [
  "linear-gradient(135deg,#7C3AED,#DB2777)",
  "linear-gradient(135deg,#2563EB,#7C3AED)",
  "linear-gradient(135deg,#059669,#2563EB)",
  "linear-gradient(135deg,#D97706,#DC2626)",
  "linear-gradient(135deg,#BE185D,#7C3AED)",
  "linear-gradient(135deg,#0891B2,#059669)",
];

export function avatarGradient(str = "") {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % GRADIENTS.length;
  return GRADIENTS[Math.abs(h)];
}

export function initials(profile) {
  if (!profile) return "?";
  const { name } = profile.value;
  return ((name?.first?.[0] ?? "?") + (name?.last?.[0] ?? "")).toUpperCase();
}

// Track tag colour classes (cycles through 10 distinct pastel combos)
export const TRACK_COLORS = [
  "bg-violet  c-violet",
  "bg-pink    c-pink",
  "bg-green   c-green",
  "bg-amber   c-amber",
  "bg-blue    c-blue",
  "bg-red     c-red",
  "bg-gray    c-gray",
  "bg-teal    c-teal",
  "bg-orange  c-orange",
  "bg-lime    c-lime",
];
export function trackColor(trackName) {
  const idx = TRACKS.indexOf(trackName);
  return TRACK_COLORS[(idx >= 0 ? idx : 0) % TRACK_COLORS.length];
}

export function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  if (now - d < 7 * 24 * 60 * 60 * 1000)
    return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
