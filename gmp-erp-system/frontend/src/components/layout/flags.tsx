// Аккуратные SVG-флаги для языкового переключателя.
// Пропорции 1:2 — стандарт для обоих флагов.
// Внутренний viewBox в реальных пропорциях (1000:500 или 1000:500),
// шкалируется через width/height — это даёт чёткое изображение в любом размере.

interface FlagProps {
  size?: number
  className?: string
}

export function FlagRU({ size = 18, className }: FlagProps) {
  // Государственный флаг РФ: три равные горизонтальные полосы,
  // сверху белая, в центре синяя, снизу красная.
  // Официальные цвета (ГОСТ): #FFFFFF / #0039A6 / #D52B1E
  return (
    <svg
      width={size}
      height={size * (2 / 3)}
      viewBox="0 0 900 600"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <rect width="900" height="200" fill="#FFFFFF" />
      <rect y="200" width="900" height="200" fill="#0039A6" />
      <rect y="400" width="900" height="200" fill="#D52B1E" />
      <rect
        x="0.5"
        y="0.5"
        width="899"
        height="599"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="1"
      />
    </svg>
  )
}

export function FlagUZ({ size = 18, className }: FlagProps) {
  // Государственный флаг Узбекистана: пропорции 1:2.
  // Полосы (сверху вниз): голубая 8/22, красная 1/22, белая 3/22 с двумя красными полосками
  // 1/22 по краям (итого 5/22 «белый блок»), снова красная 1/22 — нет: на самом деле
  // 8 голубая · 1 красная · 4 белая · 1 красная · 8 зелёная (всего 22 единицы высоты).
  // Цвета (PMS): #0099B5 / #CE1126 / #FFFFFF / #1EB53A.
  // В верхней голубой полосе слева — белый полумесяц и 12 белых пятиконечных звёзд
  // (3 в первом ряду, 4 во втором, 5 в третьем).
  return (
    <svg
      width={size}
      height={size * (1 / 2)}
      viewBox="0 0 1000 500"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ borderRadius: 2, overflow: 'hidden' }}
    >
      {/* Горизонтальные полосы */}
      <rect width="1000" height="182" fill="#0099B5" />
      <rect y="182" width="1000" height="22" fill="#CE1126" />
      <rect y="204" width="1000" height="91" fill="#FFFFFF" />
      <rect y="295" width="1000" height="22" fill="#CE1126" />
      <rect y="317" width="1000" height="183" fill="#1EB53A" />

      {/* Полумесяц: внешний белый круг + внутренний голубой создают форму */}
      <circle cx="155" cy="91" r="50" fill="#FFFFFF" />
      <circle cx="180" cy="91" r="44" fill="#0099B5" />

      {/* 12 пятиконечных звёзд (3-4-5).
          Каждая звезда — <use> единого <symbol> с translate, чтобы было чисто. */}
      <defs>
        <symbol id="uz-star" viewBox="-15 -15 30 30">
          {/* Пятиконечная звезда радиусом ~14, центр (0,0). */}
          <polygon
            points="0,-14 4.11,-4.33 14.31,-4.33 6.10,1.65 8.82,11.31 0,5.45 -8.82,11.31 -6.10,1.65 -14.31,-4.33 -4.11,-4.33"
            fill="#FFFFFF"
          />
        </symbol>
      </defs>

      {/* Ряд 1 — 3 звезды */}
      <use href="#uz-star" x="245" y="50" width="30" height="30" />
      <use href="#uz-star" x="305" y="50" width="30" height="30" />
      <use href="#uz-star" x="365" y="50" width="30" height="30" />
      {/* Ряд 2 — 4 звезды */}
      <use href="#uz-star" x="245" y="85" width="30" height="30" />
      <use href="#uz-star" x="305" y="85" width="30" height="30" />
      <use href="#uz-star" x="365" y="85" width="30" height="30" />
      <use href="#uz-star" x="425" y="85" width="30" height="30" />
      {/* Ряд 3 — 5 звёзд */}
      <use href="#uz-star" x="245" y="120" width="30" height="30" />
      <use href="#uz-star" x="305" y="120" width="30" height="30" />
      <use href="#uz-star" x="365" y="120" width="30" height="30" />
      <use href="#uz-star" x="425" y="120" width="30" height="30" />
      <use href="#uz-star" x="485" y="120" width="30" height="30" />

      {/* Тонкая внешняя обводка, чтобы белая полоса не сливалась с фоном */}
      <rect
        x="0.5"
        y="0.5"
        width="999"
        height="499"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="1"
      />
    </svg>
  )
}
