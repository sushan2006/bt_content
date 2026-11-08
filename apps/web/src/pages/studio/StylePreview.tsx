/**
 * A small moving sample of each preset style, drawn in SVG so it plays straight in the browser.
 * The real video follows the topic; these only show the look.
 */
import { ReactNode } from 'react';

const W = 320, H = 180;
const Frame = ({ children, bg }: { children: ReactNode; bg: string }) => (
  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block" preserveAspectRatio="xMidYMid slice" style={{ background: bg }} role="img">{children}</svg>
);
const anim = (attr: string, values: string, dur: string, extra: Record<string, string> = {}) => <animate attributeName={attr} values={values} dur={dur} repeatCount="indefinite" {...extra} />;

function PaperCutout() {
  const tags = [['GOAL', '#e3a83b', 160, 38], ['USE TOOL', '#c9623f', 228, 92], ['CHECK', '#8aa17a', 160, 146], ['DECIDE', '#22313f', 92, 92]] as const;
  return (
    <Frame bg="#efe6d6">
      <defs>
        <filter id="pc-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="3" stdDeviation="1.5" floodOpacity="0.28" /></filter>
        <filter id="pc-grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" /><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.3  0 0 0 0.10 0" /><feBlend in2="SourceGraphic" mode="multiply" /></filter>
      </defs>
      <rect width={W} height={H} filter="url(#pc-grain)" fill="#efe6d6" />
      <path d="M0 152 L18 148 L40 153 L66 147 L90 151 L120 146 L150 152 L182 147 L210 152 L240 146 L268 151 L300 147 L320 150 L320 180 L0 180Z" fill="#8aa17a" filter="url(#pc-shadow)" />
      <g filter="url(#pc-shadow)">
        <path d="M12 12 L166 10 L174 22 L166 34 L14 35 Z" fill="#c9623f" />
        <text x="22" y="28" fontSize="12" fontWeight="800" fill="#fff" fontFamily="Montserrat, Inter, sans-serif">HOW AN AGENT WORKS</text>
      </g>
      <circle cx="160" cy="92" r="46" fill="none" stroke="#6d93a8" strokeWidth="9" strokeDasharray="4 3" filter="url(#pc-shadow)">
        <animateTransform attributeName="transform" type="rotate" values="0 160 92;90 160 92;180 160 92;270 160 92;360 160 92" dur="6s" calcMode="discrete" repeatCount="indefinite" />
      </circle>
      <g filter="url(#pc-shadow)"><rect x="146" y="80" width="28" height="22" rx="3" fill="#22313f" /><circle cx="154" cy="91" r="3" fill="#fff" /><circle cx="166" cy="91" r="3" fill="#fff" /></g>
      {tags.map(([t, c, x, y], i) => (
        <g key={t} filter="url(#pc-shadow)">
          <g>
            <animateTransform attributeName="transform" type="translate" values={`0 ${-60 - i * 10};0 3;0 0;0 0`} keyTimes="0;0.12;0.18;1" dur="6s" begin={`${i * 0.35}s`} repeatCount="indefinite" />
            <rect x={x - 26} y={y - 10} width="52" height="20" rx="2" fill={c} transform={`rotate(${i % 2 ? 3 : -3} ${x} ${y})`} />
            <text x={x} y={y + 4} fontSize="8.5" fontWeight="800" fill="#fff" textAnchor="middle" fontFamily="Montserrat, Inter, sans-serif">{t}</text>
          </g>
        </g>
      ))}
      <g filter="url(#pc-shadow)"><rect x="248" y="18" width="58" height="46" fill="#f8f1e4" transform="rotate(2 277 41)" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={256 + i * 12} y={50} width="8" height="10" fill={i === 3 ? '#c9623f' : '#8aa17a'}>{anim('height', `2;${8 + i * 4};${8 + i * 4}`, '6s', { keyTimes: '0;0.3;1' })}{anim('y', `58;${50 - i * 4};${50 - i * 4}`, '6s', { keyTimes: '0;0.3;1' })}</rect>)}
      </g>
    </Frame>
  );
}

