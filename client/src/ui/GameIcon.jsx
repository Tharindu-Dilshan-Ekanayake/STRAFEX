import { u } from './format'

/**
 * Smooth vector icons for the buttons (drawn here, no icon font): white shapes with a
 * soft dark outline and shadow, so they read on any button colour.
 */

const SHAPES = {
  gear: (
    <g>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="10.4" y="1.6" width="3.2" height="5" rx="1" transform={`rotate(${i * 45} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="7.2" />
      <circle cx="12" cy="12" r="2.8" fill="rgba(30,20,60,0.85)" stroke="none" />
    </g>
  ),
  sword: (
    <g>
      <path d="M19.8 2.5 L21.5 4.2 L10.5 15.2 L8.8 13.5 Z" />
      <path d="M6.2 13.2 L10.8 17.8 L9.6 19 L5 14.4 Z" />
      <path d="M7.4 17.4 L4.2 20.6 Q3.3 21.5 2.6 20.8 Q2 20.1 2.9 19.3 L6.1 16.1 Z" />
    </g>
  ),
  pick: (
    <g>
      <path d="M3.5 9.5 Q11 2 20.5 6.5 Q13.5 5.5 9.2 10.8 Z" />
      <path d="M8.6 10.2 L10.8 12.4 L4.3 20.8 Q3.4 21.7 2.7 21 Q2 20.3 2.9 19.4 Z" />
    </g>
  ),
  cube: (
    <g>
      <path d="M12 2.5 L21 7.2 L12 11.9 L3 7.2 Z" />
      <path d="M3 8.6 L11.2 13 L11.2 21.8 L3 17.3 Z" fill="rgba(255,255,255,0.78)" />
      <path d="M21 8.6 L12.8 13 L12.8 21.8 L21 17.3 Z" fill="rgba(255,255,255,0.6)" />
    </g>
  ),
  apple: (
    <g>
      <path d="M12 7.5 Q8 4.8 5.2 7.6 Q2.4 11 4.6 16 Q7 21.5 10 20.6 Q12 20 14 20.6 Q17 21.5 19.4 16 Q21.6 11 18.8 7.6 Q16 4.8 12 7.5 Z" />
      <path d="M12 7 Q12.4 3.6 14.6 2.4" fill="none" strokeWidth="1.6" />
      <path d="M13.2 5 Q16.5 2.2 19 3.6 Q16.8 6.6 13.2 5 Z" />
    </g>
  ),
  potion: (
    <g>
      <rect x="9.3" y="2" width="5.4" height="2.6" rx="1" />
      <path d="M10 4.6 L14 4.6 L14 8.6 Q19.5 10.6 19.5 15.4 Q19.5 21.5 12 21.5 Q4.5 21.5 4.5 15.4 Q4.5 10.6 10 8.6 Z" />
      <path d="M6.2 15 Q12 13 17.8 15 Q17.6 19.8 12 19.8 Q6.4 19.8 6.2 15 Z" fill="rgba(255,120,200,0.9)" stroke="none" />
    </g>
  ),
  ball: (
    <g>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9" cy="9" r="2.4" fill="rgba(200,230,255,0.9)" stroke="none" />
    </g>
  ),
  bow: (
    <g>
      <path d="M5 3 Q20 6 21 19 L18.6 19 Q17.6 8.6 5 5.4 Z" />
      <path d="M5 4.2 L19.8 19" fill="none" strokeWidth="1.4" />
      <path d="M9 13 L17 5 M17 5 L13.8 5.4 M17 5 L16.6 8.2" fill="none" strokeWidth="1.8" />
    </g>
  ),
  up: <path d="M12 3 L21 13 L15.5 13 L15.5 21 L8.5 21 L8.5 13 L3 13 Z" />,
  // Lobby menu.
  bag: (
    <g>
      <path d="M8.5 8 L8.5 6 Q8.5 2.6 12 2.6 Q15.5 2.6 15.5 6 L15.5 8" fill="none" strokeWidth="1.8" />
      <path d="M4.5 7.6 L19.5 7.6 L20.8 20.4 Q20.9 21.6 19.7 21.6 L4.3 21.6 Q3.1 21.6 3.2 20.4 Z" />
      <circle cx="8.5" cy="11" r="1.1" fill="rgba(30,20,60,0.55)" stroke="none" />
      <circle cx="15.5" cy="11" r="1.1" fill="rgba(30,20,60,0.55)" stroke="none" />
    </g>
  ),
  chest: (
    <g>
      <path d="M3 10 Q3 4 12 4 Q21 4 21 10 Z" />
      <rect x="3" y="10" width="18" height="10.5" rx="1.4" />
      <path d="M3 10.6 L21 10.6" fill="none" strokeWidth="1.2" />
      <rect x="10" y="8.6" width="4" height="5.2" rx="1" fill="#ffd23b" />
    </g>
  ),
  backpack: (
    <g>
      <path d="M9 5 Q9 2.5 12 2.5 Q15 2.5 15 5" fill="none" strokeWidth="1.8" />
      <path d="M5 9.5 Q5 4.6 12 4.6 Q19 4.6 19 9.5 L19 19.6 Q19 21.5 17 21.5 L7 21.5 Q5 21.5 5 19.6 Z" />
      <rect x="7.8" y="12.6" width="8.4" height="6" rx="1.4" fill="rgba(255,255,255,0.7)" />
      <path d="M7.8 14.8 L16.2 14.8" fill="none" strokeWidth="1" />
    </g>
  ),
  gift: (
    <g>
      <rect x="3.2" y="8.4" width="17.6" height="4.4" rx="1" />
      <rect x="4.6" y="12.8" width="14.8" height="8.6" rx="1" />
      <rect x="10.6" y="8.4" width="2.8" height="13" fill="#ff5a6e" stroke="none" />
      <path d="M12 8.4 Q7.4 2.4 5.8 5.4 Q5 7.8 12 8.4 Q19 7.8 18.2 5.4 Q16.6 2.4 12 8.4 Z" />
    </g>
  ),
  scroll: (
    <g>
      <path d="M6 3.5 L17.5 3.5 Q19.5 3.5 19.5 5.5 L19.5 18 Q19.5 20.5 17 20.5 L6.5 20.5 Q4.5 20.5 4.5 18.5 L4.5 5 Q4.5 3.5 6 3.5 Z" />
      <path d="M8 8 L16 8 M8 11.5 L16 11.5 M8 15 L13 15" fill="none" stroke="rgba(30,20,60,0.55)" strokeWidth="1.6" />
      <path d="M16.6 13.6 L17.5 15.5 L19.6 15.8 L18.1 17.2 L18.5 19.3 L16.6 18.3 L14.7 19.3 L15.1 17.2 L13.6 15.8 L15.7 15.5 Z" fill="#ffd23b" />
    </g>
  ),
  trophy: (
    <g>
      <path d="M7 3 L17 3 L17 9 Q17 14.5 12 14.5 Q7 14.5 7 9 Z" />
      <path d="M7 5 Q3 5 3.6 8.6 Q4.4 11.6 7.6 11.8 M17 5 Q21 5 20.4 8.6 Q19.6 11.6 16.4 11.8" fill="none" strokeWidth="1.8" />
      <rect x="10.6" y="14.2" width="2.8" height="3.6" />
      <rect x="7" y="17.6" width="10" height="3.6" rx="1" />
    </g>
  ),
  moon: (
    <g>
      <path d="M15.5 3 Q8 3.5 7.4 11.6 Q7.4 19.6 15.6 21 Q8 22.6 4.2 16.6 Q1.2 10.2 6 5.6 Q10 2.2 15.5 3 Z" />
      <path d="M15 7 L19 7 L15 11.5 L19 11.5" fill="none" strokeWidth="1.6" />
    </g>
  ),
  down: (
    <g>
      <path d="M4 5 L12 12 L20 5 L20 9 L12 16 L4 9 Z" />
      <path d="M4 12 L12 19 L20 12 L20 15.5 L12 22 L4 15.5 Z" fill="rgba(255,255,255,0.7)" />
    </g>
  ),
  eye: (
    <g>
      <path d="M1.8 12 Q12 2 22.2 12 Q12 22 1.8 12 Z" />
      <circle cx="12" cy="12" r="4" fill="rgba(30,20,60,0.85)" stroke="none" />
      <circle cx="13.4" cy="10.6" r="1.3" fill="#fff" stroke="none" />
    </g>
  ),
}

export default function GameIcon({ name, size = 30, color = '#ffffff' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: u(size), height: u(size), filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.45))', overflow: 'visible' }}
      fill={color}
      stroke="rgba(20,12,40,0.75)"
      strokeWidth="1.1"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {SHAPES[name] || SHAPES.cube}
    </svg>
  )
}
