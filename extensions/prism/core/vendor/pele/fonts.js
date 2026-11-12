// The fonts pele's pictures are drawn with. build.sh copies each file from npm into fonts/, beside pele.js, so every
// machine draws the same picture and nothing depends on the fonts a system has installed.
//
// pele lays text out with a Helvetica width table, and Arimo has the same widths, so labels stay inside their boxes.
// Arimo covers Latin, Greek, Cyrillic, Vietnamese and Hebrew, and Noto Sans Arabic adds Arabic. Noto Sans TC adds
// Chinese, Japanese kana and symbols such as ✓, but it is 7 MB, and resvg copies every font it is given on every
// render, so a picture gets it only when its text has a character outside what the other two cover.

export const FAMILY = 'Arimo'

// `wide` marks the font a picture gets only when its text needs it.
export const SOURCES = [
  { file: 'Arimo_400Regular.ttf', from: '@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf' },
  { file: 'Arimo_700Bold.ttf', from: '@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf' },
  { file: 'Arimo_400Regular_Italic.ttf', from: '@expo-google-fonts/arimo/400Regular_Italic/Arimo_400Regular_Italic.ttf' },
  { file: 'Arimo_700Bold_Italic.ttf', from: '@expo-google-fonts/arimo/700Bold_Italic/Arimo_700Bold_Italic.ttf' },
  { file: 'NotoSansArabic_400Regular.ttf', from: '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf' },
  { file: 'NotoSansTC_400Regular.ttf', from: '@expo-google-fonts/noto-sans-tc/400Regular/NotoSansTC_400Regular.ttf', wide: true },
]

const BASE = SOURCES.filter(source => !source.wide).map(source => source.file)
const ALL = SOURCES.map(source => source.file)

// Latin with IPA and combining accents, Greek, Cyrillic, Hebrew, Arabic, Vietnamese, Greek Extended and general
// punctuation, which Arimo and Noto Sans Arabic cover whole. Arimo has only a few arrows, math signs and box lines, so
// text with any of those gets Noto Sans TC, which has them.
const COVERED = /^[\u0000-\u04ff\u0590-\u06ff\u0750-\u077f\u08a0-\u08ff\u1e00-\u1fff\u2000-\u206f]*$/u

export const fontsFor = text => (COVERED.test(text) ? BASE : ALL)