function Particles() {
  // dots sampled on two shapes: a "C" ring and a box; they flow between them
  const n = 90;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 1.6 + 0.7;
    const ring = [100 + Math.cos(a) * 34, 90 + Math.sin(a) * 34];
    const side = i % 4, t = (i % 22) / 22;
    const box = side === 0 ? [190 + t * 80, 60] : side === 1 ? [270, 60 + t * 60] : side === 2 ? [190 + t * 80, 120] : [190, 60 + t * 60];
    return { ring, box, d: (i * 37) % 100 / 100 };
  });
  return (
    <Frame bg="#050b1f">
      <defs>
        <radialGradient id="pt-bg" cx="50%" cy="45%" r="70%"><stop offset="0" stopColor="#0d1a3d" /><stop offset="1" stopColor="#03060f" /></radialGradient>
        <filter id="pt-glow"><feGaussianBlur stdDeviation="1.3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect width={W} height={H} fill="url(#pt-bg)" />
      {Array.from({ length: 40 }, (_, i) => <circle key={`s${i}`} cx={(i * 83) % W} cy={(i * 47) % H} r="0.6" fill="#7aa0ff" opacity="0.5">{anim('opacity', '0.1;0.7;0.1', `${2 + (i % 5)}s`)}</circle>)}
      <g filter="url(#pt-glow)">
        {pts.map((p, i) => (
          <circle key={i} r="1.4" fill={i % 3 ? '#35e0ff' : '#9b7bff'} cx={p.ring[0]} cy={p.ring[1]}>
            {anim('cx', `${p.ring[0]};${p.ring[0]};${p.box[0]};${p.box[0]};${p.ring[0]}`, '7s', { keyTimes: `0;${0.3 + p.d * 0.05};${0.5 + p.d * 0.05};0.85;1`, calcMode: 'spline', keySplines: '0 0 1 1;.6 0 .4 1;0 0 1 1;.6 0 .4 1' })}
            {anim('cy', `${p.ring[1]};${p.ring[1]};${p.box[1]};${p.box[1]};${p.ring[1]}`, '7s', { keyTimes: `0;${0.3 + p.d * 0.05};${0.5 + p.d * 0.05};0.85;1`, calcMode: 'spline', keySplines: '0 0 1 1;.6 0 .4 1;0 0 1 1;.6 0 .4 1' })}
          </circle>
        ))}
      </g>
      <text x="160" y="160" textAnchor="middle" fontSize="8" letterSpacing="2" fill="#f5c542" fontFamily="JetBrains Mono, monospace">ONE GOAL · SHIP WORKING SOFTWARE</text>
    </Frame>
  );
}

