import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import octaraaLogo from '../assets/octaraa-logo.png'

// Loads only once the landing page itself has rendered, and never blocks it: the chat widget is a nice-to-have,
// not part of the first thing a visitor sees.
const CompanyAssistant = lazy(() => import('./CompanyAssistant').then((module) => ({ default: module.CompanyAssistant })))

interface DemoBeat {
  speech: string
  field: string
  value: string
}

// The actual mechanic the product is built on: what you say lands in the right field, live. This is what a
// visitor should see first, not generic marketing art.
const DEMO_SCRIPT: DemoBeat[] = [
  { speech: 'Everything goes to my wife, Meera.', field: 'Primary beneficiary', value: 'Meera Sharma — spouse' },
  { speech: 'My brother Arjun, as executor.', field: 'Executor', value: 'Arjun Sharma' },
  { speech: "If we're both gone, my sister raises the kids.", field: 'Guardian for minor children', value: 'Priya Sharma' },
  { speech: 'The Noida flat goes to my son.', field: 'Specific bequest', value: 'Noida flat → Rohan Sharma' },
]
const DEMO_FIELDS = DEMO_SCRIPT.map((beat) => beat.field)
const BEAT_MS = 3200

const STEPS = [
  { n: '01', title: 'Talk or type', body: 'Answer out loud or by typing, at your own pace — skip around, come back, nothing is lost.' },
  { n: '02', title: 'Watch it fill in', body: 'What you say becomes a field in your draft, live, the moment you say it.' },
  { n: '03', title: 'Legal review', body: 'A lawyer checks the draft against Indian succession law and flags what needs a decision.' },
  { n: '04', title: 'Sign & register', body: 'Download the final PDF, execute it with witnesses, and register it if your state requires it.' },
]

const LEGAL_FACTS = [
  { citation: 'Indian Succession Act, Section 63', fact: 'Two attesting witnesses are required. We check for this before you can submit a draft.' },
  { citation: 'Shariat, Islamic personal law', fact: 'A Muslim testator can generally bequeath at most one-third to non-heirs. We flag a draft that goes over.' },
  { citation: 'Uttarakhand Uniform Civil Code', fact: 'Registering your Will is compulsory there, and optional almost everywhere else. Your state decides which rules apply to you.' },
  { citation: 'Indian Succession Act, Section 67', fact: 'For Christian and Parsi testators, a witness who is also a beneficiary can void their own bequest. We catch that too.' },
]

function LiveDocumentMock() {
  const [index, setIndex] = useState(0)
  const [filled, setFilled] = useState<Record<string, string>>({ [DEMO_SCRIPT[0].field]: DEMO_SCRIPT[0].value })

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((previous) => {
        const next = (previous + 1) % DEMO_SCRIPT.length
        setFilled((previousFilled) => ({
          ...(next === 0 ? {} : previousFilled),
          [DEMO_SCRIPT[next].field]: DEMO_SCRIPT[next].value,
        }))
        return next
      })
    }, BEAT_MS)
    return () => clearInterval(timer)
  }, [])

  const beat = DEMO_SCRIPT[index]

  return (
    <div className="relative w-full max-w-sm">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-brand-secondary/25 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/50">
        <div className="flex items-center gap-2 bg-brand-primary-hover px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-brand-secondary" aria-hidden />
          <p className="text-xs font-medium text-white/85">Draft Will — Rohan Sharma</p>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Live
          </span>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="mb-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 italic"
          >
            &ldquo;{beat.speech}&rdquo;
          </motion.p>
          {DEMO_FIELDS.map((label) => {
            const isActive = label === beat.field
            const value = filled[label]
            return (
              <div key={isActive ? `${label}-${index}` : label} className={`flex items-center justify-between rounded-lg px-3 py-2 ${isActive ? 'live-flash bg-brand-secondary/10' : 'bg-slate-50'}`}>
                <span className="text-[11px] text-slate-400">{label}</span>
                <span className={`text-xs font-medium ${value ? 'text-brand-primary' : 'text-slate-300'}`}>{value ?? '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-porcelain">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <img src={octaraaLogo} alt="Octaraa" className="h-7 w-auto" />
        <nav className="flex items-center gap-5 text-sm font-medium text-slate-600">
          <Link to="/staff/login" className="hover:text-slate-900">
            Staff sign-in
          </Link>
          <Link to="/start" className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-hover">
            Start your Will
          </Link>
        </nav>
      </header>

      <section className="overflow-hidden bg-gradient-to-br from-brand-primary via-brand-primary to-brand-primary-hover">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h1 className="font-display text-4xl leading-tight font-medium tracking-tight text-white sm:text-5xl">Say what you want. It becomes your Will.</h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-white/75">
              Talk to Samaira in English, Hindi, Hinglish, or your own language — your draft fills in as you speak. A qualified lawyer reviews it before you sign.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3">
              <Link
                to="/start"
                className="flex items-center gap-2 rounded-xl bg-brand-secondary px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/20 transition hover:bg-brand-secondary-hover active:translate-y-px"
              >
                Start your Will for free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-xs text-white/50">No account needed to start — pick up exactly where you left off, on any device.</p>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <LiveDocumentMock />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-2xl text-slate-900">From conversation to registered Will</h2>
        <div className="relative mt-10 grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="absolute top-6 right-0 left-0 hidden h-px bg-slate-200 lg:block" aria-hidden />
          {STEPS.map((step) => (
            <div key={step.n} className="relative">
              <p className="relative z-10 inline-block bg-porcelain pr-3 font-display text-2xl text-brand-primary">{step.n}</p>
              <h3 className="mt-3 text-sm font-semibold text-slate-800">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-2xl text-slate-900">Built on the law, not just a template</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">A few of the rules already built into every draft — the kind of thing easy to miss when you're writing from scratch.</p>
          <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {LEGAL_FACTS.map((item) => (
              <div key={item.citation} className="border-l-2 border-brand-secondary/40 pl-4">
                <p className="text-xs font-medium text-brand-secondary-ink">{item.citation}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.fact}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Suspense fallback={null}>
        <CompanyAssistant />
      </Suspense>

      <footer className="border-t border-slate-200/80 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-xs text-slate-400 sm:flex-row">
          <p>&copy; {new Date().getFullYear()} Octaraa. All rights reserved.</p>
          <p className="max-w-xl text-center sm:text-right">Octaraa is a drafting platform, not a law firm. Your final Will is reviewed by a lawyer, but you should always confirm it against your own circumstances before execution.</p>
        </div>
      </footer>
    </div>
  )
}
