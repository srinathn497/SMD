/**
 * Portal-based tooltip — renders in document.body so it is never clipped
 * by parent overflow:hidden. Detects viewport boundaries and flips above/below
 * automatically. Arrow always points at the horizontal centre of the trigger.
 *
 * Props:
 *   text     — string shown in the bubble
 *   wide     — use 288px instead of 224px (for long explanations)
 *   xwide    — use 360px for extra-long content (e.g. WF diagnostics with multiple lines)
 *   align    — 'center' (default) | 'left' | 'right'
 *              Affects initial horizontal anchor before viewport clamping.
 *   children — the trigger element
 */
import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// Matches tailwind.config.js custom palette
const C_BG     = '#090d15'   // dark-900
const C_BORDER = '#28334a'   // dark-600
const C_TEXT   = '#cbd5e1'   // slate-300

const MARGIN    = 10   // min px gap from viewport edge
const ARROW_SZ  = 6    // border-width of the arrow triangle
const ARROW_GAP = ARROW_SZ + 3  // vertical gap between trigger edge and bubble edge

export default function Tooltip({ text, children, wide = false, xwide = false, align = 'center', className = '' }) {
  const [pos, setPos] = useState(null)
  const triggerRef    = useRef(null)
  const BUBBLE_W      = xwide ? 360 : wide ? 288 : 224

  const show = useCallback(() => {
    if (!triggerRef.current) return
    const r  = triggerRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // ── Estimate bubble height from line count so we can pick the right side ──
    const lineCount       = (text || '').split('\n').length
    const estimatedH      = Math.min(lineCount * 19 + 24, vh * 0.7)  // cap at 70vh

    // ── Vertical: show above only if there's actually room above ─────────────
    const spaceAbove = r.top - ARROW_GAP - MARGIN
    const spaceBelow = vh - r.bottom - ARROW_GAP - MARGIN
    const showAbove  = spaceAbove >= estimatedH
      ? true                       // fits above → prefer above
      : spaceBelow >= estimatedH
      ? false                      // fits below → use below
      : spaceAbove > spaceBelow    // neither fits → pick side with more room

    // ── Horizontal: apply align prop, then clamp inside viewport ─────────────
    let left =
      align === 'left'  ? r.left :
      align === 'right' ? r.right - BUBBLE_W :
                          r.left + r.width / 2 - BUBBLE_W / 2
    left = Math.max(MARGIN, Math.min(left, vw - BUBBLE_W - MARGIN))

    // Arrow tip points at the horizontal centre of the trigger element
    const triggerMidX = r.left + r.width / 2
    const arrowLeft   = Math.max(
      ARROW_SZ + 4,
      Math.min(triggerMidX - left - ARROW_SZ, BUBBLE_W - ARROW_SZ * 2 - 4),
    )

    setPos({
      showAbove,
      bubbleY:   showAbove ? r.top - ARROW_GAP : r.bottom + ARROW_GAP,
      maxHeight: showAbove ? spaceAbove : spaceBelow,
      left,
      arrowLeft,
    })
  }, [align, BUBBLE_W, text])

  const hide = useCallback(() => setPos(null), [])

  return (
    <span
      ref={triggerRef}
      className={`inline-flex items-center ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}

      {pos && createPortal(
        <span
          style={{
            position:      'fixed',
            zIndex:        9999,
            width:         BUBBLE_W,
            left:          pos.left,
            pointerEvents: 'none',
            // Above: anchor bottom of bubble to bubbleY; Below: anchor top
            ...(pos.showAbove
              ? { top: pos.bubbleY, transform: 'translateY(-100%)' }
              : { top: pos.bubbleY }),
            maxHeight:    pos.maxHeight,
            overflowY:    'auto',
            background:   C_BG,
            border:       `1px solid ${C_BORDER}`,
            color:        C_TEXT,
            fontSize:     12,
            lineHeight:   1.6,
            borderRadius: 8,
            padding:      '8px 12px',
            boxShadow:    '0 12px 30px rgba(0,0,0,0.6)',
            whiteSpace:   'pre-line',
            textAlign:    'left',
          }}
        >
          {text}

          {/* Caret — points toward the trigger */}
          <span
            style={{
              position:    'absolute',
              left:        pos.arrowLeft,
              width:       0,
              height:      0,
              borderWidth: ARROW_SZ,
              borderStyle: 'solid',
              ...(pos.showAbove
                // Arrow at bottom of bubble, points down
                ? { top: '100%', borderColor: `${C_BORDER} transparent transparent transparent` }
                // Arrow at top of bubble, points up
                : { bottom: '100%', borderColor: `transparent transparent ${C_BORDER} transparent` }),
            }}
          />
        </span>,
        document.body,
      )}
    </span>
  )
}