function LiquidGlass() {
  const scene = (
    <g>
      <rect width={W} height={H} fill="url(#lg-bg)" />
      <circle cx="60" cy="40" r="50" fill="#3c7bff" opacity="0.25" />
      <rect x="150" y="34" width="134" height="88" rx="10" fill="#0d1e44" stroke="#5b7dc9" strokeOpacity="0.5" />
      <text x="162" y="54" fontSize="9" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">Habit Tracker</text>
      {['Drink water', 'Read 20 pages', 'Walk 8k steps'].map((t, i) => (
        <g key={t}><circle cx="166" cy={70 + i * 15} r="3.5" fill={i < 2 ? '#35e0a0' : 'none'} stroke="#35e0a0" /><text x="175" y={73 + i * 15} fontSize="7" fill="#cfe0ff" fontFamily="Inter, sans-serif">{t}</text></g>
      ))}
      <rect x="236" y="100" width="40" height="13" rx="6.5" fill="#3c7bff" /><text x="256" y="109" fontSize="6.5" textAnchor="middle" fill="#fff" fontFamily="Inter">Deploy →</text>
      <text x="20" y="28" fontSize="12" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">Idea → live app</text>
      {['prompt', 'interface', 'test', 'deploy'].map((t, i) => <g key={t}><rect x={20 + i * 72} y="146" width="58" height="14" rx="7" fill="none" stroke="#7da2ff" strokeOpacity="0.6" /><text x={49 + i * 72} y="156" fontSize="6.5" textAnchor="middle" fill="#cfe0ff" fontFamily="JetBrains Mono, monospace">{t}</text></g>)}
    </g>
  );
  return (
    <Frame bg="#0b1a3a">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0b1a3a" /><stop offset="1" stopColor="#1c3f7a" /></linearGradient>
        <clipPath id="lg-lens"><rect x="-38" y="-20" width="76" height="40" rx="20"><animateTransform attributeName="transform" type="translate" values="190 70;250 104;180 150;190 70" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1" /></rect></clipPath>
      </defs>
      {scene}
      {/* the lens: the same scene, magnified, clipped to a moving pill */}
      <g clipPath="url(#lg-lens)">
        <g>
          <animateTransform attributeName="transform" type="translate" values="190 70;250 104;180 150;190 70" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1" />
          <g transform="scale(1.35)">
            <g>
              <animateTransform attributeName="transform" type="translate" values="-190 -70;-250 -104;-180 -150;-190 -70" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1" />
              {scene}
            </g>
          </g>
        </g>
        <rect width={W} height={H} fill="#fff" opacity="0.06" />
      </g>
      <rect x="-38" y="-20" width="76" height="40" rx="20" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.2">
        <animateTransform attributeName="transform" type="translate" values="190 70;250 104;180 150;190 70" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines=".5 0 .5 1;.5 0 .5 1;.5 0 .5 1" />
      </rect>
    </Frame>
  );
}

function KineticType() {
  const rows = ['GOAL', 'DETAILS', 'CONSTRAINTS', 'EXAMPLE'];
  return (
    <Frame bg="#111">
      <rect x="150" width="170" height={H} fill="#f2efe8" />
      <text x="12" y="22" fontSize="6.5" fill="#bbb" fontFamily="JetBrains Mono, monospace">01 / THE PROBLEM</text>
      <g fontFamily="Anton, 'Bebas Neue', Impact, sans-serif" fontWeight="900">
        <text x="75" y="110" fontSize="36" textAnchor="middle" fill="#fff">VAGUE{anim('font-size', '16;39;36;36', '5s', { keyTimes: '0;0.08;0.12;1' })}</text>
      </g>
      <rect x="18" y="94" height="6" fill="#ff4d3d">{anim('width', '0;0;114;114', '5s', { keyTimes: '0;0.2;0.3;1' })}</rect>
      <text x="160" y="22" fontSize="6.5" fill="#888" fontFamily="JetBrains Mono, monospace">03 / THE FIX</text>
      <text x="160" y="58" fontSize="34" fontWeight="900" fill="#2f4bff" fontFamily="Anton, 'Bebas Neue', Impact, sans-serif">PRECISE{anim('opacity', '0;0;1;1', '5s', { keyTimes: '0;0.3;0.36;1' })}</text>
      {rows.map((r, i) => (
        <g key={r}>
          {i === 2 && <rect x="158" y={68 + i * 22} height="18" fill="#e8ff3a">{anim('width', `0;0;150;150`, '5s', { keyTimes: `0;${0.62};0.7;1` })}</rect>}
          <g opacity="0">{anim('opacity', '0;0;1;1', '5s', { keyTimes: `0;${0.38 + i * 0.07};${0.42 + i * 0.07};1` })}
            <text x="160" y={81 + i * 22} fontSize="6" fill="#888" fontFamily="JetBrains Mono, monospace">0{i + 1}</text>
            <text x="172" y={82 + i * 22} fontSize="11" fontWeight="900" fill="#111" fontFamily="Inter, sans-serif">{r}</text>
            <line x1="160" x2="308" y1={87 + i * 22} y2={87 + i * 22} stroke="#111" strokeOpacity="0.3" />
          </g>
        </g>
      ))}
    </Frame>
  );
}

