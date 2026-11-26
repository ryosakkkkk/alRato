# alRato: brief de diseño (v3, 26 nov 2026)

> **Cambio en v3:** el tema por defecto ahora es **oscuro, casi negro** (`#07070c`, nunca azul marino), como una
> pizarra y como los videos de matemáticas. El cielo pastel de abajo quedó como **tema claro opcional**
> (Tu IA › Apariencia). La pizarra escribe cada símbolo en orden y, si el ejercicio es una función o una ecuación
> en x, dibuja la gráfica al final con las respuestas marcadas. La skill del proyecto
> `.claude/skills/alrato-design/SKILL.md` convierte este brief en un procedimiento de revisión.

Este es el "prompt" de diseño que guía la interfaz. Sale de las referencias que mandó el equipo: la app de notas
con vidrio pastel, la barra de pestañas de iOS 26, los controles "liquid glass", el escáner de ejercicios con
esquinas rojas y los videos de matemáticas animadas sobre fondo negro.

## Idea en una frase

Un cuaderno de vidrio sobre un cielo pastel: todo lo que el estudiante toca es translúcido y suave, y lo que la IA
resuelve aparece escrito en una pizarra oscura, paso a paso, como en los videos.

## Principios

1. **El fondo es el cielo, no un color.** Degradado fijo azul cielo → lila → rosa con dos brillos blancos y una franja
   de luz en diagonal. En oscuro: azul noche → ciruela, con los mismos brillos apagados.
2. **Títulos grandes y blancos.** Cada pantalla abre con un título enorme (Inter 700, interletrado cerrado) en blanco con
   un halo suave. Los subtítulos y el texto de lectura van en tinta oscura dentro de tarjetas, para que se lean bien.
3. **Vidrio con intención.** Tarjetas blancas translúcidas (desenfoque 20–28 px, borde blanco, sombra amplia y suave).
   Nada de bordes grises.
4. **Bento con color por tipo de apunte.** Ejercicio = menta, fórmula = mantequilla, pizarra = lavanda, duda = rosa,
   apunte = blanco. La primera tarjeta ocupa dos columnas.
5. **Un solo acento fuerte.** El chip activo es amarillo limón; el botón principal es una cápsula de tinta con texto
   blanco. El degradado cian → índigo → fucsia queda para la marca, los números de paso y el progreso.
6. **Navegación como iOS 26.** Cápsula flotante de vidrio con tres pestañas y una "lente" que se desliza a la pestaña
   activa; la cámara es un círculo aparte, el gesto principal de la app.
7. **La IA escribe en una pizarra.** La solución completa se muestra en un panel oscuro con cuadrícula tenue: cada paso
   se escribe de izquierda a derecha, el anterior se atenúa, y el resultado final queda enmarcado en verde.
   El ejemplo del inicio, además, dibuja la parábola y marca sus raíces.
8. **Movimiento con propósito.** Entrada escalonada de los bloques, lente deslizante, escritura de pasos. Todo se apaga
   con "reducir movimiento" y nada bloquea un toque.

## Tokens

| Token | Claro | Oscuro |
| --- | --- | --- |
| Fondo | `#8fb0e6 → #c3b8f0 → #efc1df → #f7d6d9` | `#0c1230 → #22164a → #3b1740` |
| Vidrio | blanco 58 % | blanco 8 % |
| Tinta | `#1d1a45` | `#f4f5ff` |
| Chip activo | `#f3ef7a` | `#f3ef7a` |
| Botón principal | tinta `#1d1a45`, texto blanco | blanco, texto tinta |
| Menta / mantequilla / lavanda / rosa | `#c7eedb` `#f8f3b8` `#ddd6fe` `#fbd3e7` | las mismas al 22 % |

## Qué no hacer

- Texto pequeño blanco sobre el pastel: solo los títulos grandes van en blanco.
- Degradados morados en todos los botones: el color fuerte es escaso a propósito.
- Animaciones que retrasen un toque o que se repitan sin motivo.
