# alRato: brief de diseño (v5, 27 nov 2026)

> **Cambio en v5:** **colores puros, sin degradados.** Cada elemento tiene un solo color (violeta `#8b5cf6` de acento,
> cian `#22d3ee` para las curvas, ámbar para una segunda curva, verde para lo comprobado, rosa para errores), el fondo
> es blanco liso y las escenas de solución se dibujan como en el video "Claude what is math?": un trazador neón, valores
> en vivo y un HUD con reloj, fórmula y línea de tiempo.
>
> **v4:** el tema por defecto es **blanco**, con títulos en tinta casi negra y tarjetas de vidrio blanco. El oscuro casi negro (`#07070c`, nunca azul marino) queda
> como opción en Tu IA › Apariencia. Dos superficies son oscuras en ambos temas, a propósito: **la pizarra** donde se
> escriben las soluciones (como los videos de matemáticas) y **la cámara**, que se abre a pantalla completa como una
> app de cámara. La skill del proyecto `.claude/skills/alrato-design/SKILL.md` convierte este brief en un
> procedimiento de revisión.

Este es el "prompt" de diseño que guía la interfaz. Sale de las referencias que mandó el equipo: la app de notas con
vidrio, la barra de pestañas de iOS 26, los controles "liquid glass", el escáner de ejercicios con esquinas rojas y los
videos de matemáticas animadas sobre fondo negro.

## Idea en una frase

Un cuaderno de vidrio sobre papel blanco: todo lo que el estudiante toca es claro y suave, y lo que la IA resuelve
aparece escrito en una pizarra negra, paso a paso, con un dibujo que explica la idea, como en los videos.

## Principios

1. **Fondo liso.** Blanco `#f6f6f9` sin brillos de color ni degradados. Nunca azul.
2. **Títulos grandes en tinta.** Cada pantalla abre con un título enorme (Inter 750, interletrado cerrado) en `#0d0d14`.
   En oscuro, los títulos van en blanco con un halo violeta.
3. **Vidrio con intención.** Tarjetas blancas translúcidas (desenfoque 20–28 px), borde de tinta al 8 %, sombra amplia
   y suave.
4. **Bento con color por tipo de apunte.** Ejercicio = menta, fórmula = mantequilla, pizarra = lavanda, duda = rosa,
   apunte = blanco. La primera tarjeta ocupa dos columnas.
5. **Un solo acento fuerte, en color puro.** El chip activo es amarillo limón; el botón principal es una cápsula de
   tinta con texto blanco; el violeta `#8b5cf6` marca la marca, los números de paso y el progreso. Sin degradados.
6. **Navegación como iOS 26.** Cápsula flotante de vidrio con tres pestañas y una "lente" que se desliza a la pestaña
   activa; la cámara es un círculo aparte, el gesto principal de la app.
7. **La cámara es una cámara.** Pantalla completa y negra, un marco con esquinas rosas que se arrastran, modos
   Ejercicio y Pizarra, linterna, galería, historial y un obturador rojo grande. La primera vez pide el permiso ahí
   mismo y dice para qué; si está bloqueado, explica cómo activarlo y ofrece la galería.
8. **La IA escribe en una pizarra y dibuja la idea.** La solución se escribe símbolo a símbolo, la ecuación principal se
   transforma arriba, y al final aparece el dibujo que eligió el modelo: gráfica con ceros, dos curvas que se cortan,
   área llenada con rectángulos, secantes que se vuelven tangente, el círculo unitario dibujando la onda del seno, o una
   curva paramétrica. El resultado comprobado por el dispositivo queda enmarcado en verde; uno que el dispositivo
   demuestra falso, en rosa.
9. **El agente se muestra.** Debajo de la solución, "Cómo lo resolvió alRato" lista cada paso como una llamada a una
   herramienta: verde si corrió en tu dispositivo, violeta si fue a la nube.
10. **Movimiento con propósito.** Entrada escalonada, lente deslizante, escritura de pasos y dibujos. Todo se apaga con
    "reducir movimiento" y nada bloquea un toque.

## Tokens

| Token | Blanco (por defecto) | Oscuro |
| --- | --- | --- |
| Fondo | `#ffffff → #f6f6f9`, brillos violeta 16 % y rosa 11 % | `#08080d → #060609`, brillos violeta y rosa |
| Vidrio | blanco 62–88 % | blanco 5–7 % |
| Tinta / títulos | `#0d0d14` / `#0d0d14` | `#f5f5fa` / `#ffffff` |
| Acento | `#6d28d9` | `#c4b5fd` |
| Chip activo | `#f1ea62` | `#f3ef7a` |
| Botón principal | tinta, texto blanco | blanco, texto tinta |
| Pizarra y cámara | `#0b0b12`, siempre oscuras | `#000000` |
| Verde / rosa de verificación | `#34d399` / `#fb7185` | los mismos |

## Qué no hacer

- Degradados de color (por ejemplo azul → morado), en cualquier elemento.
- Azul como color de fondo, en cualquier tema.
- Texto pequeño en tinta dentro de la pizarra: la pizarra usa sus propios colores de tiza.
- Degradados morados en todos los botones: el color fuerte es escaso a propósito.
- Animaciones que retrasen un toque o que se repitan sin motivo.