function Isometric() {
  const box = 'M120 70 L160 50 L200 70 L160 90 Z M120 70 L120 110 L160 130 L160 90 M160 130 L200 110 L200 70';
  return (
    <Frame bg="#0f1b2b">
      <defs><pattern id="iso-grid" width="20" height="11.5" patternUnits="userSpaceOnUse"><path d="M0 0 L20 11.5 M20 0 L0 11.5" stroke="#1e3048" strokeWidth="0.5" /></pattern></defs>
      <rect width={W} height={H} fill="url(#iso-grid)" />
      <path d={box} fill="none" stroke="#dbe9ff" strokeWidth="1.4" strokeLinejoin="round" strokeDasharray="420" strokeDashoffset="420">{anim('stroke-dashoffset', '420;0;0', '6s', { keyTimes: '0;0.3;1' })}</path>
      <path d="M40 120 L80 140 L120 120 M30 60 L60 45 L90 60 L60 75 Z M30 60 L30 90 L60 105 L90 90 L90 60" fill="none" stroke="#dbe9ff" strokeWidth="1.2" strokeDasharray="300" strokeDashoffset="300">{anim('stroke-dashoffset', '300;300;0;0', '6s', { keyTimes: '0;0.15;0.45;1' })}</path>
      <path id="iso-route" d="M90 90 L160 130 L250 85 L290 105" fill="none" stroke="#2ec4b6" strokeWidth="1.2" strokeDasharray="4 3">{anim('stroke-dashoffset', '0;-14', '1s')}</path>
      <g><rect x="-6" y="-4" width="12" height="8" fill="#2ec4b6" /><animateMotion dur="6s" repeatCount="indefinite"><mpath href="#iso-route" /></animateMotion></g>
      <circle cx="290" cy="96" r="5" fill="#f5a524">{anim('r', '4;6;4', '1.2s')}</circle>
      {[['1', 'PAYMENT OK', 24, 40], ['2', 'PICK & PACK', 180, 34], ['3', 'IN TRANSIT', 230, 70]].map(([n, t, x, y], i) => (
        <g key={n} opacity="0">{anim('opacity', '0;0;1;1', '6s', { keyTimes: `0;${0.45 + i * 0.1};${0.5 + i * 0.1};1` })}
          <circle cx={x as number} cy={y as number} r="5" fill="#2ec4b6" /><text x={x as number} y={(y as number) + 2.5} fontSize="6" textAnchor="middle" fill="#0f1b2b" fontWeight="700">{n}</text>
          <text x={(x as number) + 9} y={(y as number) + 2.5} fontSize="6" letterSpacing="1" fill="#dbe9ff" fontFamily="JetBrains Mono, monospace">{t}</text></g>
      ))}
      <text x="16" y="164" fontSize="11" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">Checkout → doorstep</text>
    </Frame>
  );
}

