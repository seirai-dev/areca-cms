import { motion, useReducedMotion } from 'motion/react'
import { frond } from './frond'

// Three areca fronds arching in from the lower right. They draw themselves
// once on load (the page's one orchestrated moment), then sway very slightly.
const FRONDS = [
  frond({
    base: { x: 560, y: 680 },
    control: { x: 300, y: 430 },
    tip: { x: 90, y: 150 },
    leaflets: 19,
    maxLength: 175,
    spread: 30,
    droop: 0.85,
  }),
  frond({
    base: { x: 600, y: 680 },
    control: { x: 540, y: 300 },
    tip: { x: 330, y: 30 },
    leaflets: 17,
    maxLength: 150,
    spread: 26,
    droop: 0.9,
  }),
  frond({
    base: { x: 640, y: 680 },
    control: { x: 470, y: 560 },
    tip: { x: 40, y: 470 },
    leaflets: 15,
    maxLength: 130,
    spread: 34,
    droop: 0.9,
  }),
]

const SWAY = [
  { rotate: [0, 1.4, 0], duration: 9 },
  { rotate: [0, -1.1, 0], duration: 11 },
  { rotate: [0, 0.9, 0], duration: 13 },
]

export function HeroFronds({ className }: { className?: string }) {
  const reduced = useReducedMotion() ?? false
  return (
    <svg
      viewBox="0 0 680 680"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      {FRONDS.map((f, i) => (
        <motion.g
          key={i}
          style={{ originX: `${[560, 600, 640][i]}px`, originY: '660px' }}
          animate={reduced ? undefined : { rotate: SWAY[i].rotate }}
          transition={
            reduced
              ? undefined
              : {
                  duration: SWAY[i].duration,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: 2.4,
                }
          }
          stroke="var(--frond)"
          strokeLinecap="round"
          opacity={i === 1 ? 1 : i === 0 ? 0.85 : 0.5}
        >
          <motion.path
            d={f.rachis}
            strokeWidth={2.2}
            initial={reduced ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{
              duration: 1.1,
              delay: 0.15 + i * 0.18,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
          {f.leaflets.map((l, j) => (
            <motion.path
              key={j}
              d={l.d}
              strokeWidth={1.3}
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{
                duration: 0.7,
                delay: 0.35 + i * 0.18 + l.t * 1.1,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          ))}
        </motion.g>
      ))}
    </svg>
  )
}
