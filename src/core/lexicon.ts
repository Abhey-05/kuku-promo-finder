/**
 * Cue words, as plain data, so an editor can tune them without touching logic.
 * Each group has a regex source and a weight. Group scores combine as a noisy-OR,
 * so several weak cues add up but never pass 1.
 */
export interface CueGroup {
  group: string;
  pattern: string;
  weight: number;
}

/** What makes a scrolling viewer stop, checked in the first 3 seconds. */
export const HOOK_GROUPS: Record<'sfx' | 'action' | 'dialogue' | 'camera', CueGroup[]> = {
  sfx: [
    {
      group: 'impact sound',
      pattern:
        'slap|smash|scream|gasp|thunder|gunshot|crash|shatter|slam|boom|sting|bang|crack of|thud|crunch|impact|clang',
      weight: 0.5,
    },
  ],
  action: [
    {
      group: 'violence or reveal action',
      pattern:
        "slaps?|shatters?|collapses?|reveals?|points? a (?:gun|pistol|sword|knife|dagger)|storms? in|bursts? (?:in|through|open)|" +
        "kicks? (?:in|open)|lunges?|grabs?|seizes?|strikes?|punch(?:es)?|stabs?|shoves?|hurls?|throws?|smash(?:es)?|rips?|tears? (?:off|open|up)|" +
        "draws? (?:a|his|her) (?:sword|blade|knife|dagger|pistol|gun)|chokes?|chok(?:ing)|faints?|drags? (?:her|him|them)|pins? (?:her|him|them)|slams?|backhands?|spits?|snatch(?:es)?",
      weight: 0.5,
    },
  ],
  dialogue: [
    {
      group: 'reveal or conflict line',
      pattern:
        "dead|alive|pregnant|secret|liar|lied|betray(?:ed)?|divorce|fake|it's you|it was you|who are you|murder(?:ed|er)?|kill(?:ed)?|" +
        'poison(?:ed)?|traitor|disown(?:ed)?|execute[ds]?|hang(?:ed)?|arrest|whore|bastard|stolen|your own|the truth|never loved',
      weight: 0.4,
    },
    {
      group: 'humiliation line',
      pattern:
        'nothing|worthless|beneath|disgrace|shame|filth|beggar|pathetic|humiliat\\w*|abandon\\w*|ruined|cast (?:you|her|him) (?:out|aside)|on your knees|mine now|replace[ds]?',
      weight: 0.35,
    },
  ],
  camera: [
    { group: 'snap or crash camera move', pattern: 'snap[- ]zoom|crash[- ]zoom|whip[- ]pan|snap cut|smash cut', weight: 0.25 },
    { group: 'close-up opener', pattern: 'close-up', weight: 0.1 },
  ],
};

/** Exclamation or shouted-word cue on dialogue. */
export const SHOUT_WEIGHT = 0.3;

/** A cue at the 3-second mark counts this fraction of one on the first frame. */
export const HOOK_LATE_FACTOR = 0.5;
export const ALL_CAPS_WORD = /\b[A-Z]{3,}\b/;

/** What leaves the viewer needing more, checked in the last 5 seconds. */
export const CLIFF_GROUPS = {
  /** The script itself marks this beat as a cliffhanger. */
  marked: { group: 'scripted cliffhanger', pattern: 'cliffhanger', weight: 0.6 },
  sfx: { group: 'tension sound', pattern: 'sting(?:er)?|drone|swell|heartbeat|ominous', weight: 0.4 },
  /** Only counted when the last line is not a resolved one. */
  camera: {
    group: 'hard ending',
    pattern: 'freez(?:e|es|ing)|hard cut|smash cut|snap to black|cuts? to black|cutting to black',
    weight: 0.4,
  },
  threat: {
    group: 'threat or unfinished promise',
    pattern:
      "will regret|you'll pay|you will pay|i'll make|i will make|never|or else|i will (?:destroy|end|ruin|kill|burn)|i'll (?:destroy|end|ruin|kill|burn)|" +
      "you will (?:hang|burn|die|suffer|kneel|beg)|before (?:i|you|the)|until|won't stop",
    weight: 0.3,
  },
} satisfies Record<string, CueGroup>;

/** Weights for how the last spoken line ends. */
export const OPEN_LINE_WEIGHTS = { question: 0.3, trailing: 0.3 };

/** A sign the story has settled. Each hit is subtracted from the cliffhanger score. */
export const RESOLUTION = {
  dialogue: { group: 'resolved line', pattern: 'finally|forgive|together|agreed|happily|kiss|thank you|i love you', weight: -0.3 },
  tone: { group: 'warm ending', pattern: 'warm|gentle|tender|tenderly|peaceful|soft(?:ly)? fad|fading out|fades? out|embrace|kiss|unspoken bond|safely', weight: -0.3 },
} satisfies Record<string, CueGroup>;

/** A line that opens like this continues the one before, so a clip cannot start on it. */
export const CONTINUATION_START = /^["“]?\s*(?:\.\.\.|…|—|–|[a-z])/;

export const STANDALONE = {
  /** A first line that opens on a pronoun leaves a newcomer asking "who?". */
  pronounOpener: /^["“]?(He|She|They|That|This|It|Him|Her|Those|These)\b/,
  /** Reference to something the viewer did not see. */
  backReference:
    "what you did|what he did|what she did|that night|last night|as i said|remember|after everything|what happened|like before|that day|the other day|back then|once again|you promised",
  /** A word that sets up who these people are to each other. */
  stakes:
    'husband|wife|sister|brother|mother|father|son|daughter|fianc[eé]e?|bride|groom|marry|marriage|married|wedding|heir|baby|child|widow|family',
  /** Speakers named by job are self-explaining, so they need no introduction. */
  roles:
    'maid|guard|judge|priest|father|constable|officer|nurse|doctor|butler|housekeeper|servant|driver|thug|villager|townsman|informant|official|nobleman|noblewoman|woman|man|voice|crowd|guest|scout|fighter|soldier|lord|lady|mother|matriarch|elder|peasant|stranger|groom|bride',
  /** Titles dropped before comparing a speaker with the logline. */
  titles: /\b(LADY|LORD|SIR|MR|MRS|MISS|DUKE|DUCHESS|DOWAGER|THE|DR|FATHER|MOTHER|MASTER|MADAM)\b\.?/g,
};

export const STANDALONE_WEIGHTS = {
  base: 0.5,
  pronounOpener: -0.2,
  backReference: -0.1,
  unintroduced: -0.1,
  spokenName: 0.2,
  stakes: 0.15,
  fewSpeakers: 0.1,
  crowded: -0.1,
  /** Largest penalty, reached in the final episode of the set. */
  storyDepth: -0.3,
};