function FlatVector() {
  return (
    <Frame bg="#f4f6fb">
      <text x="14" y="22" fontSize="11" fontWeight="800" fill="#1d2a4d" fontFamily="Montserrat, Inter, sans-serif">Sunlight → home power</text>
      <g transform="translate(48 66)">
        <g><animateTransform attributeName="transform" type="rotate" values="0;360" dur="12s" repeatCount="indefinite" />
          {Array.from({ length: 10 }, (_, i) => <rect key={i} x="-2" y="-30" width="4" height="9" rx="2" fill="#ffc83d" transform={`rotate(${i * 36})`} />)}</g>
        <circle r="17" fill="#ffc83d" />
      </g>
      <line x1="72" y1="78" x2="140" y2="96" stroke="#ff6b5b" strokeWidth="2" strokeDasharray="6 5">{anim('stroke-dashoffset', '0;-22', '0.8s')}</line>
      <g transform="translate(130 70)">
        <path d="M10 30 L45 6 L80 30 Z" fill="#2f5bea" />
        {[0, 1, 2, 3].map((i) => <rect key={i} x={24 + i * 11} y="14" width="9" height="9" fill="#1d2a4d" transform="skewX(-10)" />)}
        <rect x="16" y="30" width="58" height="42" fill="#e6e9ff" /><rect x="40" y="48" width="12" height="24" rx="6" fill="#1d2a4d" />
        <rect x="22" y="38" width="12" height="12" fill="#ffc83d" stroke="#1d2a4d" strokeWidth="1.5" /><rect x="58" y="38" width="12" height="12" fill="#ffc83d" stroke="#1d2a4d" strokeWidth="1.5" />
      </g>
      <path d="M204 120 L236 120 L236 104 L252 104" fill="none" stroke="#18c29c" strokeWidth="2" strokeDasharray="5 4">{anim('stroke-dashoffset', '0;-18', '0.7s')}</path>
      <rect x="252" y="94" width="26" height="20" rx="4" fill="#18c29c"><animate attributeName="width" values="20;26;20" dur="1.6s" repeatCount="indefinite" /></rect>
      <text x="265" y="107" fontSize="8" textAnchor="middle" fill="#fff" fontWeight="700">⏛</text>
      {[['1', 'Light frees electrons', 18, 150], ['2', 'DC', 200, 88], ['3', 'Inverter: DC → AC', 200, 150]].map(([n, t, x, y]) => (
        <g key={n}><circle cx={x as number} cy={y as number} r="6" fill="#1d2a4d" /><text x={x as number} y={(y as number) + 2.5} fontSize="7" textAnchor="middle" fill="#fff" fontWeight="700">{n}</text>
          <text x={(x as number) + 10} y={(y as number) + 2.5} fontSize="7" fill="#1d2a4d" fontFamily="Inter, sans-serif">{t}</text></g>
      ))}
      <line x1="0" x2={W} y1="140" y2="140" stroke="#d6dbea" />
    </Frame>
  );
}

function Risograph() {
  return (
    <Frame bg="#f3e9d2">
      <defs>
        <pattern id="riso-dots" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="2" cy="2" r="1.1" fill="#ffd23f" /></pattern>
        <filter id="riso-grain"><feTurbulence type="fractalNoise" baseFrequency="1.2" /><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0.12 0" /><feBlend in2="SourceGraphic" mode="multiply" /></filter>
      </defs>
      <circle cx="232" cy="78" r="56" fill="url(#riso-dots)" />
      <g style={{ mixBlendMode: 'multiply' }}>
        <g><animateTransform attributeName="transform" type="rotate" values="0 96 100;360 96 100" dur="8s" repeatCount="indefinite" />
          <circle cx="96" cy="100" r="62" fill="#3d5afe" />
          {[54, 46, 38, 30].map((r) => <circle key={r} cx="96" cy="100" r={r} fill="none" stroke="#2a3bb8" strokeWidth="1" />)}
          <rect x="94" y="40" width="4" height="10" fill="#ff4f8b" />
        </g>
        <circle cx="99" cy="102" r="20" fill="#ff4f8b">{anim('cx', '99;101;99', '3s')}</circle>
        <circle cx="96" cy="100" r="19" fill="#ffd23f" opacity="0.9" />
      </g>
      <line x1="150" y1="38" x2="124" y2="76" stroke="#22313f" strokeWidth="2.5" strokeLinecap="round"><animateTransform attributeName="transform" type="rotate" values="0 150 38;-6 150 38;0 150 38" dur="4s" repeatCount="indefinite" /></line>
      <circle cx="150" cy="38" r="5" fill="#22313f" />
      <g fontFamily="Anton, 'Bebas Neue', Impact, sans-serif" fontWeight="900" fontSize="30" style={{ mixBlendMode: 'multiply' }}>
        <text x="186" y="64" fill="#ff4f8b">RECORD{anim('x', '186;188;186', '2.4s')}</text>
        <text x="186" y="96" fill="#3d5afe">PLAYS{anim('x', '186;184;186', '2.4s')}</text>
      </g>
      <text x="14" y="172" fontSize="6.5" fill="#22313f" fontFamily="Courier New, monospace">groove · stylus · cartridge · amp · speaker</text>
      <rect width={W} height={H} filter="url(#riso-grain)" fill="#f3e9d2" opacity="0.35" />
    </Frame>
  );
}

