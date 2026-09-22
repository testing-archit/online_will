import { Font } from '@react-pdf/renderer'
import figtreeBold from '../assets/fonts/Figtree-Bold.ttf'
import figtreeMedium from '../assets/fonts/Figtree-Medium.ttf'
import figtreeRegular from '../assets/fonts/Figtree-Regular.ttf'
import figtreeSemiBold from '../assets/fonts/Figtree-SemiBold.ttf'
import lexendBold from '../assets/fonts/Lexend-Bold.ttf'
import lexendMedium from '../assets/fonts/Lexend-Medium.ttf'
import lexendSemiBold from '../assets/fonts/Lexend-SemiBold.ttf'

let registered = false

export function registerPdfFonts() {
  if (registered) return
  registered = true

  Font.register({
    family: 'Figtree',
    fonts: [
      { src: figtreeRegular, fontWeight: 400 },
      { src: figtreeMedium, fontWeight: 500 },
      { src: figtreeSemiBold, fontWeight: 600 },
      { src: figtreeBold, fontWeight: 700 },
    ],
  })

  Font.register({
    family: 'Lexend',
    fonts: [
      { src: lexendMedium, fontWeight: 500 },
      { src: lexendSemiBold, fontWeight: 600 },
      { src: lexendBold, fontWeight: 700 },
    ],
  })

  Font.registerHyphenationCallback((word) => [word])
}
