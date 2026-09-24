import { Font } from '@react-pdf/renderer'

// Served from public/fonts as plain static files (react-pdf's Font.register src accepts a URL) rather than
// imported as JS modules -- avoids needing a Turbopack loader for raw .ttf binaries.
let registered = false

export function registerPdfFonts() {
  if (registered) return
  registered = true

  Font.register({
    family: 'Figtree',
    fonts: [
      { src: '/fonts/Figtree-Regular.ttf', fontWeight: 400 },
      { src: '/fonts/Figtree-Medium.ttf', fontWeight: 500 },
      { src: '/fonts/Figtree-SemiBold.ttf', fontWeight: 600 },
      { src: '/fonts/Figtree-Bold.ttf', fontWeight: 700 },
    ],
  })

  Font.register({
    family: 'Lexend',
    fonts: [
      { src: '/fonts/Lexend-Medium.ttf', fontWeight: 500 },
      { src: '/fonts/Lexend-SemiBold.ttf', fontWeight: 600 },
      { src: '/fonts/Lexend-Bold.ttf', fontWeight: 700 },
    ],
  })

  Font.registerHyphenationCallback((word) => [word])
}