function PixelArt() {
  const P = 4;   // drawn on an 80 × 45 grid, scaled 4× with crisp edges
  const px = (x: number, y: number, w: number, h: number, c: string, k?: string) => <rect key={k} x={x * P} y={y * P} width={w * P} height={h * P} fill={c} />;
  const hero = [[1, 0, 2, 1, '#ff77a8'], [0, 1, 4, 2, '#ffccaa'], [1, 1, 1, 1, '#1d2b53'], [0, 3, 4, 2, '#29adff'], [0, 5, 1, 1, '#1d2b53'], [3, 5, 1, 1, '#1d2b53']] as const;
  return (
    <Frame bg="#1d2b53">
      <g shapeRendering="crispEdges">
        {Array.from({ length: 18 }, (_, i) => px((i * 13) % 56, (i * 7) % 26, 1, 1, '#c2c3c7', `st${i}`))}
        {[[0, 30, 10, 3], [8, 28, 10, 5], [18, 31, 12, 2], [28, 29, 10, 4], [38, 30, 18, 3]].map(([x, y, w, h], i) => px(x, y, w, h, '#7e2553', `m${i}`))}
        {px(0, 33, 56, 1, '#00e436')}
        {Array.from({ length: 14 }, (_, i) => px(i * 4, 34, 3, 11, i % 2 ? '#5f574f' : '#83769c', `b${i}`))}
        <g>{px(26, 14, 4, 4, '#ffec27')}<text x={27.2 * P} y={17.3 * P} fontSize="12" fill="#ab5236" fontFamily="'Press Start 2P', monospace">?</text>
          <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 -6;0 0;0 0" keyTimes="0;0.38;0.44;0.5;1" dur="2.4s" repeatCount="indefinite" /></g>
        <g><animateTransform attributeName="transform" type="translate" values={`${26 * P} ${27 * P};${26 * P} ${27 * P};${26 * P} ${19 * P};${26 * P} ${27 * P};${26 * P} ${27 * P}`} keyTimes="0;0.2;0.42;0.65;1" dur="2.4s" repeatCount="indefinite" calcMode="discrete" />
          {hero.map(([x, y, w, h, c], i) => px(x, y, w, h, c, `h${i}`))}</g>
        <text x={14 * P} y={20 * P} fontSize="9" fill="#ffec27" fontFamily="'Press Start 2P', monospace" opacity="0">HIT!{anim('opacity', '0;0;1;0;0', '2.4s', { keyTimes: '0;0.4;0.45;0.6;1', calcMode: 'discrete' })}</text>
        {px(57, 3, 22, 39, '#000')}{px(58, 4, 20, 37, '#1d2b53')}
        {['INPUT', 'UPDATE', 'RENDER'].map((t, i) => <g key={t}>
          <rect x={58.5 * P} y={(11 + i * 7) * P} width={P} height={5 * P} fill="#ffec27" opacity="0">{anim('opacity', i === 0 ? '1;0;0' : i === 1 ? '0;1;0' : '0;0;1', '2.4s', { calcMode: 'discrete' })}</rect>
          <text x={60 * P} y={(15 + i * 7) * P} fontSize="8" fill="#fff1e8" fontFamily="'Press Start 2P', monospace">{t}</text></g>)}
        <text x={59 * P} y={8 * P} fontSize="8" fill="#00e436" fontFamily="'Press Start 2P', monospace">GAME LOOP</text>
        <text x={2 * P} y={6 * P} fontSize="9" fill="#fff1e8" fontFamily="'Press Start 2P', monospace">PRESS &gt; JUMP</text>
      </g>
    </Frame>
  );
}

