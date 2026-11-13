import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont as loadFigtree } from '@remotion/google-fonts/Figtree'
import { loadFont as loadOverpass } from '@remotion/google-fonts/Overpass'
import { Check, Gift, Lock, Repeat } from 'lucide-react'

const { fontFamily: FIGTREE } = loadFigtree('normal', { weights: ['400', '500', '600', '700', '800'] })
const { fontFamily: OVERPASS } = loadOverpass('normal', { weights: ['700', '800'] })

export const FPS = 30
// Scenes: the problem, the one-time set-up, the promise (it renews on its own), the brand.
const S1 = { from: 0, len: 90 }
const S2 = { from: 90, len: 195 }
const S3 = { from: 285, len: 165 }
const S4 = { from: 450, len: 90 }
export const TOTAL = S4.from + S4.len

const EU = '#1d4ea3'
const EU2 = '#2a66d1'
const INK = '#111111'
const GRADIENT = `linear-gradient(90deg, ${EU} 0%, ${EU2} 100%)`
const PLATE = 'AB-123-CD'

const ease = Easing.bezier(0.22, 1, 0.36, 1)

/** 0 → 1 over `len` frames from `start`, eased. */
function enter(frame: number, start: number, len = 18) {
  return interpolate(frame, [start, start + len], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
}

/** Rise and blur-in, the motion shared by every element. */
function rise(p: number, distance = 40): CSSProperties {
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)`, filter: `blur(${(1 - p) * 8}px)` }
}

function useLayout() {
  const { width, height } = useVideoConfig()
  const portrait = height > width
  const u = portrait ? width / 1080 : height / 1080 // 1 unit = 1px of a 1080-high (or wide) frame
  return { width, height, portrait, u }
}

/** Fade the whole scene in and out at its edges, so scenes cross-fade. */
function SceneFade({ len, children }: { len: number; children: ReactNode }) {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 10, len - 10, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

function Background() {
  const frame = useCurrentFrame()
  const drift = Math.sin(frame / 90) * 6
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at ${30 + drift}% 0%, #1d2a6b 0%, #0b1024 55%), #0b1024`,
      }}
    >
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 50% at ${85 - drift}% 100%, rgba(75,47,134,0.55) 0%, rgba(75,47,134,0) 70%)`,
        }}
      />
    </AbsoluteFill>
  )
}

/** Big white caption, line by line, with an optional quieter line under it. */
function Caption({ lines, sub, start = 0, align = 'left', accent }: { lines: string[]; sub?: string; start?: number; align?: 'left' | 'center'; accent?: number }) {
  const frame = useCurrentFrame()
  const { portrait, u } = useLayout()
  const size = (portrait ? 92 : 104) * u
  return (
    <div style={{ textAlign: align, fontFamily: FIGTREE }}>
      {lines.map((line, i) => (
        <div
          key={line}
          style={{
            ...rise(enter(frame, start + i * 7)),
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: '-0.035em',
            color: accent === i ? '#ff6b6b' : '#fff',
          }}
        >
          {line}
        </div>
      ))}
      {sub && (
        <div
          style={{
            ...rise(enter(frame, start + lines.length * 7 + 4)),
            marginTop: 26 * u,
            fontSize: (portrait ? 36 : 38) * u,
            fontWeight: 500,
            lineHeight: 1.3,
            color: 'rgba(255,255,255,0.68)',
            maxWidth: (portrait ? 900 : 760) * u,
            marginInline: align === 'center' ? 'auto' : undefined,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function Plate({ plate = PLATE, scale = 1 }: { plate?: string; scale?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: 34 * scale,
        overflow: 'hidden',
        borderRadius: 6 * scale,
        border: `${2.5 * scale}px solid ${INK}`,
        boxShadow: `0 ${2 * scale}px 0 ${INK}`,
        background: '#fff',
        fontFamily: OVERPASS,
        fontWeight: 800,
        fontSize: 19 * scale,
        letterSpacing: '0.06em',
        color: INK,
      }}
    >
      <span
        style={{
          width: 20 * scale,
          background: EU,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 2 * scale,
          fontSize: 10 * scale,
          fontWeight: 700,
        }}
      >
        <svg viewBox="0 0 20 20" width={13 * scale} height={13 * scale}>
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i / 12) * Math.PI * 2
            return <circle key={i} cx={10 + 7 * Math.cos(a)} cy={10 + 7 * Math.sin(a)} r="1.4" fill="#f2b705" />
          })}
        </svg>
        F
      </span>
      <span style={{ display: 'flex', alignItems: 'center', padding: `0 ${10 * scale}px`, paddingTop: 3 * scale }}>{plate}</span>
    </span>
  )
}

function Wordmark({ size, light }: { size: number; light?: boolean }) {
  return (
    <span style={{ fontFamily: FIGTREE, fontSize: size, fontWeight: 600, letterSpacing: '-0.03em', color: light ? '#fff' : INK }}>
      Pay
      <span
        style={{
          background: light ? 'linear-gradient(90deg, #6f9bff 0%, #9fc0ff 100%)' : GRADIENT,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        By
      </span>
      Bot
    </span>
  )
}

/** A phone: black bezel, the screen drawn at 390×800 and scaled to the frame. */
function Phone({ height, children, style }: { height: number; children: ReactNode; style?: CSSProperties }) {
  const scale = height / 844
  return (
    <div
      style={{
        width: 412 * scale,
        height,
        borderRadius: 64 * scale,
        background: '#05070f',
        padding: 11 * scale,
        boxShadow: `0 ${60 * scale}px ${120 * scale}px -${40 * scale}px rgba(0,0,0,0.75), inset 0 0 0 ${2 * scale}px #2b3350`,
        ...style,
      }}
    >
      <div style={{ width: 390, height: 822, transform: `scale(${scale})`, transformOrigin: 'top left', borderRadius: 54, overflow: 'hidden', position: 'relative', background: '#fff' }}>
        {children}
        <div style={{ position: 'absolute', top: 12, left: '50%', width: 118, height: 34, marginLeft: -59, borderRadius: 20, background: '#05070f' }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Scene 1: the problem

function ParkingNotice() {
  const frame = useCurrentFrame()
  const { u } = useLayout()
  const p = spring({ frame: frame - 14, fps: FPS, config: { damping: 14, stiffness: 110 } })
  const stamp = enter(frame, 34, 10)
  return (
    <div
      style={{
        width: 560 * u,
        padding: 40 * u,
        borderRadius: 18 * u,
        background: '#fbfaf6',
        boxShadow: `0 ${40 * u}px ${80 * u}px -${20 * u}px rgba(0,0,0,0.6)`,
        fontFamily: FIGTREE,
        color: INK,
        opacity: p,
        transform: `translateY(${(1 - p) * -220 * u}px) rotate(${-4 + (1 - p) * -10}deg)`,
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 20 * u, fontWeight: 700, letterSpacing: '0.18em', color: '#666' }}>AVIS DE PAIEMENT</div>
      <div style={{ marginTop: 10 * u, fontSize: 40 * u, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Forfait post-stationnement</div>
      <div style={{ marginTop: 28 * u, display: 'flex', alignItems: 'center', gap: 18 * u }}>
        <Plate scale={1.3 * u} />
        <span style={{ fontSize: 26 * u, color: '#555' }}>Paris 17e</span>
      </div>
      <div style={{ marginTop: 26 * u, height: 2 * u, background: 'repeating-linear-gradient(90deg,#ccc 0 10px,transparent 10px 18px)' }} />
      <div style={{ marginTop: 22 * u, display: 'flex', justifyContent: 'space-between', fontSize: 26 * u, color: '#555' }}>
        <span>Lundi, 9h04</span>
        <span>Forfait résident expiré</span>
      </div>
      <div
        style={{
          position: 'absolute',
          right: -26 * u,
          top: -26 * u,
          padding: `${12 * u}px ${22 * u}px`,
          borderRadius: 999,
          background: '#e5484d',
          color: '#fff',
          fontSize: 26 * u,
          fontWeight: 700,
          opacity: stamp,
          transform: `scale(${1.6 - 0.6 * stamp}) rotate(6deg)`,
        }}
      >
        Ticket expiré
      </div>
    </div>
  )
}

function Problem() {
  const { portrait, u } = useLayout()
  return (
    <SceneFade len={S1.len}>
      <AbsoluteFill
        style={{
          flexDirection: portrait ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: (portrait ? 110 : 150) * u,
          padding: 120 * u,
        }}
      >
        <Caption lines={['Lundi, 9h.', 'Forfait expiré.']} accent={1} align={portrait ? 'center' : 'left'} />
        <ParkingNotice />
      </AbsoluteFill>
    </SceneFade>
  )
}

// ---------------------------------------------------------------- Scene 2: the one-time set-up

function Ripple({ frame, at }: { frame: number; at: number }) {
  const r = interpolate(frame, [at, at + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <span
      style={{
        position: 'absolute', left: '50%', top: '50%', width: 420, height: 420, marginLeft: -210, marginTop: -210,
        borderRadius: '50%', background: 'rgba(255,255,255,0.35)', transform: `scale(${r})`, opacity: r > 0 ? 1 - r : 0,
      }}
    />
  )
}

function Field({ label, value, focused }: { label: string; value: string; focused: boolean }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(17,17,17,0.5)', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          height: 54, borderRadius: 14, border: `2px solid ${focused ? EU : 'rgba(17,17,17,0.14)'}`, padding: '0 16px',
          display: 'flex', alignItems: 'center', fontSize: 19, fontWeight: 500, letterSpacing: '0.02em',
          boxShadow: focused ? '0 0 0 4px rgba(29,78,163,0.12)' : 'none',
        }}
      >
        {value}
        {focused && <span style={{ width: 2, height: 24, marginLeft: 2, background: EU }} />}
      </div>
    </div>
  )
}

const LOGIN_TAP = 72
const RENEW_TAP = 142

/** Sign in to PayByBot with the PayByPhone account, then one tap on « Renouvellement automatique ». */
function SetUpScreen() {
  const frame = useCurrentFrame()
  const phone = '06 12 34 56 78'
  const typedPhone = phone.slice(0, Math.max(0, Math.min(phone.length, Math.floor((frame - 10) / 1.8))))
  const typedPass = '•'.repeat(Math.max(0, Math.min(10, Math.floor((frame - 42) / 2))))
  const loginPressed = interpolate(frame, [LOGIN_TAP - 4, LOGIN_TAP, LOGIN_TAP + 6], [1, 0.96, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const swap = enter(frame, LOGIN_TAP + 8, 16) // login slides away, home slides in
  const renewPressed = interpolate(frame, [RENEW_TAP - 4, RENEW_TAP, RENEW_TAP + 6], [1, 0.96, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const on = frame >= RENEW_TAP + 4
  const toast = spring({ frame: frame - (RENEW_TAP + 6), fps: FPS, config: { damping: 16 } })
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#fff', fontFamily: FIGTREE, color: INK, overflow: 'hidden' }}>
      {/* sign-in */}
      <div style={{ position: 'absolute', inset: 0, padding: '96px 26px 0', transform: `translateX(${-swap * 100}%)` }}>
        <Wordmark size={30} />
        <div style={{ marginTop: 34, fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Connexion</div>
        <div style={{ marginTop: 8, fontSize: 16, color: 'rgba(17,17,17,0.6)' }}>Avec votre compte PayByPhone.</div>
        <Field label="Numéro de téléphone" value={typedPhone} focused={frame < 40} />
        <Field label="Mot de passe" value={typedPass} focused={frame >= 40 && frame < LOGIN_TAP} />
        <div
          style={{
            marginTop: 26, height: 58, borderRadius: 16, background: GRADIENT, color: '#fff', fontSize: 19, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${loginPressed})`, position: 'relative', overflow: 'hidden',
          }}
        >
          Se connecter
          <Ripple frame={frame} at={LOGIN_TAP} />
        </div>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14, color: 'rgba(17,17,17,0.5)' }}>
          <Lock size={14} /> Mot de passe jamais enregistré
        </div>
      </div>
      {/* home: one button */}
      <div style={{ position: 'absolute', inset: 0, padding: '96px 26px 0', transform: `translateX(${(1 - swap) * 100}%)`, background: '#fff' }}>
        <Wordmark size={30} />
        <div style={{ marginTop: 34, fontSize: 17, color: 'rgba(17,17,17,0.55)' }}>Bonjour,</div>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Votre voiture</div>
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Plate />
          <span style={{ fontSize: 15, color: 'rgba(17,17,17,0.55)' }}>Paris 17e</span>
        </div>
        <div
          style={{
            marginTop: 34, padding: '26px 22px', borderRadius: 22, color: '#fff', position: 'relative', overflow: 'hidden',
            background: on ? 'linear-gradient(135deg,#15803d 0%,#22c55e 100%)' : `linear-gradient(135deg, ${EU} 0%, ${EU2} 100%)`,
            boxShadow: '0 24px 40px -18px rgba(29,78,163,0.7)', transform: `scale(${renewPressed})`,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {on ? 'Renouvellement activé' : 'Renouvellement automatique'}
          </div>
          <div style={{ marginTop: 4, fontSize: 16, opacity: 0.85 }}>{on ? 'Chaque semaine, tout seul.' : 'Forfait résident · 9,00 € / semaine'}</div>
          <Ripple frame={frame} at={RENEW_TAP} />
        </div>
        <div
          style={{
            ...rise(enter(frame, RENEW_TAP + 10), 14),
            marginTop: 18, padding: '16px 18px', borderRadius: 16, background: '#f2f3f5',
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 16,
          }}
        >
          <Repeat size={20} color={EU} />
          <span>
            <div style={{ fontWeight: 700 }}>Prochain renouvellement</div>
            <div style={{ color: 'rgba(17,17,17,0.6)' }}>Lundi 27 octobre, automatiquement</div>
          </span>
        </div>
      </div>
      {/* toast */}
      <div
        style={{
          position: 'absolute', left: 18, right: 18, top: 58, padding: '16px 18px', borderRadius: 18, background: '#fff',
          boxShadow: '0 18px 40px -12px rgba(0,0,0,0.35)', display: 'flex', gap: 12, alignItems: 'center',
          opacity: on ? toast : 0, transform: `translateY(${(1 - toast) * -90}px)`,
        }}
      >
        <span style={{ display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: '50%', background: '#16a34a', color: '#fff' }}>
          <Check size={20} strokeWidth={3} />
        </span>
        <span>
          <div style={{ fontSize: 16, fontWeight: 700 }}>C'est parti</div>
          <div style={{ fontSize: 14, color: 'rgba(17,17,17,0.6)' }}>On paie votre forfait à chaque échéance.</div>
        </span>
      </div>
    </div>
  )
}

function PhoneScene({ caption, sub, len, children }: { caption: string[]; sub?: string; len: number; children: ReactNode }) {
  const frame = useCurrentFrame()
  const { portrait, u, height } = useLayout()
  const p = spring({ frame: frame - 4, fps: FPS, config: { damping: 18, stiffness: 90 } })
  const float = Math.sin(frame / 40) * 6 * u
  const phoneHeight = portrait ? 880 * u : height * 0.84
  return (
    <SceneFade len={len}>
      <AbsoluteFill
        style={{
          flexDirection: portrait ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: portrait ? 'flex-start' : 'center',
          gap: (portrait ? 56 : 170) * u,
          padding: portrait ? `${92 * u}px ${70 * u}px 0` : `0 ${150 * u}px`,
        }}
      >
        <div style={{ flex: portrait ? undefined : '0 1 820px' }}>
          <Caption lines={caption} sub={sub} start={6} align={portrait ? 'center' : 'left'} />
        </div>
        <Phone
          height={phoneHeight}
          style={{ transform: `translateY(${(1 - p) * 260 * u + float}px) rotate(${(1 - p) * 4}deg)`, opacity: p, flexShrink: 0 }}
        >
          {children}
        </Phone>
      </AbsoluteFill>
    </SceneFade>
  )
}

// ---------------------------------------------------------------- Scene 3: it renews on its own

const RENEWALS = ['lundi 27 oct.', 'lundi 3 nov.', 'lundi 10 nov.', 'lundi 17 nov.']
const EVERY = 32 // frames between two renewals
const FIRST = 22

/** One renewal, like a notification: green check, « Forfait renouvelé », the date and price. */
function RenewalCard({ date }: { date: string }) {
  const { u } = useLayout()
  return (
    <div
      style={{
        width: 640 * u, padding: `${30 * u}px ${34 * u}px`, borderRadius: 30 * u, background: '#f7f8fa',
        display: 'flex', alignItems: 'center', gap: 26 * u, fontFamily: FIGTREE, color: INK,
        boxShadow: `0 ${30 * u}px ${60 * u}px -${24 * u}px rgba(0,0,0,0.65)`,
      }}
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 70 * u, height: 70 * u, flexShrink: 0, borderRadius: '50%', background: '#e3f5e9', color: '#16a34a' }}>
        <Check size={36 * u} strokeWidth={3} />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 36 * u, fontWeight: 700, letterSpacing: '-0.02em' }}>Forfait renouvelé</span>
          <span style={{ fontSize: 24 * u, color: 'rgba(17,17,17,0.45)' }}>PayByBot</span>
        </span>
        <span style={{ display: 'block', marginTop: 4 * u, fontSize: 30 * u, color: 'rgba(17,17,17,0.6)' }}>{date} · 9,00 €</span>
      </span>
    </div>
  )
}

/** The renewals pile up week after week: the newest in front, the older ones step back. */
function RenewalStack() {
  const frame = useCurrentFrame()
  const { u } = useLayout()
  const arrive = (i: number) => spring({ frame: frame - (FIRST + i * EVERY), fps: FPS, config: { damping: 16, stiffness: 120 } })
  return (
    <div style={{ position: 'relative', width: 640 * u, height: 420 * u }}>
      {RENEWALS.map((date, i) => {
        const p = arrive(i)
        if (p <= 0.001) return null
        const depth = RENEWALS.slice(i + 1).reduce((d, _, j) => d + arrive(i + 1 + j), 0) // how far back it went
        const opacity = Math.min(p, Math.max(0, 1 - depth * 0.38))
        return (
          <div
            key={date}
            style={{
              position: 'absolute', left: 0, top: 0, zIndex: 10 + i, opacity,
              transform: `translate(${depth * 46 * u}px, ${(depth * 128 - (1 - p) * 90) * u}px) scale(${1 - depth * 0.06})`,
              transformOrigin: 'left top',
              filter: `blur(${depth * 1.2}px)`,
            }}
          >
            <RenewalCard date={date} />
          </div>
        )
      })}
    </div>
  )
}

function Weekly() {
  const { portrait, u } = useLayout()
  return (
    <SceneFade len={S3.len}>
      <AbsoluteFill
        style={{
          flexDirection: portrait ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: (portrait ? 110 : 140) * u,
          padding: portrait ? `0 ${70 * u}px` : `0 ${150 * u}px`,
        }}
      >
        <div style={{ flex: portrait ? undefined : '0 1 820px' }}>
          <Caption
            lines={['Chaque semaine,', 'renouvelé', 'tout seul.']}
            start={6}
            align={portrait ? 'center' : 'left'}
          />
        </div>
        <RenewalStack />
      </AbsoluteFill>
    </SceneFade>
  )
}

// ---------------------------------------------------------------- Scene 4: the brand

function Chip({ icon, children, p }: { icon: ReactNode; children: ReactNode; p: number }) {
  const { u } = useLayout()
  return (
    <span
      style={{
        ...rise(p, 20),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12 * u,
        padding: `${16 * u}px ${26 * u}px`,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: '#fff',
        fontFamily: FIGTREE,
        fontSize: 32 * u,
        fontWeight: 600,
      }}
    >
      {icon}
      {children}
    </span>
  )
}

function Brand() {
  const frame = useCurrentFrame()
  const { portrait, u } = useLayout()
  const logo = spring({ frame: frame - 4, fps: FPS, config: { damping: 14 } })
  return (
    <SceneFade len={S4.len}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 80 * u }}>
        <div style={{ opacity: logo, transform: `scale(${0.85 + 0.15 * logo})` }}>
          <Wordmark size={(portrait ? 170 : 190) * u} light />
        </div>
        <div
          style={{
            ...rise(enter(frame, 14)),
            marginTop: 18 * u,
            fontFamily: FIGTREE,
            fontSize: (portrait ? 48 : 52) * u,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'rgba(255,255,255,0.85)',
            maxWidth: 1000 * u,
          }}
        >
          Votre forfait résident, renouvelé tout seul.
        </div>
        <div
          style={{
            marginTop: 54 * u,
            display: 'flex',
            flexDirection: portrait ? 'column' : 'row',
            alignItems: 'center',
            gap: 20 * u,
          }}
        >
          <Chip icon={<Lock size={30 * u} />} p={enter(frame, 26)}>
            Mot de passe jamais enregistré
          </Chip>
          <Chip icon={<Gift size={30 * u} />} p={enter(frame, 32)}>
            1 mois offert
          </Chip>
        </div>
        <div style={{ ...rise(enter(frame, 40)), marginTop: 46 * u, fontFamily: FIGTREE, fontSize: 30 * u, color: 'rgba(255,255,255,0.55)' }}>
          paybybot.fr
        </div>
      </AbsoluteFill>
    </SceneFade>
  )
}

// ---------------------------------------------------------------- The loop

export function Landing() {
  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={S1.from} durationInFrames={S1.len}>
        <Problem />
      </Sequence>
      <Sequence from={S2.from} durationInFrames={S2.len}>
        <PhoneScene caption={['Connectez-vous', 'en un clic', 'avec PayByPhone.']} len={S2.len}>
          <SetUpScreen />
        </PhoneScene>
      </Sequence>
      <Sequence from={S3.from} durationInFrames={S3.len}>
        <Weekly />
      </Sequence>
      <Sequence from={S4.from} durationInFrames={S4.len}>
        <Brand />
      </Sequence>
    </AbsoluteFill>
  )
}
