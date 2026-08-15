// Piece library for the inspector. Points are normalized (0..1) so they scale
// to any canvas size. Ported from this session's real work: dir-01/dir-02
// (pl-curves-gallery pieces-h2.js) and a handful of the VJ Coder test
// generations that rendered clean. Static tuning tool for now — no
// accumulation/drift animation, just direct parameter + control-point editing.

export const PIECES = [
  {
    id: 'dir-01', name: 'The Direction', ground: '#ffffff',
    ribbons: [
      { points: [{x:.22,y:-.06},{x:.34,y:.08},{x:.47,y:.18},{x:.58,y:.30},{x:.64,y:.45},{x:.64,y:.62},{x:.58,y:.80},{x:.50,y:.94},{x:.44,y:1.06}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
      { points: [{x:1.06,y:.00},{x:.84,y:.06},{x:.60,y:.13},{x:.42,y:.21},{x:.28,y:.32},{x:.17,y:.45},{x:.11,y:.60},{x:.10,y:.75},{x:.14,y:.90},{x:.19,y:1.06}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
      { points: [{x:-.06,y:.23},{x:.14,y:.25},{x:.32,y:.29},{x:.45,y:.37},{x:.52,y:.50},{x:.55,y:.65},{x:.58,y:.82},{x:.62,y:1.06}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
      { points: [{x:1.06,y:.28},{x:.88,y:.33},{x:.70,y:.41},{x:.54,y:.51},{x:.38,y:.62},{x:.24,y:.74},{x:.12,y:.87},{x:-.06,y:1.02}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
      { points: [{x:.54,y:1.06},{x:.50,y:.90},{x:.46,y:.74},{x:.44,y:.58},{x:.46,y:.42},{x:.52,y:.28},{x:.60,y:.15},{x:.70,y:-.06}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
      { points: [{x:-.06,y:.84},{x:.13,y:.80},{x:.32,y:.74},{x:.52,y:.68},{x:.72,y:.63},{x:.92,y:.60},{x:1.06,y:.58}], width: 0.085, taper: 0.055, tremor: 0, gap: 0.01, ink: '#5b54e6' },
    ],
  },
  {
    id: 'dir-02', name: 'The Direction, Denser', ground: '#080a14',
    ribbons: [
      { points: [{x:.24,y:-.06},{x:.32,y:.10},{x:.42,y:.24},{x:.50,y:.38},{x:.52,y:.54},{x:.50,y:.70},{x:.48,y:.86},{x:.46,y:1.06}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
      { points: [{x:.96,y:-.04},{x:.82,y:.08},{x:.64,y:.18},{x:.46,y:.28},{x:.30,y:.40},{x:.18,y:.54},{x:.10,y:.70},{x:.06,y:.90},{x:.10,y:1.06}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
      { points: [{x:-.06,y:.30},{x:.14,y:.32},{x:.34,y:.38},{x:.50,y:.48},{x:.62,y:.62},{x:.72,y:.78},{x:.86,y:.92},{x:1.06,y:1.02}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
      { points: [{x:1.06,y:.36},{x:.86,y:.42},{x:.66,y:.50},{x:.48,y:.60},{x:.32,y:.72},{x:.18,y:.86},{x:-.06,y:1.00}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
      { points: [{x:.56,y:1.06},{x:.52,y:.88},{x:.50,y:.70},{x:.50,y:.52},{x:.54,y:.36},{x:.62,y:.20},{x:.72,y:-.06}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
      { points: [{x:-.06,y:.90},{x:.16,y:.86},{x:.38,y:.80},{x:.60,y:.74},{x:.82,y:.68},{x:1.06,y:.64}], width: 0.11, taper: 0.055, tremor: 0, gap: 0.01, ink: '#2f3ea8', core: '#3fae6e' },
    ],
  },
  {
    id: 'vj-01', name: 'Whispers of Gold (VJ test 1)', ground: '#e8dfce',
    ribbons: [
      { points: [{x:.15,y:.20},{x:.40,y:.55},{x:.65,y:.30},{x:.85,y:.70}], width: 0.06, taper: 0.15, tremor: 0.03, gap: 0.008, ink: '#c9a84c' },
      { points: [{x:.75,y:.10},{x:.55,y:.45},{x:.30,y:.60},{x:.10,y:.90}], width: 0.02, taper: 0.15, tremor: 0.02, gap: 0.008, ink: '#c9a84c' },
    ],
  },
  {
    id: 'vj-04', name: 'Two-Scale Accumulation (VJ test 4)', ground: '#0e0c08',
    ribbons: [
      { points: [{x:.05,y:.90},{x:.20,y:.55},{x:.35,y:.75},{x:.50,y:.15}], width: 0.09, taper: 0.1, tremor: 0.025, gap: 0.01, ink: '#c9a84c' },
      { points: [{x:.65,y:.05},{x:.55,y:.40},{x:.75,y:.60},{x:.60,y:.85}], width: 0.09, taper: 0.1, tremor: 0.025, gap: 0.01, ink: '#c9a84c' },
      { points: [{x:.90,y:.95},{x:.70,y:.65},{x:.85,y:.35},{x:.40,y:.10}], width: 0.09, taper: 0.1, tremor: 0.025, gap: 0.01, ink: '#c9a84c' },
    ],
  },
  {
    id: 'vj-12', name: 'Emissive Glow (VJ test 12)', ground: '#0a0a10',
    ribbons: [
      { points: [{x:.15,y:.20},{x:.45,y:.10},{x:.30,y:.55},{x:.60,y:.70},{x:.35,y:.85}], width: 0.03, taper: 0.12, tremor: 0.02, gap: 0.006, ink: '#f5f0e0', glow: true },
      { points: [{x:.80,y:.15},{x:.65,y:.50},{x:.90,y:.75}], width: 0.025, taper: 0.12, tremor: 0.02, gap: 0.006, ink: '#f5f0e0', glow: true },
    ],
  },
];