function SimpleEdit() {
  // three real-looking shots cut together (wide, medium, close-up), with the edit timeline underneath
  const shots = [
    <g key="wide"><rect width={W} height="132" fill="#9fb3c2" /><rect y="80" width={W} height="52" fill="#6b6f72" />
      {[30, 110, 190, 250].map((x, i) => <g key={i}><rect x={x} y={52 - i * 4} width="44" height={30 + i * 4} fill="#4f5a63" /><rect x={x + 8} y={44 - i * 4} width="10" height="10" fill="#3c454c" /></g>)}
      <rect x="0" y="96" width={W} height="6" fill="#d6b24a" opacity="0.8" /></g>,
    <g key="mid"><rect width={W} height="132" fill="#c9c2b6" /><rect y="96" width={W} height="36" fill="#7a746b" />
      <rect x="90" y="40" width="140" height="62" rx="6" fill="#3f6f8f" /><circle cx="130" cy="72" r="18" fill="#2b4d63" /><circle cx="130" cy="72" r="7" fill="#9bb7c9" />
      <rect x="170" y="58" width="44" height="8" rx="2" fill="#e3e8eb" /><rect x="170" y="72" width="30" height="8" rx="2" fill="#e3e8eb" /></g>,
    <g key="close"><rect width={W} height="132" fill="#2b4d63" /><circle cx="160" cy="66" r="52" fill="#3f6f8f" /><circle cx="160" cy="66" r="30" fill="#1e3746" />
      <g><animateTransform attributeName="transform" type="rotate" values="0 160 66;360 160 66" dur="2s" repeatCount="indefinite" />
        {[0, 60, 120, 180, 240, 300].map((a) => <rect key={a} x="157" y="40" width="6" height="22" rx="2" fill="#9bb7c9" transform={`rotate(${a} 160 66)`} />)}</g></g>,
  ];
  return (
    <Frame bg="#1c1c1c">
      {shots.map((g, i) => <g key={i} opacity={i === 0 ? 1 : 0}>{anim('opacity', ['1;0;0', '0;1;0', '0;0;1'][i], '6s', { calcMode: 'discrete' })}{g}</g>)}
      <rect y="132" width={W} height="48" fill="#1c1c1c" />
      {[['#5b7f95', 8, 96], ['#8a8072', 106, 100], ['#3f6f8f', 208, 104]].map(([c, x, w], i) => (
        <g key={i}><rect x={x as number} y="142" width={w as number} height="16" rx="2" fill={c as string} />
          <rect x={x as number} y="162" width={w as number} height="8" rx="2" fill="#4a7a52" opacity="0.8" /></g>))}
      <rect x="8" y="140" width="2" height="34" fill="#f5f5f4">{anim('x', '8;312', '6s')}</rect>
      <text x="10" y="14" fontSize="8" fill="#f5f5f4" fontFamily="Inter, sans-serif" opacity="0.8">REC · REAL FOOTAGE · NO GRAPHICS</text>
    </Frame>
  );
}

const PREVIEWS: Record<string, () => ReactNode> = {
  paper_cutout: PaperCutout, particles: Particles, liquid_glass: LiquidGlass, kinetic_type: KineticType,
  isometric: Isometric, flat_vector: FlatVector, risograph: Risograph, pixel_art: PixelArt, simple_edit: SimpleEdit,
};

export default function StylePreview({ styleKey, className = '' }: { styleKey: string; className?: string }) {
  const P = PREVIEWS[styleKey];
  return <div className={`aspect-video w-full overflow-hidden rounded-lg bg-stone-200 ${className}`}>{P ? <P /> : null}</div>;
}
